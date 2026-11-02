import requests, time, json, io, sys
from pathlib import Path
import openpyxl

BASE = "https://regexgenie.onrender.com/api/"
reports = []
if len(sys.argv) > 1 and sys.argv[1] == "p1":
    prior = Path(__file__).resolve().parent.parent / "docs/LIVE_ACCEPTANCE.json"
    if prior.exists():
        reports = [
            x
            for x in json.loads(prior.read_text())["results"]
            if x.get("operation") == "regex_replace" and x["status"] == "passed"
        ]


def run_case(
    name,
    content,
    instruction,
    replacement=None,
    operation="regex_replace",
    expected=None,
):
    s = requests.Session()
    r = s.get(BASE + "config", timeout=90)
    r.raise_for_status()
    s.headers["X-CSRFToken"] = s.cookies.get("csrftoken", "")
    s.headers["Referer"] = "https://regexgenie.onrender.com/"

    def get(path):
        r = s.get(BASE + path, timeout=90)
        r.raise_for_status()
        return r.json()

    def post(path, payload=None, **kw):
        r = s.post(BASE + path, json=payload, timeout=90, **kw)
        if not r.ok:
            raise RuntimeError(f"{r.status_code}: {r.text[:600]}")
        return r.json()

    w = post("workspaces/", {})
    w = post(
        f"workspaces/{w['workspace_id']}/upload/",
        files={"file": ("acceptance.csv", content, "text/csv")},
    )
    wid = w["workspace_id"]
    revision = w["revision"]
    j = post(
        f"workspaces/{wid}/jobs/",
        {
            "instruction": instruction,
            "action": "replace",
            "replacement_value": replacement,
            "base_revision": revision,
        },
    )

    def poll():
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            state = get(f"jobs/{j['job_id']}/")
            if state["status"] not in ("queued", "running"):
                return state
            time.sleep(1)
        raise RuntimeError("Worker deadline exceeded")

    state = poll()
    if operation != "regex_replace":
        assert state["status"] == "awaiting_consent", state
        values = get(f"workspaces/{wid}/values/?column_id=" + state["target_column_id"])
        post(
            f"jobs/{j['job_id']}/scope-consent/",
            {
                "approved": True,
                "selected_value_ids": [v["id"] for v in values["items"]],
                "scope_hash": state["scope_hash"],
                "base_revision": revision,
            },
        )
        state = poll()
    assert state["status"] == "ready", state
    assert state["operation"] == operation, state
    original = get(f"workspaces/{wid}/data/")
    ids = []
    suggestions = []
    if operation != "regex_replace":
        suggestions = get(f"jobs/{j['job_id']}/suggestions/")["items"]
        print(json.dumps({"review_case": name, "suggestions": suggestions}), flush=True)
        assert all(not x["selected"] for x in suggestions)
        ids = [
            x["id"]
            for x in suggestions
            if x["ai_status"]
            == ("missing" if operation == "normalise_missing" else "proposed")
        ]
        assert ids, "No eligible suggestions"
    result = post(
        f"jobs/{j['job_id']}/apply/",
        {
            "base_revision": revision,
            "plan_hash": state["plan_hash"],
            "selected_suggestion_ids": ids,
            "confirm_high_risk": True,
        },
    )
    assert result["status"] == "applied", result
    final = get(f"workspaces/{wid}/data/")
    if expected is not None:
        assert final["rows"] == expected, final["rows"]
    if operation == "normalise_values":
        assert (
            final["rows"][0][0] == "Australia" and final["rows"][1][0] == "Australia"
        ), final["rows"]
    if operation == "normalise_missing":
        assert (
            final["rows"][0][0] is None
            and final["rows"][1][0] == "0"
            and final["rows"][2][0] == "NA"
        ), final["rows"]
    exported = s.get(BASE + f"workspaces/{wid}/export/?format=xlsx", timeout=90)
    exported.raise_for_status()
    workbook = openpyxl.load_workbook(io.BytesIO(exported.content))
    assert workbook.active.max_row == len(final["rows"]) + 1
    csv = s.get(BASE + f"workspaces/{wid}/export/?format=csv", timeout=90)
    csv.raise_for_status()
    result = {
        "case": name,
        "status": "passed",
        "operation": operation,
        "rows": len(final["rows"]),
        "changed_rows": result.get("changed_rows"),
        "csv_export": True,
        "xlsx_export": True,
        "suggestions": [
            {
                "original": x["original"],
                "proposed": x["proposed"],
                "status": x["ai_status"],
            }
            for x in suggestions
        ],
    }
    print(json.dumps(result), flush=True)
    reports.append(result)


cases = [
    (
        "email",
        b"Email,Code\na@example.com,001\nb@example.org,002\n",
        "Find email addresses in the Email column",
        "REDACTED",
        "regex_replace",
        [["REDACTED", "001"], ["REDACTED", "002"]],
    ),
    (
        "phone",
        b"Phone\nCall 0412-345-678 today\n",
        "Find Australian phone numbers in the Phone column",
        "PHONE",
        "regex_replace",
        [["Call PHONE today"]],
    ),
    (
        "order",
        b"Order\nOrder ORD-12345 confirmed\n",
        "Find order identifiers beginning ORD- followed by digits in the Order column",
        "ORDER",
        "regex_replace",
        [["Order ORDER confirmed"]],
    ),
    (
        "digits",
        b"Code\nItem 123 ready\n",
        "Find digit sequences in the Code column",
        "#",
        "regex_replace",
        [["Item # ready"]],
    ),
    (
        "country",
        b"Country\nAU\nAUS\nWA\n",
        "Standardise Country values to full English country names",
        None,
        "normalise_values",
        None,
    ),
    (
        "missing",
        b"Age\nN/A\n0\nNA\nNot provided\n",
        "Identify missing-value markers in the Age column",
        None,
        "normalise_missing",
        None,
    ),
]
if len(sys.argv) > 1 and sys.argv[1] == "p1":
    cases = cases[-2:]
for case in cases:
    try:
        run_case(*case)
    except Exception as e:
        report = {"case": case[0], "status": "failed", "error": str(e)}
        print(json.dumps(report), flush=True)
        reports.append(report)
(Path(__file__).resolve().parent.parent / "docs/LIVE_ACCEPTANCE.json").write_text(
    json.dumps({"url": BASE, "results": reports}, indent=2)
)
if any(x["status"] != "passed" for x in reports):
    sys.exit(1)
