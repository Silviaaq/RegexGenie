# RegexGenie

A focused React + Django app for **Regex Pattern Matching and Replacement**.
Upload CSV or Excel, describe a pattern in one named column, review the original
and replacement side by side, then download the complete result.

Every instruction—including examples—uses Groq. Examples only fill the text box.
There is no fixed instruction whitelist or offline fallback pretending to be AI.
All application-owned UI text is English; uploaded content is preserved.

## Status

Core implementation and automated tests are included. Real Groq evaluation and
public Render acceptance are **pending environment configuration and deployment**.
Creating accounts does not itself connect them to the application. No public URL
is claimed in this repository until a full live test has passed.

## Local setup

Requirements: Python 3.12 and Node 22.

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
npm ci
cp backend/.env.example backend/.env
```

Edit `backend/.env` locally: set `GROQ_API_KEY`, an available `GROQ_MODEL`, and a
random `DJANGO_SECRET_KEY`. Generate the latter locally with:

```sh
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Do not send keys in chat or commit `.env`. Shell-load the file after editing:

```sh
set -a
. backend/.env
set +a
python backend/manage.py migrate
npm run build
python backend/manage.py runserver 127.0.0.1:8000
```

Open http://127.0.0.1:8000. Django serves the built React app and same-origin API.
For frontend development, keep Django running and use `npm run dev` in a second
terminal; Vite proxies `/api` to port 8000. Local development can run without Groq
credentials to test upload; generation then returns a clear configuration error.

## Render: one free web service

1. Push the source to https://github.com/Silviaaq/RegexGenie.
2. In Render create a **Web Service** from this repository, runtime **Docker**,
   root directory repository root, instance **Free**. Do not create a static site,
   persistent disk, or database. Alternatively use `render.yaml` as a Blueprint
   and check that the proposed service remains Free before applying it.
3. Set `GROQ_API_KEY`, `GROQ_MODEL`, `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=0`, and
   `DATABASE_PATH=/tmp/regexgenie.sqlite3`. The Blueprint generates a Django secret.
   Keys belong only in Render's secret environment configuration.
4. Render provides `PORT` and `RENDER_EXTERNAL_HOSTNAME`; settings derive allowed
   hosts and the HTTPS CSRF origin from that hostname. For a custom domain,
   explicitly set `DJANGO_ALLOWED_HOSTS` and `DJANGO_CSRF_ORIGINS` too.
5. The Docker image builds React, installs Django, migrates disposable SQLite,
   starts a cleanup loop, and runs Gunicorn. Health check: `/api/health`.
6. Open the Render URL and test your own CSV plus a previously unseen instruction;
   verify both downloaded formats contain all rows. Follow `docs/VALIDATION.md`.

The Docker build is included in GitHub Actions. It could not be run in the
current authoring environment because Docker is unavailable. Do not mark public
acceptance complete until the actual Render build and live workflow pass.

Free hosting may sleep and lose temporary local data when sleeping, restarting,
or redeploying. No permanent storage or 24-hour retention is promised. Provider
quotas can suspend the service; no paid fallback is configured. Verify the plan
shown in your account before deploying.

## Tests and live model evaluation

```sh
npm test
npm run test:ui
npm run build
DJANGO_SECRET_KEY=test-only python backend/manage.py test core --noinput
```

API tests mock the model boundary and execute real parsing/replacement/export.
UI tests use jsdom and mock HTTP responses; they are not full browser acceptance.
For an explicit live check using your locally configured Groq credentials:

```sh
python scripts/evaluate_model.py --limit 1
python scripts/evaluate_model.py --limit 30 --delay 15
```

This sends synthetic instructions/column metadata to Groq and consumes its quota.
It checks processed values rather than exact regex strings and records model ID,
time, pass/fail and latency in `eval/latest.json`. The 30-case suite is provided;
no real-model score is claimed until that command is run.

## Product and data boundaries

- CSV (UTF-8 with optional BOM) or `.xlsx`; at most 2 MB, 5,000 data rows, 50 columns.
- One file, one selected sheet, one regex replacement in one named column per run.
- Leading zeros in text, literal NA/NULL, empty cells and surrounding text remain.
  Excel numeric values with display-only leading zeros cannot recover those zeros.
- XLSX imports cached formula values, never executes formulas; missing caches become
  empty with a warning. No merged cells, macros, or password-protected workbooks.
  Maximum 20 sheets / 500,000 allocated cells per workbook / 25 MB expanded archive;
  remove unused formatted ranges if a sheet exceeds its dimension limit.
- Downloads include the entire selected sheet. Excel exports plain text values,
  not original formulas, formatting, types or other sheets. CSV escapes formula-like
  prefixes; prefer Excel when exact literal values are required.
- Optional replacement overrides instruction replacement. Explicit empty text
  removes matches. Replacement backslashes and `$1` are literal, not group references.
- New previews always start from original values. A download uses a frozen result ID.
- Pages contain 50 rows. Navigation fetches the match location and required page,
  with Unicode-aware highlights and synchronized table scrolling.
- Row/column assignment, multiple operations, all-column matching and semantic
  transformations are outside this release.

## Temporary data and security

Django owns parsing/execution. Only instruction, replacement, named column IDs and
names, and row count go to Groq; cell contents do not. Instructions and names can
still contain sensitive data, so users should avoid including it.

Anonymous server sessions isolate resources. Mutations require CSRF protection.
HTTPS production cookies are Secure/HttpOnly/SameSite=Lax. API responses are no-store;
React renders cell values as text. Regex and parsing run in killable subprocesses.
Each session can make five generation requests/minute, keep five files and ten
previews/file; use a **single Gunicorn worker**, since limits use process-local cache.
The limiter is not a substitute for edge abuse protection on a large public service.

Files have a 30-minute internal expiry, cleaned on API access and every minute by
the container cleanup loop. This is a maximum processing window, not guaranteed
availability. Use Delete File & Results for early deletion. Export does not extend
expiry. SQLite uses secure deletion; no application backups are configured. Platform
replicas/logging policies are not a guarantee of forensic erasure.

> Files are temporary. Download your results promptly. You may need to upload again
> if the service sleeps or restarts.

See [Product and architecture](docs/PRODUCT_TECHNICAL.md),
[API](docs/API.md), [UI](docs/UI_SPEC.md), and [Validation](docs/VALIDATION.md).
