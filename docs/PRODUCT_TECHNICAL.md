# RegexGenie — product and technical specification

## Purpose and scope

Replace regex-matched fragments in one named text column using a natural-language
instruction. The workflow is upload → instruct → review → download. The React UI
is entirely English, including backend-generated explanations and error messages.
Uploaded filenames, header names and cell content retain their original language.

P0: CSV/XLSX upload, sheet selection, original preview, arbitrary instructions,
optional literal replacement, explicit deletion, Groq planning, immutable original,
comparison, all-row CSV/XLSX download, session isolation, expiration and deletion.
Implemented navigation additionally supports fetching a specific match and page.
Out of scope: row/column assignments, all-column operations, multistep pipelines,
accounts, history, permanent files, macro execution and large-file processing.

## Components

- React `frontend/main.jsx`: request state, upload, paged tables, rule view and export.
- `frontend/data.js`: synthetic sample and example instruction text only.
- Django `core/views.py`: same-origin session/CSRF API and frozen transformation IDs.
- `core/engine.py`: parsing, schema validation, Groq adapter, subprocess deadlines,
  literal replacement, match indexing and safe export.
- `Dataset`: UUID, session owner, filename, checksum, parsed sheets and expiry.
- `Transformation`: UUID, parent dataset, selected sheet, frozen plan/result/index.
- WhiteNoise serves built frontend assets. Gunicorn uses one worker/two threads.
- Disposable SQLite and process-local cache; no external database or paid storage.

## Execution contract

Groq receives system instructions plus a JSON user payload of instruction,
replacement override, column IDs/names and row count. No cells are transmitted.
The only executable output is a validated `regex_replace` JSON plan. Unsupported
requests must yield `unsupported`. The model does not write Python or mutate data.
No exact example matching, hardcoded email fallback, or paid-provider fallback.

Column references must identify an existing named column. Blank headers cannot be
targeted. Schema validation checks field types, unknown keys, flag allowlist,
replacement length, pattern length and conservative regex syntax restrictions.
A model can still misunderstand intent; interpretation, read-only rule and preview
exist so the user can review the actual plan. Live evaluation is required.

Parsing has a 15-second subprocess deadline, planning a 30-second deadline, and
regex execution a 30-second deadline. The model gets at most two repair attempts.
Regex output is capped at 8 Mi characters in changed-column values and 100,000
fragments. A timed-out worker is terminated and cannot publish partial results.

## Data consistency

Original parsed data is immutable. Every generation starts from it. Only completed
results are stored, inside a transaction checking the parent still exists and has
not expired. Downloads refer to that result, never rerun the model. Deletion cascades
to all transformations. New sheets/files invalidate frontend results. Pages are 50
rows; the API permits up to 500. Offsets returned by Python are Unicode code points;
React maps them to UTF-16 indices before slicing.

Matches counts fragments, changed_cells counts unequal values, affected_rows counts
rows with changes. Replacing a fragment with itself counts as a match but not a
change. Zero-width matches are ignored. Empty replacement shows a preview-only ∅.

## Lifetime and budget

The product makes no retention promise. Internal cleanup expiry is 30 minutes from
upload, not refreshed by previews or downloads. A startup cleanup loop and request
cleanup remove expired data; delete removes it early. Render's local filesystem
can disappear on sleep/restart/redeploy. Export immediately. No backup is configured.

Render deployment uses one Free Docker web service, with no disk or database
resources. Check the actual proposed plan in Render. Provider free quotas and
model availability are account-dependent; no guaranteed zero-cost SLA is claimed.

## Acceptance

The current automated suite checks real parsing, execution, export and API isolation
with a mocked model boundary, plus React interactions using mocked HTTP. See
VALIDATION.md for precise results and limits. The final release still requires a
real Groq run, Docker/Render build, full browser review and public URL acceptance.
