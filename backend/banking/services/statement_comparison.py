"""Bank statement vs internal payment method statement comparison (audit-only)."""
from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction

from banking.models import (
    BankCard,
    BankStatementComparisonJob,
    BankStatementMatch,
    BankStatementRow,
)
from banking.services.bank_statement_parse import ParseResult, parse_bank_statement_file
from banking.services.payment_method_statement import build_payment_method_statement

AMOUNT_TOLERANCE = Decimal("1.00")
DATE_TOLERANCE_DAYS = 3
DESC_DATE_MATCH_REASON = (
    "Matched by amount, direction, and transaction date in bank description."
)

_PREFIXED_TXN_DATE = re.compile(
    r"\b(?:PUR|POS|CARD)\s+(\d{1,2})[/-](\d{1,2})\b",
    re.IGNORECASE,
)
_STANDALONE_TXN_DATE = re.compile(r"(?<!\d)(\d{1,2})[/-](\d{1,2})(?!\d)")


def _dec(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def _money_str(value: Decimal) -> str:
    return f"{_dec(value):.2f}"


def _direction_and_amount(money_in: Decimal, money_out: Decimal) -> tuple[str, Decimal]:
    if money_in > 0:
        return BankStatementRow.Direction.IN, _dec(money_in)
    if money_out > 0:
        return BankStatementRow.Direction.OUT, _dec(money_out)
    return "", Decimal("0.00")


def _tokenize(text: str) -> set[str]:
    low = _clean_similarity_text(text)
    return {t for t in re.split(r"[^a-z0-9\u0600-\u06ff]+", low) if len(t) >= 3}


def _clean_similarity_text(text: str) -> str:
    return (text or "").casefold().strip()


def _description_similarity(a: str, b: str) -> float:
    ta = _tokenize(a)
    tb = _tokenize(b)
    if not ta or not tb:
        return 0.0
    overlap = len(ta & tb)
    return overlap / max(len(ta), len(tb))


def _date_diff_days(d1: date | None, d2: date | None) -> int | None:
    if not d1 or not d2:
        return None
    return abs((d1 - d2).days)


def _resolve_dd_mm(day: int, month: int, posting_date: date | None) -> date | None:
    if posting_date is None or not (1 <= day <= 31 and 1 <= month <= 12):
        return None
    candidates: list[date] = []
    for year in (posting_date.year, posting_date.year - 1):
        try:
            candidates.append(date(year, month, day))
        except ValueError:
            continue
    if not candidates:
        return None
    return min(candidates, key=lambda candidate: abs((posting_date - candidate).days))


def _standalone_day_month(first: int, second: int) -> tuple[int, int] | None:
    """Interpret standalone DD/MM or DD-MM; MM/DD only when unambiguous."""
    if first > 12 and 1 <= second <= 12:
        return first, second
    if second > 12 and 1 <= first <= 12:
        return second, first
    if first > 12 and second > 12:
        return None
    return first, second


def extract_transaction_date_hints(description: str, posting_date: date | None) -> list[date]:
    """Extract transaction dates embedded in bank descriptions (e.g. PUR 05/05)."""
    hints: list[date] = []
    seen: set[date] = set()
    prefixed_spans: list[tuple[int, int]] = []

    for match in _PREFIXED_TXN_DATE.finditer(description or ""):
        prefixed_spans.append(match.span())
        day = int(match.group(1))
        month = int(match.group(2))
        resolved = _resolve_dd_mm(day, month, posting_date)
        if resolved and resolved not in seen:
            hints.append(resolved)
            seen.add(resolved)

    for match in _STANDALONE_TXN_DATE.finditer(description or ""):
        if any(start <= match.start() < end for start, end in prefixed_spans):
            continue
        parsed = _standalone_day_month(int(match.group(1)), int(match.group(2)))
        if not parsed:
            continue
        day, month = parsed
        resolved = _resolve_dd_mm(day, month, posting_date)
        if resolved and resolved not in seen:
            hints.append(resolved)
            seen.add(resolved)

    return hints


def _same_amount_direction_candidates(
    bank_row: BankStatementRow,
    system_rows: list[BankStatementRow],
    used_system: set[int],
) -> list[BankStatementRow]:
    return [
        system_row
        for system_row in system_rows
        if system_row.pk not in used_system
        and bank_row.normalized_direction == system_row.normalized_direction
        and bank_row.normalized_amount == system_row.normalized_amount
    ]


def _pick_closest_by_posting_date(
    bank_row: BankStatementRow, candidates: list[BankStatementRow]
) -> BankStatementRow:
    return min(
        candidates,
        key=lambda system_row: _date_diff_days(bank_row.row_date, system_row.row_date) or 999,
    )


def _serialize_row(row: BankStatementRow) -> dict:
    return {
        "id": row.pk,
        "source": row.source,
        "date": row.row_date.isoformat() if row.row_date else None,
        "description": row.description,
        "money_in": _money_str(row.money_in),
        "money_out": _money_str(row.money_out),
        "balance": _money_str(row.balance) if row.balance is not None else None,
        "reference": row.reference,
        "match_status": row.match_status,
        "system_row_id": row.system_row_id or None,
    }


def _build_summary(
    bank_rows: list[BankStatementRow],
    system_rows: list[BankStatementRow],
    matches: list[BankStatementMatch],
) -> dict:
    bank_debit = sum((r.money_out for r in bank_rows), Decimal("0"))
    bank_credit = sum((r.money_in for r in bank_rows), Decimal("0"))
    system_out = sum((r.money_out for r in system_rows), Decimal("0"))
    system_in = sum((r.money_in for r in system_rows), Decimal("0"))

    dates = [r.row_date for r in bank_rows + system_rows if r.row_date]
    date_from = min(dates).isoformat() if dates else None
    date_to = max(dates).isoformat() if dates else None

    exact_count = sum(1 for m in matches if m.match_type == BankStatementMatch.MatchType.EXACT)
    possible_count = sum(1 for m in matches if m.match_type == BankStatementMatch.MatchType.POSSIBLE)
    bank_only = sum(1 for r in bank_rows if r.match_status == BankStatementRow.MatchStatus.BANK_ONLY)
    system_only = sum(
        1 for r in system_rows if r.match_status == BankStatementRow.MatchStatus.SYSTEM_ONLY
    )

    amount_diff = abs(bank_debit - system_out) + abs(bank_credit - system_in)

    return {
        "bank_total_debit": _money_str(bank_debit),
        "bank_total_credit": _money_str(bank_credit),
        "system_total_money_out": _money_str(system_out),
        "system_total_money_in": _money_str(system_in),
        "matched_count": exact_count,
        "possible_match_count": possible_count,
        "bank_only_count": bank_only,
        "system_only_count": system_only,
        "amount_difference_total": _money_str(amount_diff),
        "date_from": date_from,
        "date_to": date_to,
        "bank_row_count": len(bank_rows),
        "system_row_count": len(system_rows),
    }


def _match_rows(bank_rows: list[BankStatementRow], system_rows: list[BankStatementRow]) -> list[BankStatementMatch]:
    matches: list[BankStatementMatch] = []
    used_bank: set[int] = set()
    used_system: set[int] = set()

    def try_pair(bank_row, system_row, match_type, confidence, reason):
        if bank_row.pk in used_bank or system_row.pk in used_system:
            return False
        used_bank.add(bank_row.pk)
        used_system.add(system_row.pk)
        if match_type == BankStatementMatch.MatchType.EXACT:
            bank_row.match_status = BankStatementRow.MatchStatus.EXACT
            system_row.match_status = BankStatementRow.MatchStatus.EXACT
        else:
            bank_row.match_status = BankStatementRow.MatchStatus.POSSIBLE
            system_row.match_status = BankStatementRow.MatchStatus.POSSIBLE
        matches.append(
            BankStatementMatch(
                job=bank_row.job,
                bank_row=bank_row,
                system_row=system_row,
                match_type=match_type,
                confidence=Decimal(str(confidence)).quantize(Decimal("0.01")),
                reason=reason,
            )
        )
        return True

    def pair_exact_or_ambiguous(
        bank_row: BankStatementRow,
        candidates: list[BankStatementRow],
        *,
        reason_single: str,
        reason_multiple: str,
        confidence_single: float = 100,
        confidence_multiple: float = 75,
    ) -> bool:
        if not candidates:
            return False
        if len(candidates) == 1:
            return try_pair(
                bank_row,
                candidates[0],
                BankStatementMatch.MatchType.EXACT,
                confidence_single,
                reason_single,
            )
        chosen = _pick_closest_by_posting_date(bank_row, candidates)
        return try_pair(
            bank_row,
            chosen,
            BankStatementMatch.MatchType.POSSIBLE,
            confidence_multiple,
            reason_multiple,
        )

    # Same bank posting date + amount/direction.
    for bank_row in bank_rows:
        if bank_row.pk in used_bank or not bank_row.row_date:
            continue
        candidates = [
            system_row
            for system_row in _same_amount_direction_candidates(bank_row, system_rows, used_system)
            if system_row.row_date == bank_row.row_date
        ]
        pair_exact_or_ambiguous(
            bank_row,
            candidates,
            reason_single="Same date, amount, and direction",
            reason_multiple="Multiple system candidates with same date, amount, and direction",
        )

    # Description transaction-date hint (e.g. PUR 05/05) vs system row date.
    for bank_row in bank_rows:
        if bank_row.pk in used_bank:
            continue
        hints = extract_transaction_date_hints(bank_row.description, bank_row.row_date)
        if not hints:
            continue
        candidates = [
            system_row
            for system_row in _same_amount_direction_candidates(bank_row, system_rows, used_system)
            if system_row.row_date in hints
        ]
        pair_exact_or_ambiguous(
            bank_row,
            candidates,
            reason_single=DESC_DATE_MATCH_REASON,
            reason_multiple=(
                "Multiple system candidates match amount, direction, and description date hint"
            ),
        )

    # Posting date within tolerance when there is a single amount/direction candidate.
    for bank_row in bank_rows:
        if bank_row.pk in used_bank:
            continue
        candidates = [
            system_row
            for system_row in _same_amount_direction_candidates(bank_row, system_rows, used_system)
            if (_date_diff_days(bank_row.row_date, system_row.row_date) or 999)
            <= DATE_TOLERANCE_DAYS
        ]
        if len(candidates) == 1:
            day_diff = _date_diff_days(bank_row.row_date, candidates[0].row_date) or 0
            try_pair(
                bank_row,
                candidates[0],
                BankStatementMatch.MatchType.EXACT,
                max(85, 100 - day_diff * 5),
                f"Same amount and direction; posting date within {day_diff} day(s)",
            )
        elif len(candidates) > 1:
            chosen = _pick_closest_by_posting_date(bank_row, candidates)
            day_diff = _date_diff_days(bank_row.row_date, chosen.row_date) or 0
            try_pair(
                bank_row,
                chosen,
                BankStatementMatch.MatchType.POSSIBLE,
                max(70, 90 - day_diff * 5),
                "Multiple system candidates with same amount and direction within date tolerance",
            )

    # Possible: amount tolerance + description similarity.
    for bank_row in bank_rows:
        if bank_row.pk in used_bank:
            continue
        best: tuple[BankStatementRow, float, str] | None = None
        for system_row in system_rows:
            if system_row.pk in used_system:
                continue
            if bank_row.normalized_direction != system_row.normalized_direction:
                continue
            amount_diff = abs(bank_row.normalized_amount - system_row.normalized_amount)
            if amount_diff > AMOUNT_TOLERANCE:
                continue
            sim = _description_similarity(bank_row.description, system_row.description)
            if sim < 0.15 and amount_diff > 0:
                continue
            day_diff = _date_diff_days(bank_row.row_date, system_row.row_date)
            day_penalty = (day_diff or 0) * 3
            confidence = min(85, 50 + sim * 40 + float(AMOUNT_TOLERANCE - amount_diff) * 5 - day_penalty)
            reason = f"Amount within AED {AMOUNT_TOLERANCE}; description similarity {sim:.0%}"
            if day_diff is not None and day_diff > DATE_TOLERANCE_DAYS:
                reason += f"; date {day_diff} day(s) apart"
            if best is None or confidence > best[1]:
                best = (system_row, confidence, reason)
        if best and best[1] >= 45:
            try_pair(bank_row, best[0], BankStatementMatch.MatchType.POSSIBLE, best[1], best[2])

    for bank_row in bank_rows:
        if bank_row.pk not in used_bank:
            bank_row.match_status = BankStatementRow.MatchStatus.BANK_ONLY
    for system_row in system_rows:
        if system_row.pk not in used_system:
            system_row.match_status = BankStatementRow.MatchStatus.SYSTEM_ONLY

    return matches


def _statement_date_range(parse_result: ParseResult) -> tuple[date | None, date | None]:
    dates = [r.row_date for r in parse_result.rows if r.row_date]
    if not dates:
        return None, None
    return min(dates), max(dates)


@transaction.atomic
def create_statement_comparison_job(
    card: BankCard,
    file_obj,
    filename: str,
    uploaded_by,
) -> BankStatementComparisonJob:
    balance_before = card.balance

    job = BankStatementComparisonJob.objects.create(
        payment_method=card,
        file_name=filename,
        uploaded_by=uploaded_by,
        status=BankStatementComparisonJob.Status.PENDING,
    )

    try:
        file_obj.seek(0)
        parse_result = parse_bank_statement_file(file_obj, filename)
        date_from, date_to = _statement_date_range(parse_result)
        expanded_from = (
            date_from - timedelta(days=DATE_TOLERANCE_DAYS) if date_from else None
        )
        expanded_to = date_to + timedelta(days=DATE_TOLERANCE_DAYS) if date_to else None

        statement = build_payment_method_statement(
            card,
            date_from=expanded_from.isoformat() if expanded_from else None,
            date_to=expanded_to.isoformat() if expanded_to else None,
        )

        bank_row_models: list[BankStatementRow] = []
        for item in parse_result.rows:
            direction, amount = _direction_and_amount(item.money_in, item.money_out)
            bank_row_models.append(
                BankStatementRow(
                    job=job,
                    source=BankStatementRow.Source.BANK,
                    row_date=item.row_date,
                    description=item.description,
                    money_in=item.money_in,
                    money_out=item.money_out,
                    balance=item.balance,
                    reference=item.reference,
                    normalized_amount=amount,
                    normalized_direction=direction,
                    raw_json=item.raw,
                    match_status=BankStatementRow.MatchStatus.BANK_ONLY,
                )
            )
        BankStatementRow.objects.bulk_create(bank_row_models)
        bank_row_models = list(job.rows.filter(source=BankStatementRow.Source.BANK))

        system_row_models: list[BankStatementRow] = []
        for row in statement["rows"]:
            money_in = _dec(row.get("money_in"))
            money_out = _dec(row.get("money_out"))
            direction, amount = _direction_and_amount(money_in, money_out)
            row_date = None
            if row.get("date"):
                row_date = date.fromisoformat(row["date"])
            system_row_models.append(
                BankStatementRow(
                    job=job,
                    source=BankStatementRow.Source.SYSTEM,
                    row_date=row_date,
                    description=row.get("description") or "",
                    money_in=money_in,
                    money_out=money_out,
                    balance=_dec(row.get("running_balance")) if row.get("running_balance") else None,
                    reference=row.get("reference") or "",
                    normalized_amount=amount,
                    normalized_direction=direction,
                    raw_json=row,
                    match_status=BankStatementRow.MatchStatus.SYSTEM_ONLY,
                    system_row_id=row.get("id") or "",
                )
            )
        BankStatementRow.objects.bulk_create(system_row_models)
        system_row_models = list(job.rows.filter(source=BankStatementRow.Source.SYSTEM))

        match_models = _match_rows(bank_row_models, system_row_models)
        BankStatementRow.objects.bulk_update(
            bank_row_models + system_row_models,
            ["match_status"],
        )
        if match_models:
            BankStatementMatch.objects.bulk_create(match_models)

        summary = _build_summary(bank_row_models, system_row_models, match_models)
        job.summary_json = summary
        job.detected_columns_json = {
            "columns": parse_result.detected_columns,
            "format": parse_result.format_detected,
            "header_row_index": parse_result.header_row_index,
        }
        job.status = BankStatementComparisonJob.Status.READY
        job.save(
            update_fields=["summary_json", "detected_columns_json", "status"],
        )
    except Exception as exc:
        job.status = BankStatementComparisonJob.Status.FAILED
        job.error_message = str(exc)
        job.save(update_fields=["status", "error_message"])
        raise

    card.refresh_from_db()
    if card.balance != balance_before:
        raise RuntimeError("Bank card balance was mutated during statement comparison.")

    return job


def serialize_comparison_job(job: BankStatementComparisonJob) -> dict:
    bank_rows = list(job.rows.filter(source=BankStatementRow.Source.BANK).order_by("row_date", "pk"))
    system_rows = list(job.rows.filter(source=BankStatementRow.Source.SYSTEM).order_by("row_date", "pk"))
    match_rows = list(
        job.matches.select_related("bank_row", "system_row").order_by("-confidence", "pk")
    )

    exact_matches = []
    possible_matches = []
    for match in match_rows:
        payload = {
            "id": match.pk,
            "match_type": match.match_type,
            "confidence": str(match.confidence),
            "reason": match.reason,
            "bank_row": _serialize_row(match.bank_row),
            "system_row": _serialize_row(match.system_row),
        }
        if match.match_type == BankStatementMatch.MatchType.EXACT:
            exact_matches.append(payload)
        else:
            possible_matches.append(payload)

    bank_only = [_serialize_row(r) for r in bank_rows if r.match_status == BankStatementRow.MatchStatus.BANK_ONLY]
    system_only = [
        _serialize_row(r) for r in system_rows if r.match_status == BankStatementRow.MatchStatus.SYSTEM_ONLY
    ]

    return {
        "id": job.pk,
        "payment_method_id": job.payment_method_id,
        "file_name": job.file_name,
        "status": job.status,
        "error_message": job.error_message,
        "summary": job.summary_json,
        "detected_columns": job.detected_columns_json,
        "created_at": job.created_at.isoformat(),
        "exact_matches": exact_matches,
        "possible_matches": possible_matches,
        "bank_only": bank_only,
        "system_only": system_only,
    }
