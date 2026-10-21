"""Atomic money operations — delegates to existing expense balance logic."""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from banking.models import BankCard
from expenses.models import Expense


@transaction.atomic
def create_expense_atomic(
    *,
    category: str,
    amount: Decimal,
    paid_by: BankCard,
    date=None,
    assigned_employee=None,
    notes: str = "",
    payroll_type: str = "",
    payroll_period=None,
) -> Expense:
    """Mirror ExpenseViewSet.perform_create — single source of truth for bank debits."""
    amount_dec = Decimal(str(amount))
    if amount_dec <= 0:
        raise ValueError("Amount must be greater than zero.")
    if not paid_by:
        raise ValueError("Payment method is required.")

    locked = BankCard.objects.select_for_update().get(pk=paid_by.pk)
    if locked.balance - amount_dec < 0:
        raise ValueError("Insufficient balance for this expense.")

    locked.balance = locked.balance - amount_dec
    locked.save(update_fields=["balance"])

    return Expense.objects.create(
        category=category,
        amount=amount_dec,
        date=date or timezone.localdate(),
        paid_by=locked,
        assigned_employee=assigned_employee,
        expense_for=assigned_employee,
        notes=notes,
        payroll_type=payroll_type or "",
        payroll_period=payroll_period,
        workflow_status=Expense.WorkflowStatus.PAID,
        paid_at=timezone.now(),
    )
