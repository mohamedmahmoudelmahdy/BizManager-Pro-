"""Debt liability payment workflows."""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from expenses.models import Expense
from financial_control.models import DebtLiability, DebtPayment, LedgerEntry
from financial_control.services import ledger as ledger_svc
from financial_control.services.money import create_expense_atomic


def debt_display_status(debt: DebtLiability, today=None) -> str:
    today = today or timezone.localdate()
    if debt.remaining_balance <= 0:
        return "paid"
    if debt.next_payment_date and debt.next_payment_date < today:
        return "overdue"
    if debt.paid_amount > 0:
        return "partially_paid"
    return debt.status


def refresh_debt_risk(debt: DebtLiability) -> DebtLiability:
    today = timezone.localdate()
    if debt.remaining_balance <= 0:
        debt.risk_level = DebtLiability.RiskLevel.LOW
    elif debt.next_payment_date and debt.next_payment_date < today:
        debt.risk_level = DebtLiability.RiskLevel.HIGH
    elif debt.next_payment_date and (debt.next_payment_date - today).days <= 14:
        debt.risk_level = DebtLiability.RiskLevel.MEDIUM
    else:
        debt.risk_level = DebtLiability.RiskLevel.LOW
    debt.save(update_fields=["risk_level", "updated_at"])
    return debt


@transaction.atomic
def pay_debt(
    debt: DebtLiability,
    user,
    *,
    amount: Decimal,
    payment_method_id: str,
    payment_date=None,
    reference_number: str = "",
    notes: str = "",
    expense_category: str = Expense.Category.MISC,
    create_expense: bool = True,
    create_ledger_entry: bool = True,
) -> dict:
    if debt.status == DebtLiability.Status.CLOSED and debt.remaining_balance <= 0:
        raise ValueError("Debt is already fully paid.")

    amount = Decimal(str(amount))
    if amount <= 0:
        raise ValueError("Payment amount must be greater than zero.")
    if amount > debt.remaining_balance:
        raise ValueError("Payment exceeds remaining balance.")

    from banking.models import BankCard

    bank = BankCard.objects.select_for_update().get(pk=payment_method_id)
    pay_date = payment_date or timezone.localdate()

    expense = None
    ledger_entry = None

    if create_expense:
        expense = create_expense_atomic(
            category=expense_category,
            amount=amount,
            paid_by=bank,
            date=pay_date,
            notes=notes or f"Debt payment: {debt.name}",
        )

    if create_ledger_entry and debt.linked_ledger_account_id:
        entry = LedgerEntry.objects.create(
            ledger_account=debt.linked_ledger_account,
            date=pay_date,
            description=f"Debt payment: {debt.name}",
            entry_type=LedgerEntry.EntryType.DEBIT,
            amount=amount,
            status=LedgerEntry.Status.DRAFT,
            source_type=LedgerEntry.SourceType.DEBT_PAYMENT,
            source_id=str(debt.id),
            related_expense=expense,
            related_payment_method=bank,
            notes=notes,
            created_by=user,
        )
        ledger_entry = ledger_svc.post_ledger_entry(entry)

    payment = DebtPayment.objects.create(
        debt=debt,
        amount=amount,
        payment_date=pay_date,
        payment_method=bank,
        reference_number=reference_number,
        notes=notes,
        created_by=user,
        linked_expense=expense,
        linked_ledger_entry=ledger_entry,
    )

    debt = DebtLiability.objects.select_for_update().get(pk=debt.pk)
    debt.paid_amount = (debt.paid_amount or Decimal("0")) + amount
    debt.remaining_balance = max(Decimal("0"), debt.original_amount - debt.paid_amount)
    if debt.remaining_balance <= 0:
        debt.status = DebtLiability.Status.CLOSED
        debt.closed_at = timezone.now()
    debt.save(
        update_fields=[
            "paid_amount",
            "remaining_balance",
            "status",
            "closed_at",
            "updated_at",
        ]
    )
    refresh_debt_risk(debt)

    return {
        "debt": debt,
        "payment": payment,
        "expense_id": str(expense.id) if expense else None,
        "ledger_entry_id": str(ledger_entry.id) if ledger_entry else None,
    }
