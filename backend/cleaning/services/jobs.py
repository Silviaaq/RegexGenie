import hashlib, json, time, copy
import regex
from django.db import connection
from cleaning.models import CleaningJob, CleaningSuggestion
from core.engine import AppError
from . import files, llm


def digest(x):
    return hashlib.sha256(
        json.dumps(x, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def values(data, cid):
    counts = {}
    for row in data["rows"]:
        v = row[int(cid[1:])]
        if v is not None and not isinstance(v, str):
            raise AppError(
                "Choose a text column for AI value cleaning.", "INVALID_COLUMN_TYPE"
            )
        counts[v] = counts.get(v, 0) + 1
    return [
        {"id": f"v{i}", "value": v, "occurrences": n}
        for i, (v, n) in enumerate(counts.items())
        if isinstance(v, str) and v != ""
    ]


def regex_preview(data, p, replacement):
    pattern = p.get("pattern")
    flags = p.get("flags")
    if (
        not isinstance(pattern, str)
        or not 1 <= len(pattern) <= 500
        or not isinstance(flags, list)
        or any(f not in ("i", "m", "s") for f in flags)
    ):
        raise AppError("Generated regex exceeds supported limits.", "INVALID_REGEX")
    try:
        r = regex.compile(
            pattern,
            sum({"i": regex.I, "m": regex.M, "s": regex.S}[x] for x in set(flags)),
        )
        if r.search("", timeout=0.05):
            raise AppError(
                "Rules matching empty text are not supported.", "INVALID_REGEX"
            )
    except regex.error:
        raise AppError("Generated regex could not be compiled.", "INVALID_REGEX")
    out = copy.deepcopy(data)
    col = int(p["target_column_id"][1:])
    matches = []
    changed = cleared = lost = 0
    start = time.monotonic()
    output = 0
    try:
        for i, row in enumerate(data["rows"]):
            old = row[col]
            if not isinstance(old, str):
                continue
            if time.monotonic() - start > 5:
                raise TimeoutError()
            found = []
            shift = 0
            for m in r.finditer(old, timeout=0.05):
                if m.start() == m.end():
                    raise AppError(
                        "Rules producing empty matches are not supported.",
                        "INVALID_REGEX",
                    )
                if len(matches) + len(found) >= 100000:
                    raise AppError(
                        "Too many matches. Narrow your instruction.", "LIMIT_EXCEEDED"
                    )
                found.append(
                    {
                        "row": i,
                        "col": col,
                        "start": m.start(),
                        "end": m.end(),
                        "result_start": m.start() + shift,
                        "result_end": m.start() + shift + len(replacement),
                    }
                )
                shift += len(replacement) - (m.end() - m.start())
            # Check expansion before substitution to bound output memory.
            size = (
                len(old)
                + len(found) * len(replacement)
                - sum(m["end"] - m["start"] for m in found)
            )
            output += size
            if output > 16 * 1024 * 1024:
                raise AppError(
                    "Replacement output is too large. Use a shorter value.",
                    "LIMIT_EXCEEDED",
                )
            new = r.sub(lambda m: replacement, old, timeout=0.05)
            out["rows"][i][col] = new
            matches.extend(found)
            if new != old:
                changed += 1
                cleared += bool(old and not new)
                lost += max(0, len(old) - len(new))
    except TimeoutError:
        raise AppError(
            "Regex exceeded its execution time limit. Simplify the pattern.",
            "REGEX_TIMEOUT",
        )
    signals = []
    if changed >= 10 and changed / max(1, len(data["rows"])) > 0.8:
        signals.append("More than 80% of rows will change.")
    if cleared:
        signals.append(f"{cleared} cells will be cleared completely.")
    if pattern in (".*", ".+", "^.*$", "^.+$") or lost > 1000:
        signals.append("This rule matches broadly or removes substantial text.")
    return out, {
        "matches": len(matches),
        "match_positions": matches,
        "changed_rows": changed,
        "changed_cells": changed,
        "risk": {"requires_confirmation": bool(signals), "signals": signals},
    }


def process(job):
    data = files.read(job.workspace.current_path)
    if job.base_revision != job.workspace.revision:
        raise AppError("Your data changed. Refresh the preview.", "STALE_REVISION", 409)
    if not job.plan_json:
        job.plan_json = llm.route(job.instruction, data["headers"], infer=job.action is None)
        job.operation = job.plan_json["operation"]
        job.target_column_id = job.plan_json["target_column_id"]
    if job.operation == "regex_replace" and job.action is None:
        job.action = job.plan_json.get("action")
        job.replacement_value = job.plan_json.get("replacement_value")
    if not job.target_column_id:
        job.status = "needs_input"
        job.impact_json = {"message": "Which column should I clean?"}
        return
    job.plan_json["target_column_id"] = job.target_column_id
    if job.operation == "regex_replace":
        if job.action not in ("replace", "remove") or (job.action == "replace" and (
            not isinstance(job.replacement_value, str) or job.replacement_value == ""
        )):
            job.status = "needs_input"
            job.impact_json = {
                "message": "What should replace the matched text? Enter one exact value, explicitly choose removal, or edit your instruction.",
                "replacement_required": True
            }
            return
        replacement = "" if job.action == "remove" else job.replacement_value
        out, impact = regex_preview(data, job.plan_json, replacement)
        job.result_path = files.snapshot(out)
        job.impact_json = impact
        job.status = "ready"
        job.plan_hash = digest([job.plan_json, replacement, job.base_revision, impact])
    elif not job.consent_json:
        vs = values(data, job.target_column_id)
        job.scope_json = {"values": vs, "scope_hash": digest([vs, job.base_revision])}
        job.status = "awaiting_consent"
        job.impact_json = {}
    else:
        vs = [
            v
            for v in job.scope_json["values"]
            if v["id"] in job.consent_json["selected_value_ids"]
        ]
        items = llm.proposals(job, vs)
        byid = {v["id"]: v for v in vs}
        # Approved historical mappings remain local; never send them to AI.
        history = {}
        for old in CleaningSuggestion.objects.filter(
            job__workspace=job.workspace,
            job__status="applied",
            job__target_column_id=job.target_column_id,
            selected=True,
        ).order_by("job__created_at"):
            history[old.original_value] = old.proposed_value
        suggestions = []
        for x in items:
            v = byid[x["id"]]
            status = x["status"]
            if (
                job.operation == "normalise_missing"
                and v["value"] in ("0", "000", "NA", "-")
                and status == "missing"
            ):
                status = "uncertain"
            if v["value"] in history and history[v["value"]] != x["proposed_value"]:
                status = (
                    "needs_review"
                    if job.operation == "normalise_values"
                    else "uncertain"
                )
            suggestions.append(
                CleaningSuggestion(
                    job=job,
                    candidate_id=v["id"],
                    original_value=v["value"],
                    proposed_value=x["proposed_value"],
                    ai_status=status,
                    reason=x["reason"],
                    occurrences=v["occurrences"],
                )
            )
        CleaningSuggestion.objects.bulk_create(suggestions)
        job.plan_hash = digest([items, job.base_revision, job.consent_json])
        job.status = "ready"
        job.impact_json = {
            "partial_scope": len(vs) < len(job.scope_json["values"]),
            "consistency_reference": bool(history),
        }


def work_one():
    from django.db import close_old_connections
    from django.utils import timezone

    close_old_connections()
    job = (
        CleaningJob.objects.filter(
            status="queued", workspace__expires_at__gt=timezone.now()
        )
        .order_by("created_at")
        .first()
    )
    if not job:
        return False
    if not CleaningJob.objects.filter(pk=job.pk, status="queued").update(
        status="running"
    ):
        return True
    job.refresh_from_db()
    try:
        process(job)
    except AppError as e:
        job.status = "failed"
        job.error_code = e.code
        job.impact_json = {"message": e.message}
    except Exception:
        job.status = "failed"
        job.error_code = "PROCESSING_FAILED"
        job.impact_json = {
            "message": "Processing failed. Your current data is unchanged. Try again."
        }
    # A cancelled task or changed workspace cannot be resurrected by a late result.
    state = {
        f: getattr(job, f)
        for f in (
            "status",
            "operation",
            "target_column_id",
            "plan_json",
            "impact_json",
            "scope_json",
            "plan_hash",
            "result_path",
            "error_code",
            "action",
            "replacement_value",
        )
    }
    CleaningJob.objects.filter(
        pk=job.pk, status="running", workspace__revision=job.base_revision
    ).update(**state)
    CleaningJob.objects.filter(pk=job.pk, status="running").update(status="cancelled")
    close_old_connections()
    return True
