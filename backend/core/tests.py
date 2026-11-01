import io
import json
import os
from datetime import timedelta
from unittest.mock import patch, Mock
import openpyxl
from django.test import TestCase, Client
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from .engine import (
    normal,
    validate,
    run,
    execute,
    safe_csv,
    export,
    parse,
    llm,
    AppError,
)
from .models import Dataset, Transformation
from .lifecycle import clean_expired

PLAN = {
    "operation": "regex_replace",
    "column_id": "c1",
    "pattern": r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
    "flags": [],
    "replacement": "REDACTED",
}


class EngineTests(TestCase):
    def setUp(self):
        self.data = normal(
            [
                ["ID", "Email"],
                ["001", "john.doe@example.com"],
                ["002", "jane@domain.com; jane.work@example.org"],
                ["003", ""],
            ]
        )

    def test_multiple_matches(self):
        r = execute(self.data, validate(PLAN, self.data))
        self.assertEqual(r["target_count"], 3)
        self.assertEqual(r["changed_cells"], 2)
        self.assertEqual(r["rows"][1][1], "REDACTED; REDACTED")
        self.assertEqual(self.data["rows"][0][0], "001")

    def test_zero_width_and_zero_matches(self):
        d = normal([["Email"], ["bbb"]])
        p = validate({**PLAN, "column_id": "c0", "pattern": "a*"}, d)
        self.assertEqual(run(d, p)["target_count"], 0)

    def test_literal_and_delete(self):
        for value in ("$1", r"\1", ""):
            r = run(self.data, validate(PLAN, self.data, value))
            self.assertEqual(r["rows"][1][1], value + "; " + value)

    def test_reject_unsupported_and_invalid(self):
        for p in (
            {"operation": "set_column"},
            {**PLAN, "pattern": "(a+)+$"},
            {**PLAN, "column_id": "c5"},
            {**PLAN, "flags": ["x"]},
            {**PLAN, "extra": "x"},
            {**PLAN, "pattern": "["},
        ):
            with self.assertRaises(AppError):
                validate(p, self.data)

    def test_same_replacement_not_changed(self):
        d = normal([["Email"], ["x"]])
        r = run(
            d,
            validate(
                {**PLAN, "column_id": "c0", "pattern": "x", "replacement": "x"}, d
            ),
        )
        self.assertEqual((r["target_count"], r["changed_cells"]), (1, 0))

    def test_exports(self):
        self.assertEqual(safe_csv("=1+1"), "'=1+1")
        self.assertEqual(safe_csv("+61 412 345 678"), "+61 412 345 678")
        self.assertEqual(safe_csv("-5"), "-5")
        raw, _ = export(["A"], [["=1+1"], ["001"], ["NA"]], "xlsx")
        self.assertEqual(
            parse("a.xlsx", raw)["Cleaned data"]["rows"], [["=1+1"], ["001"], ["NA"]]
        )

    def test_unicode_offsets(self):
        d = normal([["Email"], ["😀 hi a@b.com"]])
        self.assertEqual(
            run(d, validate({**PLAN, "column_id": "c0"}, d))["matches"][0]["start"], 5
        )

    def test_csv_strings_and_multiline(self):
        d = parse(
            "a.csv", '\ufeffID,Text\n001,"hello,\n世界"\n002,NA\n003,\n'.encode()
        )["CSV"]
        self.assertEqual(
            d["rows"], [["001", "hello,\n世界"], ["002", "NA"], ["003", ""]]
        )

    def test_file_limits(self):
        for name, raw in [
            ("x.csv", b"x" * (2 * 1024 * 1024 + 1)),
            ("x.txt", b"A\na"),
            ("x.csv", b"A\n\xff"),
        ]:
            with self.assertRaises(AppError):
                parse(name, raw)
        for matrix in [
            [["A", "A"], ["1", "2"]],
            [["A"]] * 5002,
            [["A"] * 51, ["1"] * 51],
        ]:
            with self.assertRaises(AppError):
                normal(matrix)

    def test_xlsx_sheets(self):
        b = openpyxl.Workbook()
        b.active.title = "One"
        b.active.append(["A"])
        b.active.append(["001"])
        s = b.create_sheet("Two")
        s.append(["B"])
        s.append(["NA"])
        out = io.BytesIO()
        b.save(out)
        self.assertEqual(list(parse("a.xlsx", out.getvalue())), ["One", "Two"])

    def test_output_limit(self):
        d = normal([["A"], ["x" * 5000]])
        with self.assertRaises(AppError):
            run(
                d,
                validate(
                    {
                        **PLAN,
                        "column_id": "c0",
                        "pattern": "x",
                        "replacement": "z" * 2000,
                    },
                    d,
                ),
            )

    def test_regex_timeout(self):
        d = normal([["A"], ["a" * 100 + "!"]])
        p = validate({**PLAN, "column_id": "c0", "pattern": "(a|aa)+$"}, d)
        with self.assertRaises(AppError) as caught:
            execute(d, p, timeout=0.2)
        self.assertEqual(caught.exception.code, "PROCESSING_TIMEOUT")


class ModelTests(TestCase):
    def setUp(self):
        self.data = normal([["ID", "Email"], ["001", "PRIVATE@example.com"]])

    @patch.dict(
        os.environ, {"GROQ_API_KEY": "unit-test-only", "GROQ_MODEL": "test-model"}
    )
    @patch("core.engine.requests.post")
    def test_arbitrary_instruction_reaches_model_without_cells(self, post):
        post.return_value = Mock(status_code=200)
        post.return_value.json.return_value = {
            "choices": [{"message": {"content": json.dumps(PLAN)}}]
        }
        for instruction in [
            "Please conceal email-shaped text in Email with REDACTED",
            "In Email, mask all mail addresses as REDACTED",
            "Email: substitute REDACTED for addresses",
        ]:
            self.assertEqual(llm(instruction, self.data)["replacement"], "REDACTED")
            payload = post.call_args.kwargs["json"]
            self.assertIn(instruction, json.dumps(payload))
            self.assertNotIn("PRIVATE@example.com", json.dumps(payload))

    @patch.dict(os.environ, {"GROQ_API_KEY": "test", "GROQ_MODEL": "test"})
    @patch("core.engine.requests.post")
    def test_repair_and_rate_limit(self, post):
        bad = Mock(status_code=200)
        bad.json.return_value = {"choices": [{"message": {"content": "bad json"}}]}
        good = Mock(status_code=200)
        good.json.return_value = {
            "choices": [{"message": {"content": json.dumps(PLAN)}}]
        }
        post.side_effect = [bad, good]
        self.assertEqual(llm("mask emails", self.data)["col"], 1)
        self.assertEqual(post.call_count, 2)
        post.reset_mock()
        post.side_effect = None
        post.return_value = Mock(status_code=429)
        with self.assertRaises(AppError) as caught:
            llm("mask emails", self.data)
        self.assertEqual(caught.exception.status, 429)
        self.assertEqual(post.call_count, 1)

    @patch.dict(os.environ, {"GROQ_API_KEY": "", "GROQ_MODEL": ""})
    def test_no_silent_fallback(self):
        with self.assertRaises(AppError) as caught:
            llm("mask emails", self.data)
        self.assertEqual(caught.exception.code, "MODEL_UNAVAILABLE")


class ApiTests(TestCase):
    def setUp(self):
        cache.clear()

    def upload(self, rows=120):
        raw = (
            "ID,Email\n"
            + "\n".join(f"{i:03},person{i}@example.com" for i in range(rows))
        ).encode()
        r = self.client.post(
            "/api/datasets", {"file": SimpleUploadedFile("a.csv", raw)}
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.id = r.json()["dataset_id"]
        self.d = self.client.post(
            f"/api/datasets/{self.id}/select-sheet",
            {"sheet_id": "CSV"},
            content_type="application/json",
        ).json()

    def generate(self, instruction="Hide all emails in Email with REDACTED"):
        with patch("core.views.plan_isolated", return_value=validate(PLAN, self.d)):
            return self.client.post(
                "/api/transformations",
                {
                    "dataset_id": self.id,
                    "sheet_id": "CSV",
                    "dataset_version": self.d["dataset_version"],
                    "instruction": instruction,
                },
                content_type="application/json",
            )

    def test_full_workflow_pagination_navigation_and_exports(self):
        self.upload()
        self.assertEqual(len(self.d["rows"]), 50)
        response = self.generate()
        self.assertEqual(response.status_code, 200, response.content)
        r = response.json()
        self.assertEqual(r["target_count"], 120)
        self.assertEqual(len(r["rows"]), 50)
        tid = r["id"]
        page = self.client.get(
            f"/api/transformations/{tid}/rows?offset=100&limit=50"
        ).json()
        self.assertEqual(len(page["processed"]), 20)
        self.assertEqual(page["original"][0][0], "100")
        self.assertEqual(page["matches"][0]["ordinal"], 101)
        self.assertEqual(
            self.client.get(f"/api/transformations/{tid}/targets/101").json()["row"],
            100,
        )
        raw = self.client.get(f"/api/transformations/{tid}/download?format=csv").content
        d = parse("out.csv", raw)["CSV"]
        self.assertEqual(len(d["rows"]), 120)
        self.assertEqual(d["rows"][-1][1], "REDACTED")
        xlsx = self.client.get(f"/api/transformations/{tid}/download?format=xlsx")
        self.assertEqual(xlsx.status_code, 200)
        self.assertEqual(
            len(parse("x.xlsx", xlsx.content)["Cleaned data"]["rows"]), 120
        )

    def test_ownership_and_delete(self):
        self.upload(1)
        r = self.generate().json()
        other = Client()
        for url in [
            f"/api/datasets/{self.id}/rows",
            f'/api/transformations/{r["id"]}/download',
            f'/api/transformations/{r["id"]}/targets/1',
        ]:
            self.assertEqual(other.get(url).status_code, 404)
        self.assertEqual(other.delete(f"/api/datasets/{self.id}").status_code, 404)
        self.assertEqual(
            self.client.delete(f"/api/datasets/{self.id}").status_code, 200
        )
        self.assertFalse(Transformation.objects.exists())
        self.assertEqual(
            self.client.get(f'/api/transformations/{r["id"]}/download').status_code, 404
        )

    def test_expiry(self):
        self.upload(1)
        Dataset.objects.filter(id=self.id).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        clean_expired()
        self.assertEqual(
            self.client.get(f"/api/datasets/{self.id}/rows").status_code, 404
        )

    def test_rate_limit(self):
        self.upload(1)
        for _ in range(5):
            self.assertEqual(self.generate().status_code, 200)
        self.assertEqual(self.generate().status_code, 429)

    def test_invalid_payload_and_methods(self):
        self.assertEqual(self.client.get("/api/datasets").status_code, 405)
        self.assertEqual(
            self.client.post(
                "/api/transformations", "[]", content_type="application/json"
            ).status_code,
            400,
        )

    def test_csrf(self):
        c = Client(enforce_csrf_checks=True)
        self.assertEqual(c.post("/api/datasets").status_code, 403)
        c.get("/api/config")
        token = c.cookies["csrftoken"].value
        self.assertEqual(
            c.post("/api/datasets", HTTP_X_CSRFTOKEN=token).status_code, 400
        )


class ServingTests(TestCase):
    def test_built_app_and_assets(self):
        import re

        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        html = b"".join(response.streaming_content).decode()
        self.assertIn("RegexGenie", html)
        asset = re.search(r'src="(/assets/[^"]+)"', html).group(1)
        self.assertEqual(self.client.get(asset).status_code, 200)
        self.assertEqual(self.client.get("/api/health").json(), {"status": "ok"})
