"""Employee advances — atomic money movement, ledger trail, salary deduction.

Accounting model
----------------
Giving an advance is a real cash-out (a prepaid salary):
  * debit the selected payment method (BankCard)
  * record an Expense (category SALARIES, no payroll_type, marked [advance])
  * post a DEBIT entry on the employee ledger account (employee owes the business)
  * create an EmployeeAdvance row tracking the outstanding balance

When salary is paid, outstanding advances are recovered:
  * the salary cash-out is reduced by the deducted amount (net salary)
  * each advance's outstanding balance is reduced FIFO and marked settled at zero
  * a CREDIT entry is posted on the employee ledger (reduces what they owe)
  * an EmployeeAdvanceDeduction row records the history

Because the advance is itself a SALARIES expense and the salary payment is net of
the deduction, the total salaries expense for a fully-recovered advance equals the
employee's salary — no double counting of cash.
"""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from banking.models import BankCard
from expenses.models import Expense

from financial_control.models import (
    EmployeeAdvance,
    EmployeeAdvanceDeduction,
    EmployeeAdvanceRepayment,
    LedgerAccount,
    LedgerEntry,
)
from financial_control.services.money import create_expense_atomic
from financial_control.services.ledger import post_ledger_entry, reverse_ledger_entry

ADVANCE_MARKER = "[advance]"


def _dec(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def outstanding_for_user(user) -> Decimal:
    """Sum of remaining balances on this employee's active advances."""
    total = (
        EmployeeAdvance.objects.filter(
            employee=user, status=EmployeeAdvance.Status.ACTIVE
        ).aggregate(t=Sum("outstanding_balance"))
        .get("t")
    )
    return _dec(total)


def _employee_display_name(user) -> str:
    profile = getattr(user, "employee_profile", None)
    if profile and profile.full_name:
        return profile.full_name
    return getattr(user, "username", None) or f"Employee {user.pk}"


def get_or_create_employee_ledger(user, created_by=None) -> LedgerAccount:
    """One employee ledger account per user (account_type=employee)."""
    account = (
        LedgerAccount.objects.filter(
            account_type=LedgerAccount.AccountType.EMPLOYEE, linked_employee=user
        )
        .order_by("created_at")
        .first()
    )
    if account:
        return account
    return LedgerAccount.objects.create(
        name=_employee_display_name(user),
        account_type=LedgerAccount.AccountType.EMPLOYEE,
        linked_employee=user,
        status=LedgerAccount.Status.ACTIVE,
        created_by=created_by,
    )


def _post_employee_ledger_entry(
    *, account, entry_type, amount, date, description, employee, expense=None, created_by=None
) -> LedgerEntry:
    """Create + post a system ledger entry. Never moves the BankCard balance
    (source_type != manual), avoiding double mutation — cash already moved via
    the expense / salary flow."""
    entry = LedgerEntry.objects.create(
        ledger_account=account,
        date=date,
        description=description[:512],
        entry_type=entry_type,
        amount=_dec(amount),
        status=LedgerEntry.Status.DRAFT,
        source_type=LedgerEntry.SourceType.PAYROLL,
        related_employee=employee,
        related_expense=expense,
        created_by=created_by,
    )
    return post_ledger_entry(entry)


@transaction.atomic
def give_advance(
    *,
    employee_user,
    amount,
    paid_by_id,
    date=None,
    reason: str = "",
    created_by=None,
) -> EmployeeAdvance:
    """Give a cash advance to an employee. Atomic, real money movement."""
    amount_dec = _dec(amount)
    if amount_dec <= 0:
        raise ValueError("Advance amount must be greater than zero.")
    if not paid_by_id:
        raise ValueError("Payment method is required.")

    try:
        paid_by = BankCard.objects.get(pk=paid_by_id)
    except BankCard.DoesNotExist as exc:
        raise ValueError("Invalid payment method.") from exc

    advance_date = date or timezone.localdate()
    notes = f"{ADVANCE_MARKER} {reason}".strip()

    # Debits the bank atomically (select_for_update) and creates the expense.
    expense = create_expense_atomic(
        category=Expense.Category.SALARIES,
        amount=amount_dec,
        paid_by=paid_by,
        date=advance_date,
        assigned_employee=employee_user,
        notes=notes,
    )

    account = get_or_create_employee_ledger(employee_user, created_by)
    entry = _post_employee_ledger_entry(
        account=account,
        entry_type=LedgerEntry.EntryType.DEBIT,
        amount=amount_dec,
        date=advance_date,
        description=f"Employee advance — {_employee_display_name(employee_user)}",
        employee=employee_user,
        expense=expense,
        created_by=created_by,
    )

    advance = EmployeeAdvance.objects.create(
        employee=employee_user,
        amount=amount_dec,
        outstanding_balance=amount_dec,
        date=advance_date,
        reason=reason or "",
        status=EmployeeAdvance.Status.ACTIVE,
        source_account=paid_by,
        linked_expense=expense,
        linked_ledger_account=account,
        linked_ledger_entry=entry,
        created_by=created_by,
    )
    return advance


@transaction.atomic
def apply_salary_deductions(
    *,
    employee_user,
    max_deduction,
    period_key: str = "",
    salary_expense=None,
    created_by=None,
    date=None,
) -> dict:
    """Recover outstanding advances FIFO, up to ``max_deduction``.

    Returns {"deducted": Decimal, "count": int, "deductions": [EmployeeAdvanceDeduction]}.
    Must be called inside the salary-payment transaction.
    """
    cap = _dec(max_deduction)
    result = {"deducted": Decimal("0.00"), "count": 0, "deductions": []}
    if cap <= 0:
        return result

    ded_date = date or timezone.localdate()
    advances = (
        EmployeeAdvance.objects.select_for_update()
        .filter(
            employee=employee_user,
            status=EmployeeAdvance.Status.ACTIVE,
            outstanding_balance__gt=0,
        )
        .order_by("date", "created_at")
    )

    for adv in advances:
        if cap <= 0:
            break
        take = min(_dec(adv.outstanding_balance), cap)
        if take <= 0:
            continue
        adv.outstanding_balance = _dec(adv.outstanding_balance) - take
        if adv.outstanding_balance <= 0:
            adv.outstanding_balance = Decimal("0.00")
            adv.status = EmployeeAdvance.Status.SETTLED
        adv.save(update_fields=["outstanding_balance", "status", "updated_at"])

        account = adv.linked_ledger_account or get_or_create_employee_ledger(
            employee_user, created_by
        )
        entry = _post_employee_ledger_entry(
            account=account,
            entry_type=LedgerEntry.EntryType.CREDIT,
            amount=take,
            date=ded_date,
            description=f"Advance deduction from salary — {_employee_display_name(employee_user)}",
            employee=employee_user,
            expense=salary_expense,
            created_by=created_by,
        )
        deduction = EmployeeAdvanceDeduction.objects.create(
            advance=adv,
            employee=employee_user,
            amount=take,
            date=ded_date,
            period=period_key or "",
            linked_salary_expense=salary_expense,
            linked_ledger_entry=entry,
            created_by=created_by,
            notes="",
        )
        result["deductions"].append(deduction)
        result["deducted"] = _dec(result["deducted"] + take)
        result["count"] += 1
        cap = _dec(cap - take)

    return result


@transaction.atomic
def reverse_advance(advance: EmployeeAdvance, user, reason: str = "") -> EmployeeAdvance:
    """Reverse an advance: refund the outstanding balance to the source account
    and close the ledger. Only advances with no salary deductions yet can be
    reversed (otherwise the deductions would have to be unwound)."""
    locked = EmployeeAdvance.objects.select_for_update().get(pk=advance.pk)
    if locked.status != EmployeeAdvance.Status.ACTIVE:
        raise ValueError("Only active advances can be reversed.")
    if locked.deductions.exists():
        raise ValueError(
            "Cannot reverse an advance that already has salary deductions."
        )

    refund = _dec(locked.outstanding_balance)
    if refund > 0 and locked.source_account_id:
        card = BankCard.objects.select_for_update().get(pk=locked.source_account_id)
        card.balance = _dec(Decimal(str(card.balance or 0)) + refund)
        card.save(update_fields=["balance"])

    account = locked.linked_ledger_account or get_or_create_employee_ledger(
        locked.employee, user
    )
    if refund > 0:
        _post_employee_ledger_entry(
            account=account,
            entry_type=LedgerEntry.EntryType.CREDIT,
            amount=refund,
            date=timezone.localdate(),
            description=f"Reversal of employee advance — {_employee_display_name(locked.employee)}",
            employee=locked.employee,
            expense=locked.linked_expense,
            created_by=user,
        )

    locked.outstanding_balance = Decimal("0.00")
    locked.status = EmployeeAdvance.Status.REVERSED
    locked.reversed_at = timezone.now()
    locked.reversed_by = user
    locked.reversal_reason = reason or ""
    locked.save(
        update_fields=[
            "outstanding_balance",
            "status",
            "reversed_at",
            "reversed_by",
            "reversal_reason",
            "updated_at",
        ]
    )
    return locked


@transaction.atomic
def reverse_advance_deduction(
    deduction: EmployeeAdvanceDeduction,
    user,
    reason: str = "",
    *,
    skip_ledger_if_already_reversed: bool = False,
) -> dict:
    """Reverse a salary advance deduction and restore all affected layers.

    Does not mutate bank/payment method balances — reversing a deduction reopens
    salary/advance obligation but does not create a new cash movement.
    """
    locked = EmployeeAdvanceDeduction.objects.select_for_update().get(pk=deduction.pk)
    if locked.status == EmployeeAdvanceDeduction.Status.REVERSED:
        raise ValueError("This deduction has already been reversed.")

    advance = EmployeeAdvance.objects.select_for_update().get(pk=locked.advance_id)
    expense = None
    if locked.linked_salary_expense_id:
        expense = Expense.objects.select_for_update().get(pk=locked.linked_salary_expense_id)

    amount = _dec(locked.amount)
    if amount <= 0:
        raise ValueError("Invalid deduction amount.")

    reversal_entry = None
    if locked.linked_ledger_entry_id:
        ledger_entry = LedgerEntry.objects.select_for_update().get(
            pk=locked.linked_ledger_entry_id
        )
        if ledger_entry.status == LedgerEntry.Status.REVERSED:
            if not skip_ledger_if_already_reversed:
                raise ValueError(
                    "The linked ledger entry is already reversed. "
                    "Use the repair command to fix operational records."
                )
            reversal_entry = LedgerEntry.objects.filter(reversal_of=ledger_entry).first()
        else:
            _, reversal_entry = reverse_ledger_entry(
                ledger_entry, user, reason=reason or "Advance deduction reversal"
            )
    elif not skip_ledger_if_already_reversed:
        raise ValueError("Deduction has no linked ledger entry to reverse.")

    advance.outstanding_balance = _dec(advance.outstanding_balance) + amount
    if advance.outstanding_balance > _dec(advance.amount):
        advance.outstanding_balance = _dec(advance.amount)
    if (
        advance.status == EmployeeAdvance.Status.SETTLED
        and advance.outstanding_balance > 0
    ):
        advance.status = EmployeeAdvance.Status.ACTIVE
    advance.save(update_fields=["outstanding_balance", "status", "updated_at"])

    if expense:
        new_advance_ded = _dec(expense.salary_advance_deduction) - amount
        if new_advance_ded < 0:
            new_advance_ded = Decimal("0.00")
        expense.salary_advance_deduction = new_advance_ded
        expense.salary_remaining_due = _dec(expense.salary_remaining_due) + amount
        expense.save(
            update_fields=[
                "salary_advance_deduction",
                "salary_remaining_due",
            ]
        )

    locked.status = EmployeeAdvanceDeduction.Status.REVERSED
    locked.reversed_at = timezone.now()
    locked.reversed_by = user
    locked.reversal_reason = reason or ""
    locked.reversal_ledger_entry = reversal_entry
    locked.save(
        update_fields=[
            "status",
            "reversed_at",
            "reversed_by",
            "reversal_reason",
            "reversal_ledger_entry",
        ]
    )

    settlement = None
    if expense and expense.assigned_employee_id and locked.period:
        from accounts.services.pay_salary import salary_settlement_status

        profile = getattr(expense.assigned_employee, "employee_profile", None)
        if profile:
            settlement = salary_settlement_status(
                expense.assigned_employee, profile, locked.period
            )

    return {
        "deduction": locked,
        "advance": advance,
        "reversal_ledger_entry": reversal_entry,
        "salary_settlement": settlement,
    }


@transaction.atomic
def record_advance_repayment(
    *,
    employee_user,
    amount,
    payment_method_id,
    advance_id=None,
    date=None,
    notes: str = "",
    created_by=None,
) -> dict:
    """Record direct cash repayment against outstanding employee advances."""
    amount_total = _dec(amount)
    if amount_total <= 0:
        raise ValueError("Repayment amount must be greater than zero.")
    if not payment_method_id:
        raise ValueError("Payment method is required.")

    total_outstanding = outstanding_for_user(employee_user)
    if total_outstanding <= 0:
        raise ValueError("Employee has no outstanding advance balance.")
    if amount_total > total_outstanding:
        raise ValueError("Repayment amount exceeds total outstanding advance.")

    try:
        card = BankCard.objects.select_for_update().get(pk=payment_method_id)
    except BankCard.DoesNotExist as exc:
        raise ValueError("Invalid payment method.") from exc

    repay_date = date or timezone.localdate()

    if advance_id:
        try:
            target_advances = [
                EmployeeAdvance.objects.select_for_update().get(pk=advance_id)
            ]
        except EmployeeAdvance.DoesNotExist as exc:
            raise ValueError("Advance not found.") from exc
        adv = target_advances[0]
        if adv.employee_id != employee_user.pk:
            raise ValueError("Advance does not belong to this employee.")
        if adv.status != EmployeeAdvance.Status.ACTIVE or _dec(adv.outstanding_balance) <= 0:
            raise ValueError("Selected advance is not active or has no outstanding balance.")
        if amount_total > _dec(adv.outstanding_balance):
            raise ValueError("Repayment amount exceeds this advance's outstanding balance.")
    else:
        target_advances = list(
            EmployeeAdvance.objects.select_for_update()
            .filter(
                employee=employee_user,
                status=EmployeeAdvance.Status.ACTIVE,
                outstanding_balance__gt=0,
            )
            .order_by("date", "created_at")
        )
        if not target_advances:
            raise ValueError("Employee has no active advances to repay.")

    card.balance = _dec(Decimal(str(card.balance or 0)) + amount_total)
    card.save(update_fields=["balance"])

    account = get_or_create_employee_ledger(employee_user, created_by)
    ledger_entry = _post_employee_ledger_entry(
        account=account,
        entry_type=LedgerEntry.EntryType.CREDIT,
        amount=amount_total,
        date=repay_date,
        description=f"Advance repayment — {_employee_display_name(employee_user)}",
        employee=employee_user,
        created_by=created_by,
    )

    repayments: list[EmployeeAdvanceRepayment] = []
    remaining = amount_total
    for adv in target_advances:
        if remaining <= 0:
            break
        take = min(_dec(adv.outstanding_balance), remaining)
        if take <= 0:
            continue
        adv.outstanding_balance = _dec(adv.outstanding_balance) - take
        if adv.outstanding_balance <= 0:
            adv.outstanding_balance = Decimal("0.00")
            adv.status = EmployeeAdvance.Status.SETTLED
        adv.save(update_fields=["outstanding_balance", "status", "updated_at"])

        repayment = EmployeeAdvanceRepayment.objects.create(
            advance=adv,
            employee=employee_user,
            amount=take,
            date=repay_date,
            payment_method=card,
            linked_ledger_entry=ledger_entry,
            created_by=created_by,
            notes=notes or "",
        )
        repayments.append(repayment)
        remaining = _dec(remaining - take)

    return {
        "repayments": repayments,
        "ledger_entry": ledger_entry,
        "total": amount_total,
        "outstanding_remaining": outstanding_for_user(employee_user),
    }
