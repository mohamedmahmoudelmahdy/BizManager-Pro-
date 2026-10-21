"""Operating-expense month attribution for Reports (payroll_period vs date).

Mirrors src/app/lib/reportExpensePeriod.ts — keep in sync.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db.models import Count, Q, Sum

from expenses.models import Expense

MONEY_ZERO = Decimal("0.00")
MONEY_QUANT = Decimal("0.01")


def _dec(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(MONEY_QUANT)


def operating_expense_queryset_for_period(date_from: date, date_to: date):
    """
    Expenses that belong in P&L for [date_from, date_to].

    - Payroll (salary/commission) with payroll_period → by payroll_period
    - All other expenses → by Expense.date
    - Reversed payroll excluded
    """
    reversed_q = Q(payroll_status=Expense.PayrollStatus.REVERSED)
    payroll_types = [Expense.PayrollType.SALARY, Expense.PayrollType.COMMISSION]

    ordinary = (
        Expense.objects.filter(date__gte=date_from, date__lte=date_to)
        .exclude(payroll_type__in=payroll_types)
        .exclude(reversed_q)
    )

    payroll = (
        Expense.objects.filter(
            payroll_type__in=payroll_types,
            payroll_period__gte=date_from,
            payroll_period__lte=date_to,
        )
        .exclude(reversed_q)
        .exclude(payroll_period__isnull=True)
    )

    ids = set(ordinary.values_list("pk", flat=True)) | set(payroll.values_list("pk", flat=True))
    return Expense.objects.filter(pk__in=ids)


def operating_expenses_total(date_from: date, date_to: date) -> Decimal:
    qs = operating_expense_queryset_for_period(date_from, date_to)
    return _dec(qs.aggregate(t=Sum("amount")).get("t"))


def operating_expenses_by_category(date_from: date, date_to: date) -> list[dict]:
    qs = operating_expense_queryset_for_period(date_from, date_to)
    rows = (
        qs.values("category")
        .annotate(total=Sum("amount"), count=Count("id"))
        .order_by("-total")
    )
    return [
        {
            "category": row["category"] or "misc",
            "total": f"{_dec(row['total']):.2f}",
            "count": int(row["count"] or 0),
        }
        for row in rows
    ]
