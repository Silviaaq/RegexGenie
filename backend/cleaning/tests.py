import io, tempfile, shutil
from datetime import datetime
from unittest.mock import patch
from django.test import TestCase, Client
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.cache import cache
import openpyxl
from core.engine import AppError
from .models import Workspace, CleaningJob, CleaningSuggestion
from .services import files, jobs, llm


class CleaningTests(TestCase):
    def setUp(self):
        cache.clear()
        self.tmp = tempfile.mkdtemp()
        self.root = patch.object(files, "ROOT", files.Path(self.tmp))
        self.root.start()
        self.client = Client()
        self.w = self.post("workspaces/", {}).json()
        with patch(
            "cleaning.views.isolated", side_effect=lambda fn, args, timeout: fn(*args)
        ):
            self.w = self.client.post(
                f"/api/workspaces/{self.w['workspace_id']}/upload/",
                {
                    "file": SimpleUploadedFile(
                        "demo.csv",
                        b"Email,Country,Age\na@example.com,AU,N/A\nb@example.com,AUS,0\nc@example.com,WA,NA\n",
                    )
                },
            ).json()
        self.id = self.w["workspace_id"]

    def tearDown(self):
        self.root.stop()
        shutil.rmtree(self.tmp)

    def post(self, path, data):
        return self.client.post("/api/" + path, data, content_type="application/json")

    def make(
        self,
        operation="regex_replace",
        pattern=r"[\w.]+@[\w.]+",
        cid="c0",
        replacement="REDACTED",
        action="replace",
    ):
        cache.clear()
        res = self.post(
            f"workspaces/{self.id}/jobs/",
            {
                "instruction": "Clean this column",
                "action": action,
                "replacement_value": replacement,
                "base_revision": self.w["revision"],
            },
        )
        self.assertEqual(res.status_code, 202, res.content)
        p = {"operation": operation, "target_column_id": cid}
        if operation == "regex_replace":
            p.update(pattern=pattern, flags=[])
        with patch.object(llm, "route", return_value=p):
            jobs.work_one()
        return CleaningJob.objects.get(pk=res.json()["job_id"])

    def apply(self, j, **extra):
        return self.post(
            f"jobs/{j.id}/apply/",
            {"base_revision": j.base_revision, "plan_hash": j.plan_hash, **extra},
        )

    def current(self):
        return files.read(Workspace.objects.get(pk=self.id).current_path)

    def test_preview_apply_export_undo_reset(self):
        j = self.make()
        self.assertEqual(j.status, "ready")
        self.assertEqual(self.current()["rows"][0][0], "a@example.com")
        self.assertEqual(self.apply(j).status_code, 200)
        self.assertEqual(self.current()["rows"][0][0], "REDACTED")
        w = Workspace.objects.get(pk=self.id)
        revision = w.revision
        self.assertEqual(self.apply(j).status_code, 200)
        self.assertEqual(Workspace.objects.get(pk=self.id).revision, revision)
        r = self.client.get(f"/api/workspaces/{self.id}/export/?format=csv")
        self.assertIn(b"REDACTED", r.content)
        self.assertEqual(
            self.post(
                f"workspaces/{self.id}/action/",
                {"action": "undo", "base_revision": revision},
            ).status_code,
            200,
        )
        self.assertEqual(self.current()["rows"][0][0], "a@example.com")
        j.refresh_from_db()
        self.assertEqual(j.status, "undone")
        w.refresh_from_db()
        self.assertFalse(w.previous_path)
        self.assertEqual(
            self.post(
                f"workspaces/{self.id}/action/",
                {"action": "reset", "base_revision": w.revision},
            ).status_code,
            200,
        )

    def test_missing_replacement_requires_input(self):
        self.assertEqual(self.make(replacement="").status, "needs_input")

    def test_explicit_remove_and_risk(self):
        j = self.make(action="remove", replacement=None)
        self.assertEqual(j.status, "ready")
        self.assertEqual(self.apply(j).status_code, 409)
        self.assertEqual(self.apply(j, confirm_high_risk=True).status_code, 200)
        self.assertEqual(self.current()["rows"][0][0], "")

    def test_literal_backslash_and_spaces(self):
        j = self.make(replacement=r" \1 $1 ")
        self.apply(j)
        self.assertEqual(self.current()["rows"][0][0], r" \1 $1 ")

    def test_zero_matches_does_not_advance_revision(self):
        j = self.make(pattern="ZZZ")
        self.assertEqual(j.impact_json["matches"], 0)
        self.assertEqual(self.apply(j).json()["status"], "no_changes")
        self.assertEqual(Workspace.objects.get(pk=self.id).revision, j.base_revision)

    def test_stale_apply_rejected(self):
        j = self.make()
        Workspace.objects.filter(pk=self.id).update(revision=99)
        self.assertEqual(self.apply(j).status_code, 409)

    def test_cross_session_access_denied(self):
        other = Client()
        self.assertEqual(other.get(f"/api/workspaces/{self.id}/data/").status_code, 404)
        j = self.make()
        self.assertEqual(other.get(f"/api/jobs/{j.id}/").status_code, 404)

    def test_csrf_enforced(self):
        self.assertEqual(
            Client(enforce_csrf_checks=True)
            .post("/api/workspaces/", {}, content_type="application/json")
            .status_code,
            403,
        )

    def test_invalid_regex_and_empty_match(self):
        for pattern in ("[", ".*", "x*"):
            with self.assertRaises(AppError):
                jobs.regex_preview(
                    {"headers": ["x"], "rows": [["abc"]]},
                    {"target_column_id": "c0", "pattern": pattern, "flags": []},
                    "a",
                )

    def test_catastrophic_pattern_is_bounded(self):
        with self.assertRaises(AppError) as e:
            jobs.regex_preview(
                {"headers": ["x"], "rows": [["a" * 50000 + "!"]]},
                {"target_column_id": "c0", "pattern": "(a+)+$", "flags": []},
                "x",
            )
        self.assertEqual(e.exception.code, "REGEX_TIMEOUT")

    def consent(self, j):
        ids = [v["id"] for v in j.scope_json["values"]]
        return self.post(
            f"jobs/{j.id}/scope-consent/",
            {
                "approved": True,
                "selected_value_ids": ids,
                "scope_hash": j.scope_json["scope_hash"],
                "base_revision": j.base_revision,
            },
        )

    def test_semantic_consent_and_selective_apply(self):
        with patch.object(llm, "proposals") as call:
            j = self.make(operation="normalise_values", cid="c1")
            self.assertEqual(j.status, "awaiting_consent")
            call.assert_not_called()
        self.assertEqual(self.consent(j).status_code, 200)
        with patch.object(
            llm,
            "proposals",
            return_value=[
                {
                    "id": v["id"],
                    "status": "needs_review" if v["value"] == "WA" else "proposed",
                    "proposed_value": "Australia",
                    "reason": "Country abbreviation",
                }
                for v in j.scope_json["values"]
            ],
        ):
            jobs.work_one()
        j.refresh_from_db()
        self.assertEqual(j.status, "ready")
        self.assertFalse(j.suggestions.filter(selected=True).exists())
        s = j.suggestions.get(original_value="AU")
        self.assertEqual(
            self.apply(j, selected_suggestion_ids=[str(s.id)]).status_code, 200
        )
        self.assertEqual(
            [r[1] for r in self.current()["rows"]], ["Australia", "AUS", "WA"]
        )

    def test_missing_values_conservative_and_true_null(self):
        j = self.make(operation="normalise_missing", cid="c2")
        self.consent(j)
        with patch.object(
            llm,
            "proposals",
            return_value=[
                {
                    "id": v["id"],
                    "status": "missing",
                    "proposed_value": None,
                    "reason": "Marker",
                }
                for v in j.scope_json["values"]
            ],
        ):
            jobs.work_one()
        j.refresh_from_db()
        self.assertEqual(j.suggestions.get(original_value="0").ai_status, "uncertain")
        self.assertEqual(j.suggestions.get(original_value="NA").ai_status, "uncertain")
        s = j.suggestions.get(original_value="N/A")
        self.apply(j, selected_suggestion_ids=[str(s.id)])
        self.assertIsNone(self.current()["rows"][0][2])
        raw, _ = files.export(self.current(), "csv")
        self.assertNotIn(b"null", raw)

    def test_declined_consent_never_calls_ai(self):
        j = self.make(operation="normalise_values", cid="c1")
        r = self.post(
            f"jobs/{j.id}/scope-consent/",
            {"approved": False, "base_revision": j.base_revision},
        )
        self.assertEqual(r.json()["status"], "cancelled")
        with patch.object(llm, "proposals") as call:
            jobs.work_one()
            call.assert_not_called()

    def test_scope_hash_and_unknown_ids_rejected(self):
        j = self.make(operation="normalise_values", cid="c1")
        r = self.post(
            f"jobs/{j.id}/scope-consent/",
            {
                "approved": True,
                "selected_value_ids": ["unknown"],
                "scope_hash": j.scope_json["scope_hash"],
                "base_revision": j.base_revision,
            },
        )
        self.assertEqual(r.status_code, 422)

    def test_suggestion_schema_rejects_missing_duplicate_unknown(self):
        j = self.make(operation="normalise_values", cid="c1")
        for items in (
            [],
            [{"id": "bad", "status": "proposed", "proposed_value": "A", "reason": "x"}],
        ):
            with patch.object(llm, "call", return_value={"items": items}):
                with self.assertRaises(AppError):
                    llm.proposals(j, [{"id": "v0", "value": "AU"}])

    def test_semantic_proposal_cannot_silently_clear_a_value(self):
        j = self.make(operation="normalise_values", cid="c1")
        with patch.object(llm, "call", return_value={"items": [
            {"id": "v0", "status": "needs_review", "proposed_value": "", "reason": "Ambiguous"}
        ]}):
            with self.assertRaises(AppError):
                llm.proposals(j, [{"id": "v0", "value": "WA"}])

    def test_xlsx_native_types(self):
        wb = openpyxl.Workbook()
        s = wb.active
        s.append(["Amount", "Date", "Bool", "Code"])
        s.append([12.5, datetime(2026, 1, 2), True, "001"])
        out = io.BytesIO()
        wb.save(out)
        d, _, _ = files.parse("a.xlsx", out.getvalue())
        raw, _ = files.export(d, "xlsx")
        r = openpyxl.load_workbook(io.BytesIO(raw)).active
        self.assertEqual(r["A2"].value, 12.5)
        self.assertIsInstance(r["B2"].value, datetime)
        self.assertIs(r["C2"].value, True)
        self.assertEqual(r["D2"].value, "001")

    def test_multi_sheet_requires_choice(self):
        wb = openpyxl.Workbook()
        wb.create_sheet("Second")
        out = io.BytesIO()
        wb.save(out)
        d, names, _ = files.parse("a.xlsx", out.getvalue())
        self.assertIsNone(d)
        self.assertEqual(len(names), 2)

    def test_csv_leading_zero_and_formula_protection(self):
        d, _, _ = files.parse("a.csv", b"Code,Text\n001,=1+1\n")
        raw, _ = files.export(d, "csv")
        self.assertIn(b"001", raw)
        self.assertIn(b"'=1+1", raw)

    def test_limits_format_rectangular(self):
        for name, raw in [
            ("a.xls", b"bad"),
            ("a.csv", b"a,b\n1,2,3"),
            ("a.csv", b"\xff"),
        ]:
            with self.assertRaises(AppError):
                files.parse(name, raw)

    def test_failed_upload_preserves_current(self):
        before = self.current()
        with patch("cleaning.views.isolated", side_effect=AppError("Invalid file")):
            r = self.client.post(
                f"/api/workspaces/{self.id}/upload/",
                {"file": SimpleUploadedFile("bad.csv", b"bad")},
            )
        self.assertEqual(r.status_code, 422)
        self.assertEqual(self.current(), before)

    def test_api_failure_keeps_successful_data(self):
        j = self.make()
        j.status = "queued"
        j.plan_json = None
        j.save()
        with patch.object(
            llm, "route", side_effect=AppError("AI unavailable", "LLM_UNAVAILABLE", 503)
        ):
            jobs.work_one()
        j.refresh_from_db()
        self.assertEqual(j.status, "failed")
        self.assertEqual(self.current()["rows"][0][0], "a@example.com")

    def inferred(self, action="replace", replacement="REDACTED", instruction=None):
        cache.clear()
        response = self.post(f"workspaces/{self.id}/jobs/", {
            "instruction": instruction or "Find emails in Email and replace them with 'REDACTED'",
            "base_revision": self.w["revision"],
        })
        self.assertEqual(response.status_code, 202)
        plan = {"operation": "regex_replace", "target_column_id": "c0",
                "pattern": r"[\w.]+@[\w.]+", "flags": [],
                "action": action, "replacement_value": replacement}
        with patch.object(llm, "call", return_value=plan):
            jobs.work_one()
        return CleaningJob.objects.get(pk=response.json()["job_id"])

    def test_single_instruction_extracts_and_persists_literal_without_applying(self):
        literal = r" \1 $1 "
        j = self.inferred(replacement=literal, instruction=f"Replace emails in Email with '{literal}'")
        self.assertEqual(j.status, "ready")
        self.assertEqual(j.replacement_value, literal)
        self.assertEqual(j.action, "replace")
        self.assertEqual(self.current()["rows"][0][0], "a@example.com")
        self.assertEqual(self.apply(j).status_code, 200)
        self.assertEqual(self.current()["rows"][0][0], literal)

    def test_inferred_missing_or_conflicting_replacement_requires_clarification(self):
        j = self.inferred(action=None, replacement=None)
        self.assertEqual(j.status, "needs_input")
        self.assertTrue(j.impact_json["replacement_required"])
        self.assertFalse(j.result_path)
        response = self.post(f"jobs/{j.id}/", {
            "base_revision": j.base_revision, "action": "replace", "replacement_value": "REDACTED"})
        self.assertEqual(response.status_code, 200)
        jobs.work_one()
        j.refresh_from_db()
        self.assertEqual(j.status, "ready")
        self.assertEqual(j.replacement_value, "REDACTED")

    def test_inferred_explicit_deletion_still_requires_risk_confirmation(self):
        j = self.inferred(action="remove", replacement=None, instruction="Remove email addresses from Email")
        self.assertEqual(j.status, "ready")
        self.assertEqual(self.apply(j).status_code, 409)
        self.apply(j, confirm_high_risk=True)
        self.assertEqual(self.current()["rows"][0][0], "")

    def test_inferred_replacement_cannot_be_invented_or_empty(self):
        for replacement in ("INVENTED", "", 1):
            j = self.inferred(replacement=replacement)
            self.assertEqual(j.status, "failed")
            self.assertEqual(j.error_code, "INVALID_AI_RESPONSE")
        self.assertEqual(self.current()["rows"][0][0], "a@example.com")

    def test_compact_scope_exposes_all_values_only_when_entire_scope_fits(self):
        response = self.client.get(f"/api/workspaces/{self.id}/values/?column_id=c1").json()
        self.assertTrue(response["within_budget"])
        self.assertEqual(len(response["all_items"]), 3)
        w = Workspace.objects.get(pk=self.id)
        d = self.current()
        d["rows"] = [["a@example.com", str(i), "0"] for i in range(201)]
        w.current_path = files.snapshot(d)
        w.save()
        response = self.client.get(f"/api/workspaces/{self.id}/values/?column_id=c1").json()
        self.assertFalse(response["within_budget"])
        self.assertEqual(response["all_items"], [])
        self.assertEqual(len(response["items"]), 50)

    def test_keep_all_is_noop_preserving_revision_and_undo(self):
        j = self.make(operation="normalise_values", cid="c1")
        self.consent(j)
        with patch.object(llm, "proposals", return_value=[
            {"id": v["id"], "status": "proposed", "proposed_value": "Australia", "reason": "Country"}
            for v in j.scope_json["values"]]):
            jobs.work_one()
        j.refresh_from_db()
        self.assertEqual(self.apply(j, selected_suggestion_ids=[]).json()["status"], "no_changes")
        w = Workspace.objects.get(pk=self.id)
        self.assertEqual(w.revision, j.base_revision)
        self.assertIsNone(w.previous_path)



class GroqTransportTests(TestCase):
    def test_every_task_explicitly_requests_json_and_bounded_output(self):
        from unittest.mock import Mock

        with patch.dict(
            "os.environ", {"GROQ_API_KEY": "test-key", "GROQ_MODEL": "test-model"}
        ):
            with patch(
                "cleaning.services.llm.requests.post",
                return_value=Mock(
                    status_code=200,
                    json=lambda: {
                        "choices": [{"message": {"content": '{"items":[]}'}}]
                    },
                ),
            ) as request:
                llm.call(
                    "Return suggestions.", {"values": [{"id": "v0", "value": "AU"}]}
                )
                payload = request.call_args.kwargs["json"]
                self.assertIn("JSON", payload["messages"][0]["content"])
                self.assertEqual(payload["response_format"], {"type": "json_object"})
                self.assertLess(payload["max_completion_tokens"], 2048)


class ExportRowTests(TestCase):
    def test_xlsx_preserves_fully_blank_trailing_rows(self):
        raw, _ = files.export(
            {"headers": ["Age"], "rows": [[None], ["0"], ["NA"], [None]]}, "xlsx"
        )
        sheet = openpyxl.load_workbook(io.BytesIO(raw)).active
        self.assertEqual(sheet.max_row, 5)
        self.assertIsNone(sheet["A2"].value)
        self.assertIsNone(sheet["A5"].value)
        self.assertEqual(sheet["A3"].value, "0")
