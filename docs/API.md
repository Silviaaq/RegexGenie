# RegexGenie API

Same-origin `/api`, session cookies, JSON responses. GET `/config` first to set
CSRF/session cookies. Every unsafe request sends `X-CSRFToken` from `csrftoken`.
Only upload uses multipart; other mutations use JSON. All data is session-owned.

| Method | Path | Contract |
|---|---|---|
| GET | /health | Liveness only; does not confirm model credentials |
| GET | /config | Limits and model_ready (presence, not validation, of env vars) |
| POST | /datasets | multipart file → dataset_id, sheet names, expires_at |
| POST | /datasets/{id}/select-sheet | sheet_id → headers, first 50 rows, row_count, dataset_version |
| GET | /datasets/{id}/rows | sheet_id, offset, limit → original page |
| POST | /transformations | dataset_id, sheet_id, dataset_version, instruction, optional replacement → frozen result and initial page |
| GET | /transformations/{id} | Result metadata, plan, interpretation, counts |
| GET | /transformations/{id}/rows | offset, limit → original, processed, page matches |
| GET | /transformations/{id}/targets/{ordinal} | 1-based match ordinal → zero-based row/column and offsets |
| GET | /transformations/{id}/download | format=csv or xlsx → full selected sheet |
| DELETE | /datasets/{id} | Delete data plus all derived results |

Generation is synchronous (up to approximately 60 seconds); `ready` is the only
persisted result state. The UI shows generating and disables repeat submission.
An asynchronous job queue is not part of this release.

Plan example:

```json
{"operation":"regex_replace","column_id":"c1","pattern":"[0-9]+","flags":[],"replacement":"X"}
```

Only `i`, `m`, `s` flags; literal replacement; empty string explicitly allowed.
Missing replacement is different from empty replacement. The server validates
schema and emits English interpretation from the validated plan, not model prose.

Errors include `code`, English `message` and `retryable`; processing errors include
`request_id`; rate errors add `retry_after_seconds`. Typical status codes: 400 bad
payload, 403 CSRF, 404 unavailable/foreign/cleaned ID, 410 expired during execution,
413 upload limit, 422 invalid file/rule, 429 rate/busy limit, 503 model configuration,
504 timeout. No raw provider response, file content or stack trace is exposed.
An already-cleaned expired resource returns 404 with a re-upload instruction.
