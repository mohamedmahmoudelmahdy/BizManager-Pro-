"""
Ledger posting engine — accounting layer only (no BankCard mutations).
"""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from banking.models import BankCard
from financial_control.models import EmployeeAdvanceDeduction, LedgerAccount, LedgerEntry


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


def _entry_moves_payment_method(entry: LedgerEntry) -> bool:
    """Only explicit, manual entries with a linked payment method move cash.

    System-generated entries (expense, transfer, check, debt, payroll, import)
    already moved money in their own services, so they must never re-mutate the
    BankCard balance here — this prevents double mutation.
    """
    return bool(
        entry.affects_payment_method
        and entry.source_type == LedgerEntry.SourceType.MANUAL
        and entry.related_payment_method_id
    )


def _apply_payment_method_delta(entry: LedgerEntry, *, reverse: bool = False) -> tuple[Decimal, Decimal]:
    """Atomically move the linked BankCard balance for a ledger entry.

    Credit increases the payment method balance; debit decreases it.
    Returns (before, after). Raises ValueError on insufficient balance.
    Must be called inside a transaction.
    """
    card = BankCard.objects.select_for_update().get(pk=entry.related_payment_method_id)
    before = _quantize(Decimal(str(card.balance or 0)))
    effective_type = entry.entry_type
    if reverse:
        effective_type = (
            LedgerEntry.EntryType.DEBIT
            if entry.entry_type == LedgerEntry.EntryType.CREDIT
            else LedgerEntry.EntryType.CREDIT
        )
    amount = _quantize(Decimal(str(entry.amount)))
    if effective_type == LedgerEntry.EntryType.CREDIT:
        after = _quantize(before + amount)
    else:
        after = _quantize(before - amount)
        if after < 0:
            raise ValueError("Insufficient payment method balance for this debit.")
    card.balance = after
    card.save(update_fields=["balance"])
    return before, after


def apply_entry_delta(balance: Decimal, entry_type: str, amount: Decimal) -> Decimal:
    """Credit increases balance; debit decreases balance."""
    amount = _quantize(Decimal(str(amount)))
    if entry_type == LedgerEntry.EntryType.CREDIT:
        return _quantize(balance + amount)
    return _quantize(balance - amount)


def unreconciled_count(account: LedgerAccount) -> int:
    """Blocking unreconciled entries used for closing and warnings.

    Definition (single source of truth): normal entries with status posted/draft
    that are NOT reversal entries. Reversed originals (status=reversed) are already
    excluded by status, and reversal counterparts (reversal_of set) never block
    closure because they are automatic balancing rows.
    """
    return account.entries.filter(
        status__in=[LedgerEntry.Status.POSTED, LedgerEntry.Status.DRAFT],
        reversal_of__isnull=True,
    ).count()


def can_close_account(account: LedgerAccount) -> tuple[bool, str]:
    if account.status == LedgerAccount.Status.CLOSED:
        return False, "Account is already closed."
    if account.current_balance != Decimal("0"):
        return False, "Account balance must be zero before closing."
    if unreconciled_count(account) > 0:
        return False, "Account has draft or unreconciled posted entries."
    return True, ""


def can_reverse_ledger_entry_generically(entry: LedgerEntry) -> tuple[bool, str]:
    """Only pure manual ledger-only entries may use the generic reverse endpoint."""
    if entry.reversal_of_id is not None:
        return False, "A reversal entry cannot be reversed."
    if entry.status == LedgerEntry.Status.REVERSED:
        return False, "This entry has already been reversed."

    if EmployeeAdvanceDeduction.objects.filter(linked_ledger_entry=entry).exists():
        return (
            False,
            "This entry is linked to a salary advance deduction. Reverse it from Employee Financials.",
        )

    operational_sources = {
        LedgerEntry.SourceType.EXPENSE,
        LedgerEntry.SourceType.PAYMENT,
        LedgerEntry.SourceType.DEPOSIT,
        LedgerEntry.SourceType.CHECK,
        LedgerEntry.SourceType.DEBT_PAYMENT,
        LedgerEntry.SourceType.PAYROLL,
        LedgerEntry.SourceType.IMPORT,
    }
    if entry.source_type in operational_sources:
        label = entry.get_source_type_display()
        return (
            False,
            f"Operational ledger entries ({label}) must be reversed from their source module, "
            "not the generic ledger reverse.",
        )

    if entry.related_expense_id or entry.related_payment_id or entry.related_procedure_id:
        return (
            False,
            "This entry is linked to an operational record and cannot be reversed generically.",
        )

    return True, ""


@transaction.atomic
def post_ledger_entry(entry: LedgerEntry) -> LedgerEntry:
    if entry.status != LedgerEntry.Status.DRAFT:
        raise ValueError("Only draft entries can be posted.")

    account = LedgerAccount.objects.select_for_update().get(pk=entry.ledger_account_id)
    previous = _quantize(account.current_balance)
    resulting = apply_entry_delta(previous, entry.entry_type, entry.amount)

    entry.previous_balance = previous
    entry.resulting_balance = resulting
    entry.running_balance = resulting
    entry.status = LedgerEntry.Status.POSTED

    update_fields = [
        "previous_balance",
        "resulting_balance",
        "running_balance",
        "status",
    ]

    # Optionally move the linked payment method balance (manual entries only).
    if _entry_moves_payment_method(entry):
        before, after = _apply_payment_method_delta(entry)
        entry.payment_method_balance_before = before
        entry.payment_method_balance_after = after
        update_fields += ["payment_method_balance_before", "payment_method_balance_after"]

    entry.save(update_fields=update_fields)

    account.current_balance = resulting
    account.last_activity_at = timezone.now()
    account.save(update_fields=["current_balance", "last_activity_at", "updated_at"])

    return entry


@transaction.atomic
def reconcile_ledger_entry(entry: LedgerEntry) -> LedgerEntry:
    if entry.reversal_of_id is not None:
        raise ValueError("Reversal entries cannot be reconciled.")
    if entry.status != LedgerEntry.Status.POSTED:
        raise ValueError("Only posted entries can be reconciled.")
    entry.status = LedgerEntry.Status.RECONCILED
    entry.reconciled_at = timezone.now()
    entry.save(update_fields=["status", "reconciled_at"])

    account = entry.ledger_account
    account.last_reconciled_at = timezone.now()
    account.save(update_fields=["last_reconciled_at", "updated_at"])
    return entry


@transaction.atomic
def reverse_ledger_entry(entry: LedgerEntry, user, reason: str = "") -> tuple[LedgerEntry, LedgerEntry]:
    # Lock the row to avoid a race where two requests reverse the same entry.
    entry = LedgerEntry.objects.select_for_update().get(pk=entry.pk)

    # A reversal entry itself cannot be reversed (prevents "Reversal of Reversal" chains).
    if entry.reversal_of_id is not None:
        raise ValueError("A reversal entry cannot be reversed.")
    if entry.status == LedgerEntry.Status.REVERSED:
        raise ValueError("This entry has already been reversed.")
    if entry.status not in (LedgerEntry.Status.POSTED, LedgerEntry.Status.RECONCILED):
        raise ValueError("Only posted or reconciled entries can be reversed.")
    # Defensive: block if a reversal already exists for this entry.
    if LedgerEntry.objects.filter(reversal_of=entry).exists():
        raise ValueError("This entry has already been reversed.")

    account = LedgerAccount.objects.select_for_update().get(pk=entry.ledger_account_id)
    opposite = (
        LedgerEntry.EntryType.DEBIT
        if entry.entry_type == LedgerEntry.EntryType.CREDIT
        else LedgerEntry.EntryType.CREDIT
    )

    previous = _quantize(account.current_balance)
    resulting = apply_entry_delta(previous, opposite, entry.amount)

    reversal = LedgerEntry.objects.create(
        ledger_account=account,
        date=timezone.localdate(),
        description=f"Reversal of: {entry.description[:200]}",
        entry_type=opposite,
        amount=entry.amount,
        previous_balance=previous,
        resulting_balance=resulting,
        running_balance=resulting,
        status=LedgerEntry.Status.POSTED,
        source_type=entry.source_type,
        source_id=str(entry.id),
        reversal_of=entry,
        notes=f"Reversal of entry {entry.id}",
        created_by=user,
    )

    # If the original entry moved cash, reverse the payment method balance once.
    if _entry_moves_payment_method(entry):
        before, after = _apply_payment_method_delta(entry, reverse=True)
        reversal.affects_payment_method = True
        reversal.related_payment_method_id = entry.related_payment_method_id
        reversal.payment_method_balance_before = before
        reversal.payment_method_balance_after = after
        reversal.save(
            update_fields=[
                "affects_payment_method",
                "related_payment_method",
                "payment_method_balance_before",
                "payment_method_balance_after",
            ]
        )

    entry.status = LedgerEntry.Status.REVERSED
    entry.reversed_at = timezone.now()
    entry.reversed_by = user
    entry.reversal_reason = reason or ""
    entry.save(update_fields=["status", "reversed_at", "reversed_by", "reversal_reason"])

    account.current_balance = resulting
    account.last_activity_at = timezone.now()
    account.save(update_fields=["current_balance", "last_activity_at", "updated_at"])

    return entry, reversal


@transaction.atomic
def reconcile_account_entries(account: LedgerAccount) -> LedgerAccount:
    """Mark all posted entries reconciled and stamp account reconciliation time."""
    account = LedgerAccount.objects.select_for_update().get(pk=account.pk)
    now = timezone.now()
    # Reversal entries are excluded — they are an automatic audit counterpart.
    account.entries.filter(
        status=LedgerEntry.Status.POSTED, reversal_of__isnull=True
    ).update(status=LedgerEntry.Status.RECONCILED, reconciled_at=now)
    account.last_reconciled_at = now
    account.save(update_fields=["last_reconciled_at", "updated_at"])
    return account


@transaction.atomic
def close_ledger_account(account: LedgerAccount, reason: str = "") -> LedgerAccount:
    account = LedgerAccount.objects.select_for_update().get(pk=account.pk)
    ok, msg = can_close_account(account)
    if not ok:
        raise ValueError(msg)
    account.status = LedgerAccount.Status.CLOSED
    account.closed_at = timezone.now()
    account.closed_reason = reason or ""
    account.save(update_fields=["status", "closed_at", "closed_reason", "updated_at"])
    return account
