"""Check / PDC workflows — deduct touches BankCard; create does not."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from expenses.models import Expense
from financial_control.models import CheckPDC, LedgerEntry
from financial_control.services import ledger as ledger_svc
from financial_control.services.money import create_expense_atomic


def compute_risk_level(check: CheckPDC, today: date | None = None) -> str:
    today = today or timezone.localdate()
    if check.status in (CheckPDC.Status.DEDUCTED, CheckPDC.Status.CANCELLED, CheckPDC.Status.REPLACED):
        return CheckPDC.RiskLevel.NONE

    days = (check.due_date - today).days
    bank = check.bank_account
    insufficient = bank and bank.balance < check.amount

    if days < 0 or insufficient:
        return CheckPDC.RiskLevel.HIGH
    if days <= 7:
        return CheckPDC.RiskLevel.HIGH
    if days <= 14:
        return CheckPDC.RiskLevel.MEDIUM
    return CheckPDC.RiskLevel.LOW


def sync_check_status_from_due_date(check: CheckPDC, today: date | None = None) -> None:
    """Pending checks become due_soon when within 14 days."""
    today = today or timezone.localdate()
    if check.status not in (CheckPDC.Status.PENDING, CheckPDC.Status.DUE_SOON):
        return
    days = (check.due_date - today).days
    if days <= 14:
        check.status = CheckPDC.Status.DUE_SOON
    else:
        check.status = CheckPDC.Status.PENDING


def refresh_check_meta(check: CheckPDC) -> CheckPDC:
    check.risk_level = compute_risk_level(check)
    sync_check_status_from_due_date(check)
    check.save(update_fields=["risk_level", "status", "updated_at"])
    return check


@transaction.atomic
def deduct_check(
    check: CheckPDC,
    user,
    *,
    payment_method_id: str | None = None,
    expense_category: str = Expense.Category.MISC,
    create_expense: bool = True,
    create_ledger_entry: bool = True,
    notes: str = "",
) -> dict:
    if check.status not in (CheckPDC.Status.PENDING, CheckPDC.Status.DUE_SOON):
        raise ValueError("Only pending or due-soon checks can be deducted.")

    bank_id = payment_method_id or (check.bank_account_id if check.bank_account_id else None)
    if not bank_id:
        raise ValueError("Bank payment method is required to deduct.")

    from banking.models import BankCard

    bank = BankCard.objects.select_for_update().get(pk=bank_id)
    amount = Decimal(str(check.amount))

    expense = None
    ledger_entry = None

    if create_expense:
        expense = create_expense_atomic(
            category=expense_category,
            amount=amount,
            paid_by=bank,
            date=timezone.localdate(),
            notes=notes or f"Check deducted: {check.check_number} — {check.payee}",
        )
    else:
        if bank.balance - amount < 0:
            raise ValueError("Insufficient balance for this deduction.")
        bank.balance = bank.balance - amount
        bank.save(update_fields=["balance"])

    if create_ledger_entry and check.linked_ledger_account_id:
        entry = LedgerEntry.objects.create(
            ledger_account=check.linked_ledger_account,
            date=timezone.localdate(),
            description=f"Check deducted: {check.check_number} — {check.payee}",
            entry_type=LedgerEntry.EntryType.DEBIT,
            amount=amount,
            status=LedgerEntry.Status.DRAFT,
            source_type=LedgerEntry.SourceType.CHECK,
            source_id=str(check.id),
            related_expense=expense,
            related_payment_method=bank,
            notes=notes,
            created_by=user,
        )
        ledger_entry = ledger_svc.post_ledger_entry(entry)

    check.status = CheckPDC.Status.DEDUCTED
    check.deducted_at = timezone.now()
    check.bank_account = bank
    check.risk_level = CheckPDC.RiskLevel.NONE
    check.save(
        update_fields=[
            "status",
            "deducted_at",
            "bank_account",
            "risk_level",
            "updated_at",
        ]
    )

    return {
        "check": check,
        "expense_id": str(expense.id) if expense else None,
        "ledger_entry_id": str(ledger_entry.id) if ledger_entry else None,
    }


@transaction.atomic
def cancel_check(check: CheckPDC, reason: str = "") -> CheckPDC:
    if check.status == CheckPDC.Status.DEDUCTED:
        raise ValueError("Cannot cancel a deducted check.")
    check.status = CheckPDC.Status.CANCELLED
    check.cancelled_at = timezone.now()
    if reason:
        check.notes = f"{check.notes}\n[Cancelled] {reason}".strip()
    check.risk_level = CheckPDC.RiskLevel.NONE
    check.save(update_fields=["status", "cancelled_at", "notes", "risk_level", "updated_at"])
    return check


@transaction.atomic
def replace_check(check: CheckPDC, user, new_data: dict) -> tuple[CheckPDC, CheckPDC]:
    if check.status in (CheckPDC.Status.DEDUCTED, CheckPDC.Status.CANCELLED):
        raise ValueError("Cannot replace a deducted or cancelled check.")

    check.status = CheckPDC.Status.REPLACED
    check.save(update_fields=["status", "updated_at"])

    replacement = CheckPDC.objects.create(
        check_number=new_data["check_number"],
        payee=new_data.get("payee", check.payee),
        amount=Decimal(str(new_data.get("amount", check.amount))),
        due_date=new_data.get("due_date", check.due_date),
        bank_account=new_data.get("bank_account", check.bank_account),
        linked_ledger_account=new_data.get("linked_ledger_account", check.linked_ledger_account),
        related_customer=new_data.get("related_customer", check.related_customer),
        check_type=new_data.get("check_type", check.check_type),
        notes=new_data.get("notes", ""),
        created_by=user,
        replaced_by=None,
    )
    check.replaced_by = replacement
    check.save(update_fields=["replaced_by"])
    refresh_check_meta(replacement)
    return check, replacement
