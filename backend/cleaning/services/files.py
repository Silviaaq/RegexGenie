import csv, io, json, os, uuid, zipfile
from pathlib import Path
from datetime import date, datetime, time
from django.conf import settings
import openpyxl
from core.engine import AppError, safe_csv

MAX_BYTES = 10485760
ROOT = Path(os.getenv("WORKSPACE_DIR", str(settings.BASE_DIR / "private_workspaces")))


def encode(v):
    if isinstance(v, (datetime, date, time)):
        return {"$type": type(v).__name__, "value": v.isoformat()}
    return v


def display(v):
    return v["value"] if isinstance(v, dict) and "$type" in v else v


def snapshot(data):
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    p = ROOT / (uuid.uuid4().hex + ".json")
    with p.open("x") as f:
        json.dump(data, f, ensure_ascii=False)
    return str(p)


def read(path):
    if not path or not Path(path).is_file():
        raise AppError(
            "This workspace expired. Please upload your file again.",
            "EXPIRED_WORKSPACE",
            410,
        )
    return json.loads(Path(path).read_text())


def matrix(rows):
    out = []
    width = None
    for i, row in enumerate(rows):
        row = list(row)
        if len(row) > 50 or i > 10000:
            raise AppError("Use at most 10,000 rows and 50 columns.", "LIMIT_EXCEEDED")
        if width is None:
            width = len(row)
            if not width or not any(v is not None and str(v).strip() for v in row):
                raise AppError(
                    "Use a single header row with column names.", "INVALID_HEADER"
                )
            headers = [str(v) if v is not None else "" for v in row]
        else:
            if len(row) > width:
                raise AppError(
                    "Use a rectangular table with one header row.", "INVALID_TABLE"
                )
            out.append([encode(v) for v in row] + [""] * (width - len(row)))
        if i * width > 250000:
            raise AppError("Use at most 250,000 cells.", "LIMIT_EXCEEDED")
        if any(len(str(v)) > 100000 for v in row):
            raise AppError(
                "A cell is too long. Use at most 100,000 characters.", "LIMIT_EXCEEDED"
            )
    if width is None:
        raise AppError("This file is empty. Add a header and data.", "INVALID_TABLE")
    return {"headers": headers, "rows": out}


def parse(name, raw, sheet=None):
    if len(raw) > MAX_BYTES:
        raise AppError("Upload a file of at most 10 MB.", "FILE_TOO_LARGE", 413)
    if name.lower().endswith(".csv"):
        if b"\x00" in raw or raw.startswith(b"PK"):
            raise AppError("Upload UTF-8 CSV text.", "UNSUPPORTED_FORMAT", 415)
        try:
            return (
                matrix(
                    csv.reader(
                        io.StringIO(raw.decode("utf-8-sig"), newline=""), strict=True
                    )
                ),
                ["CSV"],
                "CSV",
            )
        except (UnicodeError, csv.Error):
            raise AppError(
                "Save as UTF-8 comma-separated CSV and try again.",
                "UNSUPPORTED_FORMAT",
                415,
            )
    if not name.lower().endswith(".xlsx"):
        raise AppError(
            "Upload UTF-8 CSV or XLSX. Legacy XLS is not supported.",
            "UNSUPPORTED_FORMAT",
            415,
        )
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            if (
                len(z.infolist()) > 2000
                or sum(x.file_size for x in z.infolist()) > 50 * 1024 * 1024
            ):
                raise AppError(
                    "This workbook exceeds the decompression limit. Split it into smaller files.",
                    "LIMIT_EXCEEDED",
                )
        wb = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, keep_links=False)
        try:
            names = wb.sheetnames
            if len(names) > 20:
                raise AppError("Use at most 20 sheets.", "LIMIT_EXCEEDED")
            if sheet is None and len(names) > 1:
                return None, names, None
            if sheet is not None and sheet not in names:
                raise AppError("Choose an available sheet.", "INVALID_SHEET")
            ws = wb[sheet or names[0]]
            if ws.merged_cells.ranges:
                raise AppError(
                    "Unmerge cells and use a simple rectangular table.",
                    "UNSUPPORTED_WORKBOOK",
                )
            if (
                ws.max_row > 10001
                or ws.max_column > 50
                or ws.max_row * ws.max_column > 250050
            ):
                raise AppError(
                    "Use at most 10,000 rows, 50 columns and 250,000 cells.",
                    "LIMIT_EXCEEDED",
                )
            return matrix(ws.iter_rows(values_only=True)), names, ws.title
        finally:
            wb.close()
    except AppError:
        raise
    except Exception:
        raise AppError(
            "Could not open this XLSX. Remove password protection or save a new copy.",
            "UNSUPPORTED_FORMAT",
            415,
        )


def export(data, fmt):
    rows = [data["headers"]] + data["rows"]
    if fmt == "csv":
        out = io.StringIO(newline="")
        writer = csv.writer(out)
        writer.writerows(
            [
                [safe_csv(str(display(v))) if v is not None else "" for v in r]
                for r in rows
            ]
        )
        return out.getvalue().encode("utf-8-sig"), "text/csv"
    if fmt != "xlsx":
        raise AppError("Choose CSV or XLSX.", "INVALID_REQUEST", 400)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Cleaned data"
    for r in rows:
        values = []
        for v in r:
            if isinstance(v, dict) and "$type" in v:
                v = {"datetime": datetime, "date": date, "time": time}[
                    v["$type"]
                ].fromisoformat(v["value"])
            values.append(v)
        ws.append(values)
        for c in ws[ws.max_row]:
            if isinstance(c.value, str):
                c.data_type = "s"
    out = io.BytesIO()
    wb.save(out)
    return (
        out.getvalue(),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
