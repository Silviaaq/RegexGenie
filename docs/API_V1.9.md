# Workspace API

All mutation requests require session cookies and X-CSRFToken. GET `/api/config` initializes the CSRF cookie and reports model configuration. Errors retain the compatible V1.5 `{code,message,retryable}` shape.

- POST `/api/workspaces/`: create an anonymous workspace.
- POST `/api/workspaces/{id}/upload/`: multipart `file`, optional `sheet`. Multi-sheet XLSX first returns `choose_sheet`; resubmit selected sheet. Existing successful data is replaced only on successful parse.
- GET `/api/workspaces/{id}/data/?page=1&job_id=...`: current or staged preview, 50 rows, paired `before`, stable positional column IDs and row offset.
- POST `/api/workspaces/{id}/jobs/`: instruction, action replace/remove, replacement_value, base_revision. Returns 202.
- GET `/api/jobs/{id}/`: poll queued/running/needs_input/awaiting_consent/ready/failed/applied/cancelled.
- POST `/api/jobs/{id}/`: resolve needs_input with target_column_id/replacement_value/base_revision, or cancel with action=cancel.
- GET `/api/workspaces/{id}/values/?column_id=c0&page=1&q=...`: local exact-value scope search, occurrence counts and scope hash.
- POST `/api/jobs/{id}/scope-consent/`: approved, selected_value_ids, scope_hash, base_revision. false cancels without external value sharing.
- GET `/api/jobs/{id}/suggestions/`: all bounded suggestions (max 200) for review and safe bulk selection.
- POST `/api/jobs/{id}/apply/`: base_revision, plan_hash, selected_suggestion_ids, confirm_high_risk. Applies deterministic selected mappings or staged regex output. Zero changes creates no revision.
- POST `/api/workspaces/{id}/action/`: action undo/reset/remove_file, base_revision. Replacement file uses upload.
- GET `/api/workspaces/{id}/export/?format=csv|xlsx`: current successful snapshot only.

The legacy dataset/transformation endpoints remain compatible; the V1.9 UI uses workspace/job routes exclusively. Column IDs are c0/c1/etc. within the current source table. Duplicate names lead to a specific column-selection question.
