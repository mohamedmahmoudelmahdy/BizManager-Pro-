"""Flexible salary payment — full/partial pay, manual deductions, advance recovery."""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from banking.models import BankCard
from expenses.models import Expense

from accounts.services import employee_performance as perf
from financial_control.services import employee_advances as advances_svc


def _dec(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def _money_str(value) -> str:
    return f"{_dec(value):.2f}"


def salary_period_totals(user, period_key: str) -> dict:
    """Aggregate salary payroll amounts already posted for a period."""
    start, _, key = perf._parse_period(period_key)
    if not key or not start:
        return {
            "cash_paid": Decimal("0"),
            "advance_deduction": Decimal("0"),
            "manual_deduction": Decimal("0"),
            "payment_count": 0,
        }
    qs = Expense.objects.filter(
        assigned_employee=user,
        payroll_type=Expense.PayrollType.SALARY,
        payroll_period=start,
        payroll_status=Expense.PayrollStatus.ACTIVE,
    )
    agg = qs.aggregate(
        cash=Sum("amount"),
        advance=Sum("salary_advance_deduction"),
        manual=Sum("salary_manual_deduction"),
    )
    return {
        "cash_paid": _dec(agg.get("cash")),
        "advance_deduction": _dec(agg.get("advance")),
        "manual_deduction": _dec(agg.get("manual")),
        "payment_count": qs.count(),
    }


def salary_settlement_status(user, profile, period_key: str) -> dict:
    """Derive pending / partial / paid status for a payroll period."""
    gross = _dec(profile.salary)
    totals = salary_period_totals(user, period_key)
    remaining = _dec(gross - totals["cash_paid"] - totals["advance_deduction"] - totals["manual_deduction"])
    if remaining <= 0 and (totals["cash_paid"] > 0 or totals["advance_deduction"] > 0):
        status = "paid"
    elif totals["cash_paid"] > 0 or totals["advance_deduction"] > 0 or totals["manual_deduction"] > 0:
        status = "partial"
    else:
        status = "pending"
    return {
        "salary_status": status,
        "salary_remaining_due": float(max(Decimal("0"), remaining)),
        "salary_paid_total": float(totals["cash_paid"]),
        "salary_paid": status == "paid",
    }


def compute_salary_payment(
    *,
    profile,
    period_key: str,
    payment_mode: str,
    manual_deduction_amount=0,
    paid_amount_input=None,
) -> dict:
    """Validate and compute amounts for a salary payment (no side effects)."""
    gross = _dec(profile.salary)
    if gross <= 0:
        raise ValueError("Salary must be greater than zero.")

    manual = _dec(manual_deduction_amount)
    if manual < 0:
        raise ValueError("Manual deduction cannot be negative.")

    totals = salary_period_totals(profile.user, period_key)
    remaining_obligation = _dec(
        gross - totals["cash_paid"] - totals["advance_deduction"] - totals["manual_deduction"]
    )

    if remaining_obligation <= 0:
        raise ValueError("Salary for this period is already fully settled.")

    if manual > remaining_obligation:
        raise ValueError("Manual deduction exceeds remaining salary obligation for this period.")

    after_manual = _dec(remaining_obligation - manual)
    outstanding = advances_svc.outstanding_for_user(profile.user)
    mode = (payment_mode or Expense.SalaryPaymentMode.FULL).lower()

    if mode == Expense.SalaryPaymentMode.FULL:
        advance_deduction = min(outstanding, after_manual)
        paid_amount = _dec(after_manual - advance_deduction)
    elif mode == Expense.SalaryPaymentMode.PARTIAL:
        paid_amount = _dec(paid_amount_input)
        if paid_amount <= 0:
            raise ValueError("Partial payment amount must be greater than zero.")
        if paid_amount > after_manual:
            raise ValueError("Partial payment exceeds payable salary for this period.")
        advance_deduction = min(outstanding, paid_amount)
    else:
        raise ValueError("payment_mode must be 'full' or 'partial'.")

    if paid_amount <= 0 and advance_deduction <= 0:
        raise ValueError("Payable salary is zero after deductions.")

    remaining_after = _dec(remaining_obligation - manual - paid_amount - advance_deduction)

    return {
        "gross_salary": gross,
        "manual_deduction": manual,
        "advance_deduction": advance_deduction,
        "paid_amount": paid_amount,
        "remaining_salary_due": max(Decimal("0"), remaining_after),
        "payment_mode": mode,
        "remaining_obligation_before": remaining_obligation,
        "prior_totals": totals,
    }


def _build_salary_notes(
    *,
    period_key: str,
    gross: Decimal,
    advance_deduction: Decimal,
    manual_deduction: Decimal,
    manual_reason: str,
    paid_amount: Decimal,
    remaining_due: Decimal,
    payment_mode: str,
    user_notes: str,
) -> str:
    marker = f"[payroll:{Expense.PayrollType.SALARY}:{period_key}]"
    parts = [
        f"Gross salary: {gross}",
        f"Advance deduction: {advance_deduction}",
    ]
    if manual_deduction > 0:
        reason = f" ({manual_reason})" if manual_reason else ""
        parts.append(f"Manual deduction: {manual_deduction}{reason}")
    parts.extend(
        [
            f"Paid amount: {paid_amount}",
            f"Remaining salary due: {remaining_due}",
            f"Payment mode: {payment_mode}",
        ]
    )
    body = " | ".join(parts)
    if user_notes:
        body = f"{body} | Notes: {user_notes}"
    return f"{marker} {body}".strip()


@transaction.atomic
def execute_salary_payment(
    *,
    profile,
    period_key: str,
    paid_by_id,
    pay_date=None,
    notes: str = "",
    payment_mode: str = "full",
    manual_deduction_amount=0,
    manual_deduction_reason: str = "",
    paid_amount_input=None,
    created_by=None,
) -> tuple[Expense, dict]:
    """Create salary expense, debit bank, apply advance deductions."""
    start, _, key = perf._parse_period(period_key)
    if not key or not start:
        raise ValueError("Invalid period. Use YYYY-MM.")
    if not paid_by_id:
        raise ValueError("Payment method is required.")

    calc = compute_salary_payment(
        profile=profile,
        period_key=period_key,
        payment_mode=payment_mode,
        manual_deduction_amount=manual_deduction_amount,
        paid_amount_input=paid_amount_input,
    )

    paid_amount = calc["paid_amount"]
    advance_deduction = calc["advance_deduction"]

    try:
        paid_by = BankCard.objects.get(pk=paid_by_id)
    except BankCard.DoesNotExist as exc:
        raise ValueError("Invalid payment method.") from exc

    pay_date = pay_date or timezone.localdate()
    full_notes = _build_salary_notes(
        period_key=key,
        gross=calc["gross_salary"],
        advance_deduction=advance_deduction,
        manual_deduction=calc["manual_deduction"],
        manual_reason=manual_deduction_reason,
        paid_amount=paid_amount,
        remaining_due=calc["remaining_salary_due"],
        payment_mode=calc["payment_mode"],
        user_notes=notes,
    )

    if paid_amount > 0:
        locked = BankCard.objects.select_for_update().get(pk=paid_by.pk)
        if locked.balance - paid_amount < 0:
            raise ValueError("Insufficient balance for this expense.")
        locked.balance = locked.balance - paid_amount
        locked.save(update_fields=["balance"])

    expense = Expense.objects.create(
        category=Expense.Category.SALARIES,
        date=pay_date,
        amount=paid_amount,
        paid_by=paid_by,
        assigned_employee=profile.user,
        payroll_type=Expense.PayrollType.SALARY,
        payroll_period=start,
        salary_gross=calc["gross_salary"],
        salary_advance_deduction=advance_deduction,
        salary_manual_deduction=calc["manual_deduction"],
        salary_remaining_due=calc["remaining_salary_due"],
        salary_payment_mode=calc["payment_mode"],
        salary_manual_deduction_reason=manual_deduction_reason or "",
        notes=full_notes,
    )

    ded_result = advances_svc.apply_salary_deductions(
        employee_user=profile.user,
        max_deduction=advance_deduction,
        period_key=key,
        salary_expense=expense,
        created_by=created_by,
        date=pay_date,
    )

    result = {
        **calc,
        "advance_deducted_applied": ded_result["deducted"],
        "gross_salary": _money_str(calc["gross_salary"]),
        "manual_deduction": _money_str(calc["manual_deduction"]),
        "advance_deduction": _money_str(advance_deduction),
        "paid_amount": _money_str(paid_amount),
        "net_salary": _money_str(paid_amount),
        "remaining_salary_due": _money_str(calc["remaining_salary_due"]),
    }
    return expense, result


@transaction.atomic
def reverse_salary_payment(
    expense: Expense,
    profile,
    user,
    reason: str = "",
) -> tuple[Expense, dict]:
    """Reverse a posted salary payment and restore all affected layers."""
    locked = Expense.objects.select_for_update().get(pk=expense.pk)

    if locked.payroll_status == Expense.PayrollStatus.REVERSED:
        raise ValueError("This salary payment has already been reversed.")
    if locked.payroll_type != Expense.PayrollType.SALARY:
        raise ValueError("This expense is not a salary payroll payment.")
    if locked.assigned_employee_id != profile.user_id:
        raise ValueError("Salary payment does not belong to this employee.")

    from financial_control.models import EmployeeAdvanceDeduction
    from financial_control.services import employee_advances as advances_svc

    cash_amount = _dec(locked.amount)
    if cash_amount > 0 and locked.paid_by_id:
        card = BankCard.objects.select_for_update().get(pk=locked.paid_by_id)
        card.balance = _dec(Decimal(str(card.balance or 0)) + cash_amount)
        card.save(update_fields=["balance"])

    deductions = (
        EmployeeAdvanceDeduction.objects.select_for_update()
        .filter(
            linked_salary_expense=locked,
            status=EmployeeAdvanceDeduction.Status.ACTIVE,
        )
        .order_by("date", "created_at")
    )
    for deduction in deductions:
        advances_svc.reverse_advance_deduction(
            deduction,
            user,
            reason=f"Salary payment reversal: {reason}",
        )

    audit_note = f"[REVERSED {timezone.now().isoformat()}] {reason}".strip()
    locked.notes = f"{locked.notes}\n{audit_note}".strip() if locked.notes else audit_note
    locked.payroll_status = Expense.PayrollStatus.REVERSED
    locked.reversed_at = timezone.now()
    locked.reversed_by = user
    locked.reversal_reason = reason or ""
    locked.save(
        update_fields=[
            "notes",
            "payroll_status",
            "reversed_at",
            "reversed_by",
            "reversal_reason",
            "updated_at",
        ]
    )

    period_key = ""
    if locked.payroll_period:
        period_key = locked.payroll_period.strftime("%Y-%m")
    settlement = salary_settlement_status(profile.user, profile, period_key) if period_key else {}

    return locked, settlement
