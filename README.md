# RegexGenie V1.10

Natural-language spreadsheet cleaning with React, Django and Groq. Upload → describe → review → apply → download. The English UI follows the warm-white, navy, green Original and purple Preview design specification.

## Showcase

This video demonstrates text replacement, value standardisation, and missing-value recognition using a 10,000-row spreadsheet sample.

https://github.com/user-attachments/assets/60bbcf54-ed21-44b9-a840-c3f624f1ddae

## Features

- UTF-8 CSV and standard XLSX up to 10 MB; single-sheet selection, 50-row pagination, immutable original parsed data.
- Real Groq planning for regex replacements. A single instruction includes the exact replacement or explicitly requests removal. Missing or conflicting replacements ask for clarification. Literal replacement semantics; match highlighting and navigation; strict validation and timed execution.
- Separate Preview, Apply and Download; revision checks, high-impact confirmation, single Undo, Reset and continued cleaning.
- Semantic value normalisation and missing-marker recognition in one text column. Exact-value scope selection, search, budgets, explicit per-task consent, Keep by default, individual review and safe bulk selection.
- Session ownership, CSRF, temporary private snapshots, worker polling, bounded files/regex/LLM requests and structured errors. Original uploads are never overwritten.
- Single-table CSV/XLSX export. Unchanged XLSX numbers, dates, booleans and strings retain their basic types. Missing values are internal null and export as blanks.

## V1.10 interaction update

- Describe what to change in one instruction; the separate replacement panel appears only when clarification is needed. The resolved literal replacement is visible before Apply. The V1.9 explicit action/replacement API remains compatible.
- Small semantic-cleaning scopes are summarised with an expandable exact-value list and an unchecked consent box. Over-budget columns retain searchable scope selection. Changing scope clears consent.
- Semantic and missing-value suggestions start at Keep. Check Apply per suggestion or select all eligible suggestions; ambiguous items require individual selection. Batch buttons retain a visible, accessible pressed state; Keep all restores the unchanged preview.
- Original and Preview show the exact selected changes before Apply, including repeated values and pagination. Download always exports the last applied data.
- Updated landing copy explains upload, describe, and review/download. Questionnaire topic analysis is outside this release.

Public testing: open **https://regexgenie.onrender.com/app** or use **Try Sample Data** on the homepage. No account or local installation is required. Temporary files may disappear on restart; download results promptly.

## Local setup

Requires Python 3.11+ and Node 22+. From the project directory:

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
npm ci
cp backend/.env.example backend/.env
```

Edit `backend/.env`: set a random `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=1`, and a valid backend-only `GROQ_API_KEY` and `GROQ_MODEL`. Select a currently available Groq text model supporting JSON object responses. No fixed pattern or fake AI fallback is used. Without model configuration, uploads, previews of existing data and exports work; AI tasks report configuration errors.

```sh
sh scripts/dev.sh
```

Open **http://127.0.0.1:8019**. The script builds React, migrates SQLite and starts Django plus a single worker. `PORT` overrides the local port. Restart after source changes. To develop React with Vite, run Django on port 8000 and `npm run dev` separately; include the Vite origin in `DJANGO_CSRF_ORIGINS`.

For manual startup, export the variables from backend/.env, then run `python manage.py worker` and `python manage.py runserver` in separate backend shells. A worker is required; web requests only enqueue jobs.

## Verification

```sh
DJANGO_SECRET_KEY=test-only .venv/bin/python backend/manage.py test cleaning core
npm test
npm run test:ui
npm run build
```

For explicit real-Groq public acceptance using synthetic data (consumes the configured provider quota):

```sh
.venv/bin/python scripts/verify_live_v19.py
```

The original V1.5 models, migration, APIs and tests are retained. `cleaning` adds four models and the V1.9 routes. `frontend/legacy-v15.jsx` is retained solely for the existing regression tests, and is not shipped in the V1.9 browser bundle. See [validation](docs/VALIDATION_V1.9.md) for results and limits; fixture tests do not substitute for real-model acceptance.

## Three demos

Click **Try Sample Data** to load synthetic customers into the real workspace.

1. `Find email addresses in the Email column and replace them with 'REDACTED'.` → Generate preview → inspect matched text → Apply changes → download. Also try phone digits, order IDs or punctuation on your own synthetic CSV.
2. `Standardise Country values to full English country names` → select AU/AUS/australia/WA → explicitly approve sharing → review suggestions. Keep ambiguous WA or approve it individually; bulk selection excludes Needs Review.
3. `Identify missing-value markers in the Age column` → select and approve sharing → review N/A, Not provided, 0 and NA. Apply only approved markers as missing. 0/000/NA/- are guarded as uncertain or valid.

## Data and privacy limits

- Maximum 10,000 data rows, 50 columns and 250,000 cells; XLSX decompression bounded at 50 MB, 2,000 ZIP members and 20 sheets. Simple rectangular tables and one header row only. Unsupported encodings, legacy XLS, merged reports and password-protected workbooks need conversion.
- Regex planning sends only instruction and column IDs/names. P1 sends only selected exact values and temporary IDs after consent, never row frequencies or neighbouring cells. The instruction and column names may themselves be sensitive. Approved mapping history remains local.
- Per P1 task: at most 200 distinct nonempty values, 4,000 characters each and 40,000 total. Select a subset when over budget; unselected values remain unchanged. No automatic filling of facts.
- Files are temporary. Download promptly. Expiry cleanup targets 30 minutes; restarts may interrupt tasks or lose data earlier. No account, durable queue, redo or unlimited history.
- Export contains only the selected table. Other sheets, formulas, styling and display formats are not preserved. Formulas use last cached values on import; absent caches become blank. CSV cannot preserve null versus empty-string identity. Formula-like CSV text is prefixed with an apostrophe for safety; XLSX strings are explicitly typed as text.
- A single web process and single managed worker are required for this SQLite deployment. Worker restart marks interrupted queued/running jobs failed. Logs exclude prompts, values, AI responses and keys.

## Deployment

`Dockerfile` builds React and serves it from Django/WhiteNoise. `render.yaml` declares a single free web service named RegexGenie, with generated Django secret and server-side Groq configuration. The public app is deployed at **https://regexgenie.onrender.com**. The Render service uses the repository main branch; check docs/VALIDATION_V1.9.md for the acceptance record.

```sh
docker build -t regexgenie .
docker run --rm -p 10000:10000 --env-file backend/.env regexgenie
```

For production set `DJANGO_DEBUG=0`, appropriate `DJANGO_ALLOWED_HOSTS`, HTTPS `DJANGO_CSRF_ORIGINS`, `GROQ_API_KEY`, `GROQ_MODEL`, `DATABASE_PATH=/tmp/regexgenie.sqlite3`, and `WORKSPACE_DIR=/tmp/regexgenie-workspaces`. Render hostname is included automatically. Secure session/CSRF cookies require HTTPS. Do not use development settings publicly.

Connect the GitHub branch to the existing RegexGenie Render service, configure the variables, deploy and verify `/api/health/`. Before public release verify current Render free-tier terms, cold start, worker restart, session isolation, and all three real-Groq upload-to-download flows from a fresh browser. The authenticated browser connection supports this repository and Render service; no credentials are committed. Free instances may take 50 seconds or longer to wake.

## Architecture

`backend/core/` preserves V1.5. `backend/cleaning/models.py` defines Workspace, UploadedFile, CleaningJob and CleaningSuggestion. `services/files.py` parses and snapshots typed data; `services/llm.py` calls Groq and validates complete schemas; `services/jobs.py` stages plans and diffs; `views.py` enforces ownership and versioned application; `management/commands/worker.py` processes jobs and cleans temporary state. `frontend/main.jsx` implements Landing and Workspace; `style.css` contains shared responsive tokens and styling.

The Groq adapter follows [Groq API compatibility](https://console.groq.com/docs/openai) and [JSON output documentation](https://console.groq.com/docs/structured-outputs), with server-side schema validation regardless of model response mode.
