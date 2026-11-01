# Verification record — 2026-11-01

## Completed

- Django: 22 automated tests passed, including built HTML and static asset serving. Coverage includes actual
  CSV/XLSX parsing, full CSV/XLSX exports, arbitrary instructions reaching the model
  adapter, no cell-data transmission, malformed-model repair, provider 429, missing
  configuration, substring replacement, literal replacement, deletion, zero matches,
  Unicode, limits, regex timeout, API paging/navigation, ownership, expiry and CSRF.
- Node: 2 utility/example-contract tests passed.
- Vite production build passed.

## Frontend verification

- React/jsdom: 4 workflow tests passed: arbitrary instruction submission, first
  match beyond the initial page with synchronized scrolling and edit, zero-match
  download choices, explicit deletion, and missing-model recovery (some scenarios
  share a test).
- Final Vite production build passed.
- Django model migration drift check passed.
- Total: 28 automated tests passed (22 Django + 2 Node + 4 React).

Tests with mocked HTTP/LLM do not establish real model accuracy or public deployment
availability. Static asset verification caught and fixed a WhiteNoise path issue.

## Environment limits and remaining acceptance

- No Groq key is available to this execution environment. 30 synthetic live cases
  and a runner are supplied in eval/ and scripts/evaluate_model.py; NOT RUN.
- Docker is unavailable here; Dockerfile must pass the supplied CI build/Render.
- Managed browser preview cannot run the Python virtual environment, so actual
  browser screenshot, layout, keyboard and mobile verification are NOT RUN.
- GitHub and Render account connections are not yet confirmed. No source push or
  public deployment is claimed.

## Public acceptance checklist

1. Confirm Free service and no additional billable resources before provisioning.
2. Configure secret env vars; check /api/config reports model_ready=true (presence
   only), then successfully generate a result (actual credential/model validation).
3. Upload your own CSV with IDs 001/002, blank fields, Unicode, multiline text and
   two emails in one cell; use a new instruction, not an exact example.
4. Review English interpretation, rule and changed cells. Change replacement to an
   empty string and verify ∅ is display-only. Test a zero-match pattern and 0/0.
5. Use >50 rows with first match after row 100; verify match and page navigation,
   synchronized scrolling, matching row heights and both entire-file downloads.
6. Upload a two-sheet XLSX and select the second sheet; export only that sheet.
7. Delete, try another session, simulate expiry and refresh after a service restart.
8. Verify specific errors for >2 MB, unsupported input, unknown column, provider
   quota and timeout; ensure repeated clicks do not create duplicate generation.
9. Run live evaluation; record model ID, actual pass rate and failure categories.
10. Confirm English application text on desktop and mobile. Add working Render URL
    to README only after complete end-to-end acceptance.
