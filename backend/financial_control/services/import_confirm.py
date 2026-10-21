"""Excel import confirmation — creates real financial records from validated rows.

Safety model:
- Runs inside a single atomic transaction (all-or-nothing rollback).
- Blocked entirely if the job still has error rows.
- Idempotent: a job that is importing/confirmed/completed cannot be run again.
- Never auto-deducts checks, auto-pays debts, creates payroll, or imports
  customer payments. Ledger entries are created as DRAFT and never move a
  payment method balance. Expenses debit their payment method via the existing
  atomic money service; transfers move balances via the existing deposit logic.
- Every created record is linked back to its FinancialImportRow (audit trail).
"""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from banking.models import BankCard
from deposits.models import Deposit
from expenses.models import Expense
from financial_control.models import (
    CheckPDC,
    DebtLiability,
    FinancialImportJob,
    FinancialImportRow,
    LedgerAccount,
    LedgerEntry,
)
from financial_control.services.checks import refresh_check_meta
from financial_control.services.debts import refresh_debt_risk
from financial_control.services.money import create_expense_atomic


class ImportError_(ValueError):
    """Raised on an unrecoverable import problem (triggers full rollback)."""


def _dec(value) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(Decimal("0.01"))
    except Exception:  # noqa: BLE001
        return Decimal("0.00")


def _as_date(value, default=None):
    """Parse an ISO date string (as stored by the preview parser) to a date."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return date.fromisoformat(value.strip()[:10])
        except ValueError:
            return default
    return default


def _row_hash(row: FinancialImportRow) -> str:
    payload = json.dumps(
        {"type": row.detected_type, "data": row.normalized_data_json},
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _resolve_bank_card(name: str):
    if not name:
        return None
    return BankCard.objects.filter(bank_name__iexact=name.strip()).first()


def _expense_category(type_hint: str) -> str:
    hint = (type_hint or "").lower()
    if "office" in hint:
        return Expense.Category.OFFICE
    if "government" in hint or "gov" in hint:
        return Expense.Category.GOVERNMENT_FEES
    return Expense.Category.MISC


def _mark(row, status, *, obj_type="", obj_id="", ledger_entry=None):
    row.status = status
    if obj_type:
        row.linked_object_type = obj_type
        row.linked_object_id = str(obj_id)
    if ledger_entry is not None:
        row.linked_ledger_entry = ledger_entry
    row.save(
        update_fields=[
            "status",
            "linked_object_type",
            "linked_object_id",
            "linked_ledger_entry",
        ]
    )


def import_ledger_account_row(name: str, user) -> LedgerAccount:
    """Match a ledger account by name (case-insensitive) or create it."""
    name = (name or "Imported Account").strip() or "Imported Account"
    account = LedgerAccount.objects.filter(name__iexact=name).first()
    if account:
        return account
    return LedgerAccount.objects.create(
        name=name,
        account_type=LedgerAccount.AccountType.OTHER,
        status=LedgerAccount.Status.ACTIVE,
        created_by=user,
    )


def import_ledger_account_only_row(row: FinancialImportRow, job, user):
    """A row that only defines a ledger account (e.g. a TOTAL/summary sheet)."""
    data = row.normalized_data_json or {}
    name = data.get("account_name") or data.get("payee") or data.get("description")
    if not name:
        _mark(row, FinancialImportRow.RowStatus.SKIPPED)
        return None
    account = import_ledger_account_row(name, user)
    _mark(row, FinancialImportRow.RowStatus.IMPORTED, obj_type="ledger_account", obj_id=account.id)
    return account


def import_ledger_entry_row(row: FinancialImportRow, job, user) -> LedgerEntry:
    data = row.normalized_data_json or {}
    # Prefer the mapped account name (sheet/header), then payee, then sheet name.
    account = import_ledger_account_row(
        data.get("account_name") or row.sheet_name or data.get("payee"), user
    )
    mapped_type = (data.get("entry_type") or "").lower()
    if mapped_type in ("debit", "credit"):
        entry_type = (
            LedgerEntry.EntryType.CREDIT
            if mapped_type == "credit"
            else LedgerEntry.EntryType.DEBIT
        )
    else:
        hint = f"{data.get('type_hint', '')} {data.get('description', '')}".lower()
        entry_type = (
            LedgerEntry.EntryType.CREDIT if "credit" in hint else LedgerEntry.EntryType.DEBIT
        )
    entry = LedgerEntry.objects.create(
        ledger_account=account,
        date=_as_date(data.get("date"), timezone.localdate()),
        description=(data.get("description") or "Imported entry")[:512],
        entry_type=entry_type,
        amount=_dec(data.get("amount")),
        status=LedgerEntry.Status.DRAFT,  # never auto-post; safe default
        source_type=LedgerEntry.SourceType.IMPORT,
        source_id=str(job.id),
        notes=data.get("payee", ""),
        created_by=user,
    )
    _mark(row, FinancialImportRow.RowStatus.IMPORTED, obj_type="ledger_entry", obj_id=entry.id, ledger_entry=entry)
    return entry


def import_expense_row(row: FinancialImportRow, job, user) -> Expense:
    data = row.normalized_data_json or {}
    card = _resolve_bank_card(data.get("payment_method", ""))
    if card is None:
        raise ImportError_(
            f"Row {row.row_number} ({row.sheet_name}): payment method "
            f"'{data.get('payment_method', '')}' was not found."
        )
    expense = create_expense_atomic(
        category=_expense_category(data.get("type_hint", "")),
        amount=_dec(data.get("amount")),
        paid_by=card,
        date=_as_date(data.get("date"), timezone.localdate()),
        notes=(data.get("description") or f"Imported expense (job {job.id})"),
    )
    _mark(row, FinancialImportRow.RowStatus.IMPORTED, obj_type="expense", obj_id=expense.id)
    return expense


def import_check_row(row: FinancialImportRow, job, user):
    data = row.normalized_data_json or {}
    check_number = (data.get("check_number") or "").strip()
    # Duplicate protection: never create a second check with the same number.
    if check_number and CheckPDC.objects.filter(check_number=check_number).exists():
        _mark(row, FinancialImportRow.RowStatus.SKIPPED)
        return None
    check = CheckPDC.objects.create(
        check_number=check_number or f"IMP-{row.row_number}",
        payee=(data.get("payee") or data.get("description") or "Imported payee")[:255],
        amount=_dec(data.get("amount")),
        due_date=_as_date(data.get("due_date")) or _as_date(data.get("date"), timezone.localdate()),
        status=CheckPDC.Status.PENDING,  # pending future obligation; no bank debit
        check_type=CheckPDC.CheckType.OTHER,
        notes=(data.get("description") or ""),
        created_by=user,
    )
    refresh_check_meta(check)
    _mark(row, FinancialImportRow.RowStatus.IMPORTED, obj_type="check", obj_id=check.id)
    return check


def import_debt_row(row: FinancialImportRow, job, user) -> DebtLiability:
    data = row.normalized_data_json or {}
    amount = _dec(data.get("amount"))
    name = (data.get("payee") or data.get("description") or "Imported debt")[:255]
    debt = DebtLiability.objects.create(
        name=name,
        creditor=(data.get("payee") or "")[:255],
        debt_type=DebtLiability.DebtType.OTHER,
        original_amount=amount,
        paid_amount=Decimal("0"),
        remaining_balance=amount,  # never auto-pay on import
        status=DebtLiability.Status.ACTIVE,
        notes=(data.get("description") or ""),
        created_by=user,
    )
    refresh_debt_risk(debt)
    _mark(row, FinancialImportRow.RowStatus.IMPORTED, obj_type="debt", obj_id=debt.id)
    return debt


def import_transfer_row(row: FinancialImportRow, job, user) -> Deposit:
    data = row.normalized_data_json or {}
    from_card = _resolve_bank_card(data.get("from_account", ""))
    to_card = _resolve_bank_card(data.get("to_account", ""))
    if from_card is None or to_card is None:
        raise ImportError_(
            f"Row {row.row_number} ({row.sheet_name}): transfer requires valid "
            f"from/to payment methods."
        )
    if from_card.pk == to_card.pk:
        raise ImportError_(
            f"Row {row.row_number} ({row.sheet_name}): transfer from/to must differ."
        )
    amount = _dec(data.get("amount"))
    locked_from = BankCard.objects.select_for_update().get(pk=from_card.pk)
    locked_to = BankCard.objects.select_for_update().get(pk=to_card.pk)
    if locked_from.balance - amount < 0:
        raise ImportError_(
            f"Row {row.row_number} ({row.sheet_name}): insufficient balance in "
            f"'{locked_from.bank_name}' for transfer."
        )
    locked_from.balance = locked_from.balance - amount
    locked_to.balance = locked_to.balance + amount
    locked_from.save(update_fields=["balance"])
    locked_to.save(update_fields=["balance"])
    deposit = Deposit.objects.create(
        date=_as_date(data.get("date"), timezone.localdate()),
        amount=amount,
        from_method=locked_from,
        to_method=locked_to,
        notes=(data.get("description") or f"Imported transfer (job {job.id})"),
    )
    _mark(row, FinancialImportRow.RowStatus.IMPORTED, obj_type="transfer", obj_id=deposit.id)
    return deposit


_DISPATCH = {
    FinancialImportRow.DetectedType.LEDGER_ACCOUNT: import_ledger_account_only_row,
    FinancialImportRow.DetectedType.LEDGER_ENTRY: import_ledger_entry_row,
    FinancialImportRow.DetectedType.EXPENSE: import_expense_row,
    FinancialImportRow.DetectedType.CHECK: import_check_row,
    FinancialImportRow.DetectedType.DEBT: import_debt_row,
    FinancialImportRow.DetectedType.TRANSFER: import_transfer_row,
}


@transaction.atomic
def confirm_import_job(job: FinancialImportJob, user) -> dict:
    """Create real records from a validated job. Atomic — raises on any failure."""
    # Idempotency: never process the same job twice.
    if job.status in (
        FinancialImportJob.Status.IMPORTING,
        FinancialImportJob.Status.CONFIRMED,
        FinancialImportJob.Status.COMPLETED,
    ):
        raise ImportError_("This import job has already been processed.")
    if job.error_rows and job.error_rows > 0:
        raise ImportError_(
            "Cannot import while the workbook has error rows. Fix them and re-validate."
        )

    job.status = FinancialImportJob.Status.IMPORTING
    job.save(update_fields=["status"])

    created = {"ledger_accounts": 0, "ledger_entries": 0, "expenses": 0, "checks": 0,
               "debts": 0, "transfers": 0}
    totals = {"ledger_accounts": Decimal("0"), "ledger_entries": Decimal("0"),
              "expenses": Decimal("0"), "checks": Decimal("0"),
              "debts": Decimal("0"), "transfers": Decimal("0")}
    imported_rows = 0
    skipped_rows = 0
    seen_hashes: set[str] = set()

    type_to_key = {
        FinancialImportRow.DetectedType.LEDGER_ACCOUNT: "ledger_accounts",
        FinancialImportRow.DetectedType.LEDGER_ENTRY: "ledger_entries",
        FinancialImportRow.DetectedType.EXPENSE: "expenses",
        FinancialImportRow.DetectedType.CHECK: "checks",
        FinancialImportRow.DetectedType.DEBT: "debts",
        FinancialImportRow.DetectedType.TRANSFER: "transfers",
    }

    for row in job.rows.all():
        if row.status == FinancialImportRow.RowStatus.ERROR:
            # Defensive: confirm is blocked above if any error rows exist.
            raise ImportError_(f"Row {row.row_number} is an error row.")

        # Duplicate row protection within the same file.
        rhash = _row_hash(row)
        if rhash in seen_hashes:
            _mark(row, FinancialImportRow.RowStatus.SKIPPED)
            skipped_rows += 1
            continue
        seen_hashes.add(rhash)

        handler = _DISPATCH.get(row.detected_type)
        if handler is None:
            _mark(row, FinancialImportRow.RowStatus.SKIPPED)
            skipped_rows += 1
            continue

        obj = handler(row, job, user)
        if obj is None:  # handler chose to skip (e.g. duplicate check number)
            skipped_rows += 1
            continue

        key = type_to_key[row.detected_type]
        created[key] += 1
        totals[key] += _dec((row.normalized_data_json or {}).get("amount"))
        imported_rows += 1

    now = timezone.now()
    job.status = FinancialImportJob.Status.COMPLETED
    job.confirmed_by = user
    job.confirmed_at = now
    job.completed_at = now
    result = {
        "imported_rows": imported_rows,
        "skipped_rows": skipped_rows,
        "failed_rows": 0,
        "created": created,
        "totals": {k: float(v) for k, v in totals.items()},
        "confirmed_by": getattr(user, "username", ""),
        "confirmed_at": now.isoformat(),
    }
    job.summary_json = {
        **(job.summary_json or {}),
        "confirm_disabled": False,
        "import_result": result,
        "message": "Import completed.",
    }
    job.save(update_fields=["status", "confirmed_by", "confirmed_at", "completed_at", "summary_json"])
    return result
