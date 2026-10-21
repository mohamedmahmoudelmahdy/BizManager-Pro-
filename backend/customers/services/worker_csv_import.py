"""Parse and import company workers from CSV (Companies_expire-style layout)."""
from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime, timedelta
from typing import BinaryIO, TextIO

from customers.models import CompanyEmployee, Customer

NAME_HEADERS = {
    "الاسم",
    "name",
    "worker name",
    "worker",
    "employee name",
    "employee",
    "workers name",
}
ENGLISH_NAME_HEADERS = {"english name", "english_name", "name in english"}
ARABIC_NAME_HEADERS = {"arabic name", "arabic_name", "name in arabic", "الاسم بالعربية"}
ICP_HEADER_MARKERS = ENGLISH_NAME_HEADERS | ARABIC_NAME_HEADERS | {"unified number", "emirates id", "file status"}
SECTION_MARKERS = {"العمال", "workers", "employees", "worker list"}
RESIDENCY_EXPIRY_HEADERS = {
    "residency expiry",
    "visa expiry",
    "residency / visa expiry",
    "residency/visa expiry",
    "residency_expiry",
    "visa_expiry",
    "الاقامة",
}
INSURANCE_EXPIRY_HEADERS = {
    "insurance expiry",
    "guarantee expiry",
    "health insurance expiry",
    "insurance_expiry",
    "guarantee_expiry",
    "الضمان",
}
EXPIRY_HEADERS = {"تاريخ الانتهاء", "expiry date", "expiry", "تاريخ انتهاء"}
DAYS_HEADERS = {"باليوم", "days left", "days remaining", "days", "remaining days"}
IDENTIFIER_HEADERS = {
    "emirates id",
    "emirates_id",
    "passport",
    "passport no",
    "passport number",
    "id",
    "id number",
    "رقم الهوية",
    "الهوية",
    "جواز",
}
UNIFIED_NUMBER_HEADERS = {"unified number", "unified_number", "unified no", "unified id"}
META_NOTES_HEADERS = {
    "type",
    "nationality",
    "file status",
    "visa type",
    "status",
    "الجنسية",
    "الحالة",
}
NOTES_HEADERS = {"notes", "note", "remarks", "remark", "ملاحظات", "ملاحظة"}


def _clean_text(value) -> str:
    if value is None:
        return ""
    text = str(value).replace("\r\n", "\n").strip().strip('"').strip()
    return re.sub(r"\s+", " ", text)


def _norm_header(value) -> str:
    return _clean_text(value).casefold()


def _is_empty_row(cells: list[str]) -> bool:
    return all(_clean_text(c) in ("", ".", "-", "--") for c in cells)


def _excel_serial_to_date(value: float) -> date | None:
    try:
        serial = float(value)
    except (TypeError, ValueError):
        return None
    if serial <= 0:
        return None
    base = datetime(1899, 12, 30)
    return (base + timedelta(days=serial)).date()


def parse_date_value(value) -> tuple[date | None, str | None]:
    """Return (parsed_date, error_message)."""
    if value is None:
        return None, None
    if isinstance(value, datetime):
        return value.date(), None
    if isinstance(value, date):
        return value, None

    text = _clean_text(value)
    if not text or text in (".", "-", "--"):
        return None, None

    if re.fullmatch(r"\d+(\.\d+)?", text):
        parsed = _excel_serial_to_date(float(text))
        if parsed:
            return parsed, None
        return None, f"Invalid Excel date serial: {text}"

    iso_candidate = text.replace("T00:00:00", "").replace(" 00:00:00", "")
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(iso_candidate, fmt).date(), None
        except ValueError:
            continue

    return None, f"Unrecognized date format: {text}"


def normalize_worker_name(name: str) -> str:
    return _clean_text(name).casefold()


def _read_csv_rows(file_obj: BinaryIO | TextIO) -> list[list[str]]:
    if hasattr(file_obj, "read"):
        raw = file_obj.read()
        if isinstance(raw, bytes):
            for encoding in ("utf-8-sig", "utf-8", "cp1256", "latin-1"):
                try:
                    content = raw.decode(encoding)
                    break
                except UnicodeDecodeError:
                    content = None
            if content is None:
                content = raw.decode("utf-8", errors="replace")
        else:
            content = raw
        if hasattr(file_obj, "seek"):
            file_obj.seek(0)
    else:
        content = str(file_obj)

    reader = csv.reader(io.StringIO(content))
    return [row for row in reader if row and not _is_empty_row(row)]


def _detect_column_map(header_row: list[str]) -> dict[str, int | None]:
    normalized = [_norm_header(cell) for cell in header_row]
    mapping: dict[str, int | None] = {
        "name": None,
        "english_name": None,
        "arabic_name": None,
        "residency_expiry": None,
        "residency_days": None,
        "insurance_expiry": None,
        "insurance_days": None,
        "identifier": None,
        "unified_number": None,
        "notes": None,
        "meta_note_fields": [],
    }

    expiry_positions: list[int] = []
    days_positions: list[int] = []
    meta_note_fields: list[int] = []

    for idx, header in enumerate(normalized):
        raw = _clean_text(header_row[idx])
        if header in ENGLISH_NAME_HEADERS:
            mapping["english_name"] = idx
        elif header in ARABIC_NAME_HEADERS:
            mapping["arabic_name"] = idx
        elif header in NAME_HEADERS or raw == "الاسم":
            mapping["name"] = idx
        elif header in UNIFIED_NUMBER_HEADERS:
            mapping["unified_number"] = idx
        elif header in IDENTIFIER_HEADERS:
            mapping["identifier"] = idx
        elif header in NOTES_HEADERS:
            mapping["notes"] = idx
        elif header in META_NOTES_HEADERS:
            meta_note_fields.append(idx)
        elif header in RESIDENCY_EXPIRY_HEADERS:
            mapping["residency_expiry"] = idx
        elif header in INSURANCE_EXPIRY_HEADERS:
            mapping["insurance_expiry"] = idx
        elif header in EXPIRY_HEADERS or "expiry" in header or "انتهاء" in raw:
            expiry_positions.append(idx)
        elif header in DAYS_HEADERS or "days" in header or raw == "باليوم":
            days_positions.append(idx)

    if mapping["residency_expiry"] is None and expiry_positions:
        mapping["residency_expiry"] = expiry_positions[0]
    if mapping["insurance_expiry"] is None and len(expiry_positions) > 1:
        mapping["insurance_expiry"] = expiry_positions[1]
    if mapping["residency_days"] is None and days_positions:
        mapping["residency_days"] = days_positions[0]
    if mapping["insurance_days"] is None and len(days_positions) > 1:
        mapping["insurance_days"] = days_positions[1]

    if mapping["name"] is None and len(header_row) >= 5:
        first = normalized[0] if normalized else ""
        if first in NAME_HEADERS or _clean_text(header_row[0]) == "الاسم":
            mapping["name"] = 0
            mapping["residency_expiry"] = mapping["residency_expiry"] if mapping["residency_expiry"] is not None else 1
            mapping["residency_days"] = mapping["residency_days"] if mapping["residency_days"] is not None else 2
            mapping["insurance_expiry"] = mapping["insurance_expiry"] if mapping["insurance_expiry"] is not None else 3
            mapping["insurance_days"] = mapping["insurance_days"] if mapping["insurance_days"] is not None else 4

    mapping["meta_note_fields"] = meta_note_fields
    return mapping


def _is_icp_employee_format(column_map: dict[str, int | None]) -> bool:
    return column_map.get("english_name") is not None or column_map.get("arabic_name") is not None


def _resolve_worker_name(row: list[str], column_map: dict[str, int | None]) -> str:
    arabic = _cell(row, column_map.get("arabic_name"))
    english = _cell(row, column_map.get("english_name"))
    generic = _cell(row, column_map.get("name"))
    return arabic or english or generic


def _resolve_identifier(row: list[str], column_map: dict[str, int | None]) -> str:
    parts: list[str] = []
    unified = _cell(row, column_map.get("unified_number"))
    emirates = _cell(row, column_map.get("identifier"))
    if unified:
        parts.append(f"Unified: {unified}")
    if emirates:
        parts.append(f"Emirates ID: {emirates}")
    return " | ".join(parts)


def _resolve_notes(row: list[str], column_map: dict[str, int | None], header_row: list[str]) -> str:
    explicit = _cell(row, column_map.get("notes"))
    meta_parts: list[str] = []
    for idx in column_map.get("meta_note_fields") or []:
        value = _cell(row, idx)
        if not value:
            continue
        label = _clean_text(header_row[idx]) if idx < len(header_row) else "Field"
        meta_parts.append(f"{label}: {value}")
    combined = meta_parts[:]
    if explicit:
        combined.insert(0, explicit)
    return " | ".join(combined)


def _detected_format(column_map: dict[str, int | None]) -> str:
    if _is_icp_employee_format(column_map):
        return "icp_employee"
    if column_map.get("residency_days") is not None or column_map.get("insurance_days") is not None:
        return "companies_expire"
    return "generic"


def _find_data_start(rows: list[list[str]]) -> tuple[int, dict[str, int | None]]:
    for idx, row in enumerate(rows):
        cells = [_clean_text(c) for c in row]
        if not cells:
            continue
        if cells[0] in SECTION_MARKERS or _norm_header(cells[0]) in SECTION_MARKERS:
            if idx + 1 < len(rows):
                nxt = [_clean_text(c) for c in rows[idx + 1]]
                if nxt and (_norm_header(nxt[0]) in NAME_HEADERS or nxt[0] == "الاسم"):
                    return idx + 2, _detect_column_map(rows[idx + 1])
            return idx + 1, {
                "name": 0,
                "residency_expiry": 1,
                "residency_days": 2,
                "insurance_expiry": 3,
                "insurance_days": 4,
                "identifier": None,
                "notes": None,
            }

        if _norm_header(cells[0]) in NAME_HEADERS or cells[0] == "الاسم":
            return idx + 1, _detect_column_map(row)

        lowered = {_norm_header(c) for c in cells}
        if lowered & NAME_HEADERS:
            return idx + 1, _detect_column_map(row)
        if lowered & ICP_HEADER_MARKERS:
            return idx + 1, _detect_column_map(row)

    if rows:
        return 0, {
            "name": 0,
            "residency_expiry": 1 if len(rows[0]) > 1 else None,
            "residency_days": 2 if len(rows[0]) > 2 else None,
            "insurance_expiry": 3 if len(rows[0]) > 3 else None,
            "insurance_days": 4 if len(rows[0]) > 4 else None,
            "identifier": None,
            "notes": None,
        }
    return 0, _detect_column_map([])


def _cell(row: list[str], index: int | None) -> str:
    if index is None or index >= len(row):
        return ""
    return _clean_text(row[index])


def _existing_duplicate_keys(customer: Customer) -> set[tuple[str, str | None]]:
    keys: set[tuple[str, str | None]] = set()
    for worker in CompanyEmployee.objects.filter(company=customer):
        residency = worker.residency_expiry.isoformat() if worker.residency_expiry else None
        keys.add((normalize_worker_name(worker.name), residency))
    return keys


def _validate_parsed_row(
    *,
    row_number: int,
    name: str,
    residency_expiry: date | None,
    insurance_expiry: date | None,
    residency_error: str | None,
    insurance_error: str | None,
    identifier: str,
    notes: str,
    duplicate_keys: set[tuple[str, str | None]],
    seen_keys: set[tuple[str, str | None]],
    format_detected: str = "generic",
) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    is_icp = format_detected == "icp_employee"

    if not name:
        errors.append("Worker name is required.")
    if residency_error:
        errors.append(residency_error)
    if insurance_error:
        errors.append(insurance_error)
    if not residency_expiry:
        warnings.append("Residency / visa expiry is missing.")
    if not insurance_expiry and not is_icp:
        warnings.append("Insurance expiry is missing; worker will be marked as no health insurance.")

    if identifier and not is_icp:
        warnings.append("Identifier column detected but is not stored on the worker record.")
    if notes and not is_icp:
        warnings.append("Notes column detected but is not stored on the worker record.")

    key = (normalize_worker_name(name), residency_expiry.isoformat() if residency_expiry else None)
    if name and key in duplicate_keys:
        warnings.append("Duplicate worker already exists for this company (same name and residency expiry).")
    if name and key in seen_keys:
        errors.append("Duplicate row in CSV (same name and residency expiry).")
    elif name:
        seen_keys.add(key)

    if errors:
        status = "error"
    elif warnings:
        status = "warning"
    else:
        status = "valid"

    return {
        "row_number": row_number,
        "status": status,
        "errors": errors,
        "warnings": warnings,
        "mapped": {
            "name": name,
            "residency_expiry": residency_expiry.isoformat() if residency_expiry else None,
            "insurance_expiry": insurance_expiry.isoformat() if insurance_expiry else None,
            "no_health_insurance": insurance_expiry is None,
            "identifier": identifier or None,
            "notes": notes or None,
        },
    }


def parse_worker_csv(file_obj: BinaryIO | TextIO) -> dict:
    rows = _read_csv_rows(file_obj)
    start_idx, column_map = _find_data_start(rows)
    header_row = rows[start_idx - 1] if start_idx > 0 else []
    parsed_rows: list[dict] = []

    for offset, row in enumerate(rows[start_idx:], start=1):
        row_number = start_idx + offset
        if _is_empty_row(row):
            continue

        name = _resolve_worker_name(row, column_map)
        if _norm_header(name) in NAME_HEADERS or name in SECTION_MARKERS:
            continue
        if _norm_header(name) in ENGLISH_NAME_HEADERS | ARABIC_NAME_HEADERS:
            continue

        residency_raw = _cell(row, column_map.get("residency_expiry"))
        insurance_raw = _cell(row, column_map.get("insurance_expiry"))
        residency_expiry, residency_error = parse_date_value(residency_raw or None)
        insurance_expiry, insurance_error = parse_date_value(insurance_raw or None)

        detected_format = _detected_format(column_map)
        is_icp = detected_format == "icp_employee"
        parsed_rows.append(
            {
                "row_number": row_number,
                "raw": row,
                "name": name,
                "english_name": _cell(row, column_map.get("english_name")),
                "arabic_name": _cell(row, column_map.get("arabic_name")),
                "residency_expiry": residency_expiry,
                "insurance_expiry": insurance_expiry,
                "residency_error": residency_error,
                "insurance_error": insurance_error,
                "identifier": "" if is_icp else _resolve_identifier(row, column_map),
                "notes": "" if is_icp else _resolve_notes(row, column_map, header_row),
            }
        )

    detected_format = _detected_format(column_map)
    default_header_labels = [
        "الاسم / Name",
        "تاريخ الانتهاء (الاقامة) / Residency expiry",
        "باليوم / Residency days left",
        "تاريخ الانتهاء (الضمان) / Insurance expiry",
        "باليوم / Insurance days left",
    ]

    return {
        "format_detected": detected_format,
        "columns_detected": {
            "name": column_map.get("name"),
            "english_name": column_map.get("english_name"),
            "arabic_name": column_map.get("arabic_name"),
            "residency_expiry": column_map.get("residency_expiry"),
            "residency_days": column_map.get("residency_days"),
            "insurance_expiry": column_map.get("insurance_expiry"),
            "insurance_days": column_map.get("insurance_days"),
            "identifier": column_map.get("identifier"),
            "unified_number": column_map.get("unified_number"),
            "notes": column_map.get("notes"),
        },
        "header_labels": [_clean_text(h) for h in header_row] if header_row else default_header_labels,
        "rows": parsed_rows,
    }


def preview_worker_csv_import(customer: Customer, file_obj: BinaryIO | TextIO) -> dict:
    parsed = parse_worker_csv(file_obj)
    duplicate_keys = _existing_duplicate_keys(customer)
    seen_keys: set[tuple[str, str | None]] = set()
    preview_rows: list[dict] = []

    format_detected = parsed["format_detected"]
    for item in parsed["rows"]:
        preview_rows.append(
            _validate_parsed_row(
                row_number=item["row_number"],
                name=item["name"],
                residency_expiry=item["residency_expiry"],
                insurance_expiry=item["insurance_expiry"],
                residency_error=item["residency_error"],
                insurance_error=item["insurance_error"],
                identifier=item["identifier"],
                notes=item["notes"],
                duplicate_keys=duplicate_keys,
                seen_keys=seen_keys,
                format_detected=format_detected,
            )
        )

    counts = {
        "total": len(preview_rows),
        "valid": sum(1 for r in preview_rows if r["status"] == "valid"),
        "warning": sum(1 for r in preview_rows if r["status"] == "warning"),
        "error": sum(1 for r in preview_rows if r["status"] == "error"),
    }
    importable = [r for r in preview_rows if r["status"] in ("valid", "warning") and r["mapped"]["name"]]

    return {
        "format_detected": parsed["format_detected"],
        "columns_detected": parsed["columns_detected"],
        "header_labels": parsed["header_labels"],
        "counts": counts,
        "rows": preview_rows,
        "can_import": counts["error"] == 0 and len(importable) > 0,
        "importable_count": len(importable),
    }


def import_worker_csv(customer: Customer, file_obj: BinaryIO | TextIO) -> dict:
    preview = preview_worker_csv_import(customer, file_obj)
    if preview["counts"]["error"] > 0:
        raise ValueError("CSV contains row errors. Fix the file or remove invalid rows before importing.")

    duplicate_keys = _existing_duplicate_keys(customer)
    created = 0
    skipped = 0
    errors = 0

    for row in preview["rows"]:
        if row["status"] == "error" or not row["mapped"]["name"]:
            errors += 1
            continue

        mapped = row["mapped"]
        key = (
            normalize_worker_name(mapped["name"]),
            mapped["residency_expiry"],
        )
        if key in duplicate_keys:
            skipped += 1
            continue

        residency = None
        insurance = None
        if mapped["residency_expiry"]:
            residency = datetime.strptime(mapped["residency_expiry"], "%Y-%m-%d").date()
        if mapped["insurance_expiry"]:
            insurance = datetime.strptime(mapped["insurance_expiry"], "%Y-%m-%d").date()

        CompanyEmployee.objects.create(
            company=customer,
            name=mapped["name"],
            residency_expiry=residency,
            insurance_expiry=insurance,
            no_health_insurance=mapped["no_health_insurance"],
        )
        duplicate_keys.add(key)
        created += 1

    return {
        "created": created,
        "skipped": skipped,
        "errors": errors,
        "counts": preview["counts"],
    }
