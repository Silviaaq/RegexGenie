import hashlib, uuid, copy
from datetime import timedelta
from django.http import JsonResponse, HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.db import transaction
from django.core.cache import cache
from core.views import endpoint, body
from core.engine import AppError, isolated
from .models import Workspace, UploadedFile, CleaningJob, CleaningSuggestion
from .services import files, jobs


def owner(r):
    return hashlib.sha256(r.session.session_key.encode()).hexdigest()


def workspace(r, id):
    w = Workspace.objects.filter(pk=id, session_key_hash=owner(r)).first()
    if not w:
        raise AppError(
            "This workspace is unavailable. Upload your file again.", "NOT_FOUND", 404
        )
    if w.expires_at <= timezone.now():
        raise AppError(
            "This workspace expired. Please upload your file again.",
            "EXPIRED_WORKSPACE",
            410,
        )
    return w


def job(r, id):
    j = (
        CleaningJob.objects.filter(pk=id, workspace__session_key_hash=owner(r))
        .select_related("workspace")
        .first()
    )
    if not j:
        raise AppError("This task is unavailable.", "NOT_FOUND", 404)
    workspace(r, j.workspace_id)
    return j


def revision(w, b):
    if type(b.get("base_revision")) is not int or b["base_revision"] != w.revision:
        raise AppError(
            "Your data changed in another tab. Refresh the preview.",
            "STALE_REVISION",
            409,
        )


def info(w):
    f = w.uploaded_file.first()
    return {
        "workspace_id": str(w.id),
        "revision": w.revision,
        "can_undo": bool(w.previous_path),
        "file": (
            {
                "name": f.original_name,
                "sheet": f.sheet_name,
                "row_count": f.row_count,
                "columns": f.columns_json,
            }
            if f
            else None
        ),
    }


@endpoint(["POST"])
@ensure_csrf_cookie
def create(r):
    if Workspace.objects.filter(session_key_hash=owner(r)).count() >= 5:
        raise AppError(
            "Remove an existing workspace before creating another.",
            "LIMIT_EXCEEDED",
            429,
        )
    w = Workspace.objects.create(
        session_key_hash=owner(r), expires_at=timezone.now() + timedelta(minutes=30)
    )
    return JsonResponse(info(w))


@endpoint(["POST"])
def upload(r, id):
    w = workspace(r, id)
    f = r.FILES.get("file")
    if not f:
        raise AppError("Choose a file.", "INVALID_REQUEST", 400)
    if f.size > files.MAX_BYTES:
        raise AppError("Upload a file of at most 10 MB.", "FILE_TOO_LARGE", 413)
    raw = f.read()
    data, sheets, sheet = isolated(files.parse, (f.name, raw, r.POST.get("sheet")), 20)
    if data is None:
        return JsonResponse({"status": "choose_sheet", "sheets": sheets})
    path = files.snapshot(data)
    with transaction.atomic():
        updated = Workspace.objects.filter(pk=w.pk, revision=w.revision).update(
            original_path=path,
            current_path=path,
            previous_path=None,
            revision=w.revision + 1,
            status="ready",
            last_applied_job_id=None,
        )
        if not updated:
            raise AppError(
                "Your workspace changed. Upload again.", "STALE_REVISION", 409
            )
        w.uploaded_file.all().delete()
        w.jobs.exclude(status__in=["failed", "cancelled"]).update(status="cancelled")
        UploadedFile.objects.create(
            workspace=w,
            original_name=f.name[:255],
            format="csv" if sheet == "CSV" else "xlsx",
            storage_path=path,
            sha256=hashlib.sha256(raw).hexdigest(),
            sheet_name=sheet,
            columns_json=[
                {"id": f"c{i}", "name": h} for i, h in enumerate(data["headers"])
            ],
            row_count=len(data["rows"]),
            column_count=len(data["headers"]),
        )
    w.refresh_from_db()
    return JsonResponse(info(w))


@endpoint(["GET"])
def data(r, id):
    w = workspace(r, id)
    d = files.read(w.current_path)
    before = d
    jid = r.GET.get("job_id")
    if jid:
        j = job(r, jid)
        if j.workspace_id != w.id:
            raise AppError("Task unavailable.", "NOT_FOUND", 404)
        if j.base_revision != w.revision and j.status != "applied":
            raise AppError("Refresh this preview.", "STALE_REVISION", 409)
        if j.status == "applied":
            before = files.read(w.previous_path) if w.previous_path else d
        elif j.status == "ready" and j.result_path:
            d = files.read(j.result_path)
    page = max(1, int(r.GET.get("page", 1)))
    offset = (page - 1) * 50
    return JsonResponse(
        {
            **info(w),
            "headers": d["headers"],
            "rows": d["rows"][offset : offset + 50],
            "before": before["rows"][offset : offset + 50],
            "row_count": len(d["rows"]),
            "page": page,
            "offset": offset,
        }
    )


@endpoint(["POST"])
def submit(r, id):
    w = workspace(r, id)
    files.read(w.current_path)
    b = body(r)
    revision(w, b)
    ins = b.get("instruction")
    if not isinstance(ins, str) or not ins.strip() or len(ins) > 2000:
        raise AppError(
            "Enter one instruction of up to 2,000 characters.", "INVALID_REQUEST", 400
        )
    action = b.get("action", "replace" if "replacement_value" in b else None)
    replacement = b.get("replacement_value")
    if action not in (None, "replace", "remove") or (
        replacement is not None
        and (not isinstance(replacement, str) or len(replacement) > 2000)
    ):
        raise AppError("Check the replacement fields.", "INVALID_REQUEST", 400)
    import time

    rate_key = "cleaning-rate:" + owner(r)
    recent = [t for t in cache.get(rate_key, []) if t > time.time() - 60]
    if len(recent) >= 5:
        raise AppError(
            "You have made five requests this minute. Wait and try again.",
            "LLM_RATE_LIMITED",
            429,
        )
    cache.set(rate_key, recent + [time.time()], timeout=60)
    if not cache.add("job-rate:" + str(w.id), True, timeout=2):
        raise AppError(
            "Wait before generating another preview.", "LLM_RATE_LIMITED", 429
        )
    if w.jobs.filter(status__in=["queued", "running"]).exists():
        raise AppError("A task is already running.", "LLM_RATE_LIMITED", 429)
    if w.jobs.count() >= 30:
        raise AppError(
            "This workspace has reached 30 tasks. Download and upload again.",
            "LIMIT_EXCEEDED",
            429,
        )
    j = CleaningJob.objects.create(
        workspace=w,
        base_revision=w.revision,
        instruction=ins,
        action=action,
        replacement_value=replacement,
    )
    return JsonResponse({"job_id": str(j.id), "status": "queued"}, status=202)


@endpoint(["GET", "POST"])
def status(r, id):
    j = job(r, id)
    if r.method == "POST":
        b = body(r)
        revision(j.workspace, b)
        if b.get("action") == "cancel":
            CleaningJob.objects.filter(
                pk=j.pk,
                status__in=[
                    "queued",
                    "running",
                    "needs_input",
                    "awaiting_consent",
                    "ready",
                ],
            ).update(status="cancelled")
        else:
            if j.status != "needs_input":
                raise AppError(
                    "This task is not waiting for input.", "INVALID_REQUEST", 409
                )
            cid = b.get("target_column_id", j.target_column_id)
            if cid not in [
                c["id"] for c in j.workspace.uploaded_file.first().columns_json
            ]:
                raise AppError("Choose a column.", "INVALID_TARGET")
            replacement = b.get("replacement_value", j.replacement_value)
            if replacement is not None and (
                not isinstance(replacement, str) or len(replacement) > 2000
            ):
                raise AppError(
                    "Use a replacement of up to 2,000 characters.", "INVALID_REQUEST"
                )
            j.target_column_id = cid
            action = b.get("action", j.action)
            if action not in (None, "replace", "remove"):
                raise AppError("Choose a valid replacement action.", "INVALID_REQUEST")
            j.action = action
            j.replacement_value = replacement
            j.status = "queued"
            j.save()
        j.refresh_from_db()
    return JsonResponse(
        {
            "job_id": str(j.id),
            "status": j.status,
            "operation": j.operation,
            "target_column_id": j.target_column_id,
            "plan": j.plan_json,
            "plan_hash": j.plan_hash,
            "impact": j.impact_json or {},
            "error_code": j.error_code,
            "base_revision": j.base_revision,
            "replacement_value": j.replacement_value,
            "action": j.action,
            "scope_hash": (j.scope_json or {}).get("scope_hash"),
        }
    )


@endpoint(["GET"])
def distinct(r, id):
    w = workspace(r, id)
    vs = jobs.values(files.read(w.current_path), r.GET["column_id"])
    q = r.GET.get("q", "").lower()
    page = max(1, int(r.GET.get("page", 1)))
    filtered = [v for v in vs if q in v["value"].lower()]
    within_budget = (len(vs) <= 200 and sum(len(v["value"]) for v in vs) <= 40000
                     and all(len(v["value"]) <= 4000 for v in vs))
    return JsonResponse(
        {
            "within_budget": within_budget,
            "all_items": vs if within_budget else [],
            "total_characters": sum(len(v["value"]) for v in vs),
            "items": filtered[(page - 1) * 50 : page * 50],
            "total": len(vs),
            "filtered_total": len(filtered),
            "scope_hash": jobs.digest([vs, w.revision]),
        }
    )


@endpoint(["POST"])
def consent(r, id):
    j = job(r, id)
    b = body(r)
    revision(j.workspace, b)
    if j.status != "awaiting_consent":
        raise AppError("This task is not awaiting consent.", "STALE_PLAN", 409)
    if b.get("approved") is not True:
        j.status = "cancelled"
        j.save()
        return JsonResponse({"status": "cancelled"})
    ids = b.get("selected_value_ids")
    vs = j.scope_json["values"]
    if (
        b.get("scope_hash") != j.scope_json["scope_hash"]
        or not isinstance(ids, list)
        or not ids
        or any(not isinstance(v, str) for v in ids)
        or len(set(ids)) != len(ids)
        or not set(ids).issubset({v["id"] for v in vs})
    ):
        raise AppError(
            "Select a valid scope and review consent again.", "INVALID_SCOPE"
        )
    chosen = [v for v in vs if v["id"] in ids]
    if (
        len(chosen) > 200
        or sum(len(v["value"]) for v in chosen) > 40000
        or any(len(v["value"]) > 4000 for v in chosen)
    ):
        raise AppError(
            "Select up to 200 values, 4,000 characters per value and 40,000 total characters.",
            "LIMIT_EXCEEDED",
        )
    if not CleaningJob.objects.filter(pk=j.pk, status="awaiting_consent").update(
        consent_json={
            "selected_value_ids": ids,
            "scope_hash": b["scope_hash"],
            "approved": True,
        },
        status="queued",
    ):
        raise AppError("Consent was already submitted.", "STALE_PLAN", 409)
    return JsonResponse({"status": "queued"})


@endpoint(["GET"])
def suggestions(r, id):
    j = job(r, id)
    items = [
        {
            "id": str(s.id),
            "original": s.original_value,
            "proposed": s.proposed_value,
            "ai_status": s.ai_status,
            "reason": s.reason,
            "occurrences": s.occurrences,
            "selected": s.selected,
        }
        for s in j.suggestions.all()
    ]
    return JsonResponse({"items": items, "total": len(items)})


@endpoint(["POST"])
def apply(r, id):
    j = job(r, id)
    w = j.workspace
    b = body(r)
    if j.status == "applied":
        return JsonResponse({"status": "applied", **info(w)})
    revision(w, b)
    if (
        j.base_revision != w.revision
        or j.status != "ready"
        or j.plan_hash != b.get("plan_hash")
    ):
        raise AppError(
            "This preview is outdated. Generate another preview.", "STALE_PLAN", 409
        )
    selected = []
    d = files.read(w.current_path)
    if j.operation == "regex_replace":
        if (
            j.impact_json["risk"]["requires_confirmation"]
            and b.get("confirm_high_risk") is not True
        ):
            raise AppError(
                "Review the flagged changes and confirm before applying.",
                "RISK_CONFIRMATION_REQUIRED",
                409,
            )
        result = files.read(j.result_path)
    else:
        ids = b.get("selected_suggestion_ids", [])
        if (
            not isinstance(ids, list)
            or any(not isinstance(x, str) for x in ids)
            or len(set(ids)) != len(ids)
        ):
            raise AppError("Choose valid suggestions.", "INVALID_REQUEST")
        selected = list(j.suggestions.filter(id__in=ids))
        if len(selected) != len(ids):
            raise AppError("Choose suggestions from this task only.", "INVALID_REQUEST")
        if any(s.ai_status in ("valid", "unchanged") for s in selected):
            raise AppError(
                "Unchanged or valid values cannot be selected.", "INVALID_REQUEST"
            )
        mappings = {
            s.original_value: (
                None if j.operation == "normalise_missing" else s.proposed_value
            )
            for s in selected
        }
        result = copy.deepcopy(d)
        col = int(j.target_column_id[1:])
        for row in result["rows"]:
            if isinstance(row[col], str) and row[col] in mappings:
                row[col] = mappings[row[col]]
    changed = sum(a != b for a, b in zip(d["rows"], result["rows"]))
    if not changed:
        return JsonResponse({"status": "no_changes", **info(w)})
    path = files.snapshot(result)
    with transaction.atomic():
        if not Workspace.objects.filter(pk=w.pk, revision=j.base_revision).update(
            current_path=path,
            previous_path=w.current_path,
            revision=w.revision + 1,
            last_applied_job_id=j.id,
        ):
            raise AppError(
                "Your data changed. Refresh the preview.", "STALE_REVISION", 409
            )
        j.status = "applied"
        j.risk_ack_hash = j.plan_hash if b.get("confirm_high_risk") is True else None
        j.save()
        j.suggestions.filter(id__in=[s.id for s in selected]).update(selected=True)
        w.jobs.exclude(pk=j.pk).filter(
            status__in=["queued", "running", "needs_input", "awaiting_consent", "ready"]
        ).update(status="cancelled")
    w.refresh_from_db()
    return JsonResponse({"status": "applied", "changed_rows": changed, **info(w)})


@endpoint(["POST"])
def action(r, id):
    w = workspace(r, id)
    b = body(r)
    revision(w, b)
    a = b.get("action")
    if a not in ("undo", "reset", "remove_file"):
        raise AppError("Choose Undo, Reset or Remove file.", "INVALID_REQUEST")
    if a == "undo" and not w.previous_path:
        raise AppError("There is no change to undo.", "NO_UNDO")
    with transaction.atomic():
        path = w.previous_path if a == "undo" else w.original_path
        if not Workspace.objects.filter(pk=w.pk, revision=w.revision).update(
            current_path=None if a == "remove_file" else path,
            original_path=None if a == "remove_file" else w.original_path,
            previous_path=None,
            last_applied_job_id=None,
            revision=w.revision + 1,
        ):
            raise AppError("Refresh your workspace.", "STALE_REVISION", 409)
        if a == "undo":
            w.jobs.filter(pk=w.last_applied_job_id).update(status="undone")
        else:
            w.jobs.filter(status="applied").update(status="undone")
        w.jobs.filter(
            status__in=["queued", "running", "needs_input", "awaiting_consent", "ready"]
        ).update(status="cancelled")
        if a == "remove_file":
            w.uploaded_file.all().delete()
    w.refresh_from_db()
    return JsonResponse(info(w))


@endpoint(["GET"])
def export(r, id):
    w = workspace(r, id)
    fmt = r.GET.get("format", "csv")
    content, mime = files.export(files.read(w.current_path), fmt)
    response = HttpResponse(content, content_type=mime)
    response["Content-Disposition"] = f'attachment; filename="cleaned_data.{fmt}"'
    return response
