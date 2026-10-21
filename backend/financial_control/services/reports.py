"""Read-only financial reports — aggregates live operational data."""
from __future__ import annotations

from calendar import monthrange
from datetime import date
from decimal import Decimal

from django.db.models import Count, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone

from banking.models import BankCard
from deposits.models import Deposit
from expenses.models import Expense
from financial_control.models import CheckPDC, DebtLiability, LedgerAccount, LedgerEntry
from financial_control.services.ledger import unreconciled_count


def _parse_period_bounds(period_start: str | None, period_end: str | None) -> tuple[date, date]:
    today = timezone.localdate()
    if period_start:
        try:
            start = date.fromisoformat(period_start[:10])
        except ValueError:
            start = today.replace(day=1)
    else:
        start = today.replace(day=1)
    if period_end:
        try:
            end = date.fromisoformat(period_end[:10])
        except ValueError:
            end = today
    else:
        end = today.replace(day=monthrange(today.year, today.month)[1])
    if end < start:
        start, end = end, start
    return start, end


def build_reports_payload(period_start: str | None = None, period_end: str | None = None) -> dict:
    start, end = _parse_period_bounds(period_start, period_end)

    total_cash = BankCard.objects.aggregate(t=Sum("balance")).get("t") or Decimal("0")

    period_expenses = Expense.objects.filter(date__gte=start, date__lte=end)
    expenses_total = period_expenses.aggregate(t=Sum("amount")).get("t") or Decimal("0")

    payroll_qs = period_expenses.exclude(payroll_type="")
    payroll_total = payroll_qs.aggregate(t=Sum("amount")).get("t") or Decimal("0")

    by_category = (
        period_expenses.values("category")
        .annotate(total=Sum("amount"), count=Count("id"))
        .order_by("-total")
    )

    transfer_qs = Deposit.objects.filter(date__gte=start, date__lte=end)
    transfer_volume = transfer_qs.aggregate(t=Sum("amount")).get("t") or Decimal("0")
    transfer_count = transfer_qs.count()

    pending_checks = CheckPDC.objects.filter(
        status__in=[CheckPDC.Status.PENDING, CheckPDC.Status.DUE_SOON]
    )
    checks_pending_amount = pending_checks.aggregate(t=Sum("amount")).get("t") or Decimal("0")

    open_debts = DebtLiability.objects.filter(status=DebtLiability.Status.ACTIVE)
    debts_remaining = open_debts.aggregate(t=Sum("remaining_balance")).get("t") or Decimal("0")

    ledger_active = LedgerAccount.objects.filter(status=LedgerAccount.Status.ACTIVE)
    ledger_balance = ledger_active.aggregate(t=Sum("current_balance")).get("t") or Decimal("0")
    unreconciled_total = 0
    for acc in ledger_active:
        unreconciled_total += unreconciled_count(acc)

    bank_cards = [
        {"id": str(c.id), "name": c.bank_name, "balance": float(c.balance or 0)}
        for c in BankCard.objects.order_by("-balance")
    ]

    expense_trend = []
    trend_qs = (
        Expense.objects.filter(date__gte=start, date__lte=end)
        .annotate(month=TruncMonth("date"))
        .values("month")
        .annotate(total=Sum("amount"))
        .order_by("month")
    )
    for row in trend_qs:
        if row["month"]:
            expense_trend.append(
                {
                    "key": row["month"].strftime("%Y-%m"),
                    "label": row["month"].strftime("%b %Y"),
                    "total": float(row["total"] or 0),
                }
            )

    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "summary": {
            "total_cash_bank": float(total_cash),
            "period_expenses_total": float(expenses_total),
            "payroll_expenses_total": float(payroll_total),
            "payroll_expenses_count": payroll_qs.count(),
            "transfer_volume": float(transfer_volume),
            "transfer_count": transfer_count,
            "pending_checks_total": float(checks_pending_amount),
            "pending_checks_count": pending_checks.count(),
            "open_debts_total": float(debts_remaining),
            "open_debts_count": open_debts.count(),
            "ledger_balance_total": float(ledger_balance),
            "ledger_unreconciled_entries": unreconciled_total,
            "net_position": float(total_cash)
            - float(debts_remaining)
            - float(checks_pending_amount),
        },
        "expenses_by_category": [
            {
                "category": row["category"],
                "total": float(row["total"] or 0),
                "count": row["count"],
            }
            for row in by_category
        ],
        "expense_trend": expense_trend,
        "checks_by_status": _checks_by_status(),
        "debts_top": [
            {
                "id": str(d.id),
                "name": d.name,
                "creditor": d.creditor,
                "remaining_balance": float(d.remaining_balance),
                "next_payment_date": d.next_payment_date.isoformat() if d.next_payment_date else "",
            }
            for d in open_debts.order_by("-remaining_balance")[:10]
        ],
        "bank_cards": bank_cards,
    }


def _checks_by_status() -> list[dict]:
    rows = (
        CheckPDC.objects.values("status")
        .annotate(count=Count("id"), total=Sum("amount"))
        .order_by("status")
    )
    return [
        {
            "status": row["status"],
            "count": row["count"],
            "total": float(row["total"] or 0),
        }
        for row in rows
    ]
