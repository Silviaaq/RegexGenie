import json, time, hashlib, uuid, re
from datetime import timedelta
from functools import wraps
from django.http import JsonResponse, HttpResponse, FileResponse
from django.core.exceptions import (
    RequestDataTooBig,
    TooManyFieldsSent,
    TooManyFilesSent,
)
import logging

logger = logging.getLogger(__name__)
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.db import transaction
from django.core.cache import cache
from django.conf import settings
from .models import Dataset, Transformation
from .engine import AppError, parse_isolated, plan_isolated, execute, export
from .limits import MAX_BYTES, MAX_ROWS, MAX_COLUMNS, PAGE_SIZE, RETENTION_SECONDS


class LifecycleMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/api/"):
            from .lifecycle import clean_expired

            clean_expired()
        response = self.get_response(request)
        if request.path.startswith("/api/"):
            response["Cache-Control"] = "no-store"
            response["X-Content-Type-Options"] = "nosniff"
        return response


def endpoint(methods):
    def decorator(fn):
        @wraps(fn)
        def wrapped(request, *args, **kwargs):
            try:
                if request.method not in methods:
                    return JsonResponse(
                        {
                            "code": "METHOD_NOT_ALLOWED",
                            "message": "This method is not supported.",
                        },
                        status=405,
                    )
                if not request.session.session_key:
                    request.session.create()
                return fn(request, *args, **kwargs)
            except AppError as e:
                return JsonResponse(
                    {
                        "code": e.code,
                        "message": e.message,
                        "retryable": e.status in [429, 503, 504],
                        "request_id": str(uuid.uuid4()),
                        **({"retry_after_seconds": 60} if e.status == 429 else {}),
                    },
                    status=e.status,
                )
            except (RequestDataTooBig, TooManyFieldsSent, TooManyFilesSent):
                return JsonResponse(
                    {
                        "code": "FILE_TOO_LARGE",
                        "message": "Upload one file of at most 2 MB.",
                        "retryable": False,
                    },
                    status=413,
                )
            except (ValueError, TypeError, KeyError):
                return JsonResponse(
                    {
                        "code": "INVALID_REQUEST",
                        "message": "Check the request fields and try again.",
                        "retryable": False,
                    },
                    status=400,
                )
            except Exception:
                request_id = str(uuid.uuid4())
                logger.error("Request failed: %s", request_id)
                return JsonResponse(
                    {
                        "code": "INTERNAL_ERROR",
                        "message": "Processing could not finish. Try again or upload a smaller file.",
                        "retryable": True,
                        "request_id": request_id,
                    },
                    status=500,
                )

        return wrapped

    return decorator


def body(request):
    try:
        d = json.loads(request.body)
    except (ValueError, UnicodeError):
        raise AppError("Send valid JSON.", "INVALID_REQUEST", 400)
    if not isinstance(d, dict):
        raise AppError("Send a JSON object.", "INVALID_REQUEST", 400)
    return d


def dataset(request, id):
    try:
        d = Dataset.objects.get(id=id, owner=request.session.session_key)
    except Dataset.DoesNotExist:
        raise AppError(
            "This file is unavailable or has expired. Upload it again.",
            "NOT_FOUND",
            404,
        )
    if d.expires_at <= timezone.now():
        raise AppError("Your file has expired. Upload it again.", "DATA_EXPIRED", 410)
    return d


def transformation(request, id):
    try:
        t = Transformation.objects.select_related("dataset").get(
            id=id, dataset__owner=request.session.session_key
        )
    except Transformation.DoesNotExist:
        raise AppError(
            "This result is unavailable or has expired. Upload the file again.",
            "NOT_FOUND",
            404,
        )
    dataset(request, t.dataset_id)
    return t


def sheet_data(d, s):
    if s not in d.sheets:
        raise AppError("Choose an available sheet.", "INVALID_TARGET")
    data = d.sheets[s]
    if "error" in data:
        raise AppError(data["error"], "FILE_PARSE_ERROR")
    return data


def page(request, rows):
    try:
        offset = int(request.GET.get("offset", 0))
        limit = int(request.GET.get("limit", 100))
    except ValueError:
        raise AppError("Use integer pagination values.", "INVALID_REQUEST", 400)
    if offset < 0 or not 1 <= limit <= 500:
        raise AppError(
            "Use an offset of 0 or greater and a limit between 1 and 500.",
            "INVALID_REQUEST",
            400,
        )
    return rows[offset : offset + limit], offset


@endpoint(["POST"])
def upload(request):
    f = request.FILES.get("file")
    if not f:
        raise AppError("Choose a CSV or Excel file.", "INVALID_REQUEST", 400)
    if f.size > MAX_BYTES:
        raise AppError(
            "This file is larger than 2 MB. Split it into smaller files.",
            "FILE_TOO_LARGE",
            413,
        )
    if Dataset.objects.filter(owner=request.session.session_key).count() >= 5:
        raise AppError(
            "Delete an existing file before uploading another.", "RATE_LIMITED", 429
        )
    raw = f.read()
    sheets = parse_isolated(f.name, raw)
    d = Dataset.objects.create(
        owner=request.session.session_key,
        name=f.name[:255],
        checksum=hashlib.sha256(raw).hexdigest(),
        sheets=sheets,
        expires_at=timezone.now() + timedelta(seconds=RETENTION_SECONDS),
    )
    return JsonResponse(
        {
            "dataset_id": str(d.id),
            "sheets": list(sheets),
            "expires_at": d.expires_at.isoformat(),
        }
    )


@endpoint(["POST"])
def select(request, id):
    d = dataset(request, id)
    s = body(request)["sheet_id"]
    data = sheet_data(d, s)
    return JsonResponse(
        {
            **data,
            "rows": data["rows"][:PAGE_SIZE],
            "offset": 0,
            "row_count": len(data["rows"]),
            "dataset_version": d.checksum,
        }
    )


@endpoint(["GET"])
def original_rows(request, id):
    d = dataset(request, id)
    s = request.GET.get("sheet_id", next(iter(d.sheets)))
    data = sheet_data(d, s)
    rows, offset = page(request, data["rows"])
    return JsonResponse(
        {"rows": rows, "offset": offset, "row_count": len(data["rows"])}
    )


@endpoint(["POST"])
def transform(request):
    b = body(request)
    d = dataset(request, b["dataset_id"])
    s = b["sheet_id"]
    data = sheet_data(d, s)
    if b.get("dataset_version") != d.checksum:
        raise AppError(
            "The dataset changed. Select the sheet again.", "INVALID_REQUEST", 409
        )
    instruction = b.get("instruction", "")
    if "replacement" in b and (
        not isinstance(b["replacement"], str) or len(b["replacement"]) > 2000
    ):
        raise AppError(
            "Use a text replacement of up to 2,000 characters.", "INVALID_REQUEST", 400
        )
    if (
        not isinstance(instruction, str)
        or not instruction.strip()
        or len(instruction) > 2000
    ):
        raise AppError(
            "Enter one instruction of up to 2,000 characters.", "INVALID_REQUEST", 400
        )
    if Transformation.objects.filter(dataset=d).count() >= 10:
        raise AppError(
            "This file has reached ten previews. Download your result, then upload again.",
            "RATE_LIMITED",
            429,
        )
    lock = "processing:" + request.session.session_key
    if not cache.add(lock, True, timeout=65):
        raise AppError(
            "A preview is already being generated. Wait for it to finish.",
            "RATE_LIMITED",
            429,
        )
    try:
        now = time.time()
        key = "rate:" + request.session.session_key
        times = [t for t in cache.get(key, []) if t > now - 60]
        if len(times) >= 5:
            raise AppError(
                "You have made five requests this minute. Wait one minute and try again.",
                "RATE_LIMITED",
                429,
            )
        cache.set(key, times + [now], timeout=60)
        p = plan_isolated(instruction, data, b.get("replacement"))
        r = execute(data, p)
        with transaction.atomic():
            locked = (
                Dataset.objects.select_for_update()
                .filter(id=d.id, expires_at__gt=timezone.now())
                .first()
            )
            if not locked:
                raise AppError(
                    "The file was deleted or expired. Upload it again.",
                    "DATA_EXPIRED",
                    410,
                )
            t = Transformation.objects.create(dataset=locked, sheet=s, result=r)
        return JsonResponse(
            {
                **{k: v for k, v in r.items() if k not in ("rows", "matches")},
                "rows": r["rows"][:PAGE_SIZE],
                "original": data["rows"][:PAGE_SIZE],
                "matches": [m for m in r["matches"] if m["row"] < PAGE_SIZE],
                "offset": 0,
                "id": str(t.id),
                "transformation_id": str(t.id),
                "dataset_version": d.checksum,
                "row_count": len(data["rows"]),
                "expires_at": d.expires_at.isoformat(),
                "status": "ready",
            }
        )
    finally:
        cache.delete(lock)


@endpoint(["GET"])
def result(request, id):
    t = transformation(request, id)
    r = {k: v for k, v in t.result.items() if k not in ["rows", "matches"]}
    return JsonResponse(
        {
            **r,
            "transformation_id": str(t.id),
            "status": "ready",
            "row_count": len(t.result["rows"]),
            "expires_at": t.dataset.expires_at.isoformat(),
        }
    )


@endpoint(["GET"])
def result_rows(request, id):
    t = transformation(request, id)
    rows, offset = page(request, t.result["rows"])
    original = sheet_data(t.dataset, t.sheet)["rows"]
    return JsonResponse(
        {
            "processed": rows,
            "original": original[offset : offset + len(rows)],
            "offset": offset,
            "matches": [
                m
                for m in t.result["matches"]
                if offset <= m["row"] < offset + len(rows)
            ],
        }
    )


@endpoint(["GET"])
def target(request, id, ordinal):
    t = transformation(request, id)
    matches = t.result["matches"]
    if not 1 <= ordinal <= len(matches):
        raise AppError("This match does not exist.", "INVALID_TARGET")
    return JsonResponse(matches[ordinal - 1])


@endpoint(["GET"])
def download(request, id):
    t = transformation(request, id)
    fmt = request.GET.get("format", "csv")
    content, mime = export(
        sheet_data(t.dataset, t.sheet)["headers"], t.result["rows"], fmt
    )
    name = re.sub(r'[\\/\x00-\x1f";]', "_", t.dataset.name.rsplit(".", 1)[0])
    response = HttpResponse(content, content_type=mime)
    from django.utils.http import content_disposition_header

    response["Content-Disposition"] = content_disposition_header(
        True, name + "_processed." + fmt
    )
    response["Cache-Control"] = "no-store"
    return response


@endpoint(["DELETE"])
def delete(request, id):
    dataset(request, id).delete()
    return JsonResponse({"deleted": True})


@ensure_csrf_cookie
def index(request):
    return FileResponse(
        open(settings.BASE_DIR.parent / "dist" / "index.html", "rb"),
        content_type="text/html",
    )


@endpoint(["GET"])
@ensure_csrf_cookie
def config(request):
    import os

    return JsonResponse(
        {
            "mode": "live",
            "model_ready": bool(os.getenv("GROQ_API_KEY") and os.getenv("GROQ_MODEL")),
            "max_bytes": MAX_BYTES,
            "max_rows": MAX_ROWS,
            "max_columns": MAX_COLUMNS,
            "retention_seconds": RETENTION_SECONDS,
        }
    )


def csrf_failure(request, reason=""):
    return JsonResponse(
        {
            "code": "SESSION_EXPIRED",
            "message": "Your session needs refreshing. Reload this page, then upload the file again.",
            "retryable": False,
        },
        status=403,
    )


def health(request):
    return JsonResponse({"status": "ok"})
