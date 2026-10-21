"""Read-only aggregation for Financial Control overview and alerts."""
from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Count, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone

from banking.models import BankCard
from expenses.models import Expense
from financial_control.models import (
    CheckPDC,
    DebtLiability,
    EmployeeAdvance,
    LedgerAccount,
    LedgerEntry,
)
from financial_control.services.ledger import unreconciled_count


def _safe_float(value) -> float:
    """Serialize Decimal/None/invalid numeric values without crashing."""
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _month_bounds(reference: date | None = None) -> tuple[date, date]:
    today = reference or timezone.localdate()
    start = today.replace(day=1)
    end = today.replace(day=monthrange(today.year, today.month)[1])
    return start, end


def _cashflow_series(months: int = 6) -> list[dict]:
    today = timezone.localdate()
    start = (today.replace(day=1) - timedelta(days=months * 31)).replace(day=1)
    qs = (
        Expense.objects.filter(date__gte=start)
        .annotate(month=TruncMonth("date"))
        .values("month")
        .annotate(expenses=Sum("amount"))
        .order_by("month")
    )
    by_month = {row["month"].strftime("%Y-%m"): float(row["expenses"] or 0) for row in qs if row["month"]}
    series = []
    for i in range(months - 1, -1, -1):
        d = today.replace(day=1)
        year, month = d.year, d.month - i
        while month <= 0:
            month += 12
            year -= 1
        key = f"{year:04d}-{month:02d}"
        label = date(year, month, 1).strftime("%b")
        series.append({"month": label, "key": key, "expenses": by_month.get(key, 0), "income": 0})
    return series


def build_overview_payload() -> dict:
    month_start, month_end = _month_bounds()

    total_cash_bank = BankCard.objects.aggregate(total=Sum("balance")).get("total") or Decimal("0")

    pending_checks = CheckPDC.objects.filter(
        status__in=[CheckPDC.Status.PENDING, CheckPDC.Status.DUE_SOON]
    )
    pending_checks_total = pending_checks.aggregate(total=Sum("amount")).get("total") or Decimal("0")
    pending_checks_count = pending_checks.count()

    month_expenses = (
        Expense.objects.filter(date__gte=month_start, date__lte=month_end)
        .aggregate(total=Sum("amount"))
        .get("total")
        or Decimal("0")
    )

    open_debts = DebtLiability.objects.filter(status=DebtLiability.Status.ACTIVE)
    open_debts_total = open_debts.aggregate(total=Sum("remaining_balance")).get("total") or Decimal("0")
    open_debts_count = open_debts.count()

    active_advances = EmployeeAdvance.objects.filter(status=EmployeeAdvance.Status.ACTIVE)
    employee_advances_total = (
        active_advances.aggregate(total=Sum("outstanding_balance")).get("total") or Decimal("0")
    )
    employee_advances_count = active_advances.count()

    ledger_accounts = []
    for acc in LedgerAccount.objects.filter(status=LedgerAccount.Status.ACTIVE).order_by("name")[:12]:
        ledger_accounts.append(
            {
                "id": str(acc.id),
                "name": acc.name,
                "account_type": acc.account_type,
                "current_balance": _safe_float(acc.current_balance),
                "status": acc.status,
                "unreconciled_count": unreconciled_count(acc),
            }
        )

    alerts_count = len(build_alerts_payload())

    return {
        "total_cash_bank": _safe_float(total_cash_bank),
        "pending_checks_total": _safe_float(pending_checks_total),
        "pending_checks_count": pending_checks_count,
        "month_expenses_total": _safe_float(month_expenses),
        "month_start": month_start.isoformat(),
        "month_end": month_end.isoformat(),
        "open_debts_total": _safe_float(open_debts_total),
        "open_debts_count": open_debts_count,
        "employee_advances_total": _safe_float(employee_advances_total),
        "employee_advances_count": employee_advances_count,
        "pending_settlements_count": 0,
        "net_business_position": _safe_float(total_cash_bank)
        - _safe_float(open_debts_total)
        - _safe_float(pending_checks_total),
        "alerts_count": alerts_count,
        "ledger_accounts": ledger_accounts,
        "cashflow": _cashflow_series(),
        "risk_items": _risk_items(),
    }


def _risk_items() -> list[dict]:
    items: list[dict] = []
    for card in BankCard.objects.filter(balance__lt=Decimal("5000"))[:5]:
        items.append(
            {
                "severity": "medium",
                "title_key": "low_balance",
                "entity": card.bank_name,
                "description": f"Balance AED {card.balance}",
            }
        )
    posted_open = LedgerEntry.objects.filter(status=LedgerEntry.Status.POSTED).count()
    if posted_open:
        items.append(
            {
                "severity": "low",
                "title_key": "unreconciled_entries",
                "entity": "Ledger",
                "description": f"{posted_open} posted entries awaiting reconciliation",
            }
        )
    return items[:6]


def build_alerts_payload() -> list[dict]:
    today = timezone.localdate()
    alerts: list[dict] = []

    for check in CheckPDC.objects.filter(
        status__in=[CheckPDC.Status.PENDING, CheckPDC.Status.DUE_SOON]
    ).order_by("due_date")[:30]:
        if check.due_date is None:
            continue
        days = (check.due_date - today).days
        severity = "High" if days <= 3 else "Medium" if days <= 14 else "Low"
        alerts.append(
            {
                "id": str(check.id),
                "type": "check_due",
                "entity": check.payee,
                "due_date": check.due_date.isoformat(),
                "amount": _safe_float(check.amount),
                "severity": severity,
                "status": check.status,
                "suggested_action": "Review bank balance before due date.",
            }
        )

    for debt in DebtLiability.objects.filter(status=DebtLiability.Status.ACTIVE).order_by(
        "next_payment_date"
    )[:20]:
        if debt.next_payment_date and debt.next_payment_date < today:
            alerts.append(
                {
                    "id": str(debt.id),
                    "type": "overdue_debt",
                    "entity": debt.name,
                    "due_date": debt.next_payment_date.isoformat(),
                    "amount": _safe_float(debt.remaining_balance),
                    "severity": "High",
                    "status": debt.status,
                    "suggested_action": "Schedule debt payment.",
                }
            )

    low_cards = BankCard.objects.filter(balance__lt=Decimal("10000")).order_by("balance")[:5]
    for card in low_cards:
        alerts.append(
            {
                "id": str(card.id),
                "type": "low_balance",
                "entity": card.bank_name,
                "due_date": "",
                "amount": _safe_float(card.balance),
                "severity": "Medium",
                "status": "active",
                "suggested_action": "Transfer funds or review upcoming obligations.",
            }
        )

    unreconciled_accounts = 0
    for acc in LedgerAccount.objects.filter(status=LedgerAccount.Status.ACTIVE):
        if unreconciled_count(acc) > 0:
            unreconciled_accounts += 1
    if unreconciled_accounts:
        alerts.append(
            {
                "id": "ledger-unreconciled",
                "type": "reconciliation",
                "entity": "Ledger Accounts",
                "due_date": "",
                "amount": unreconciled_accounts,
                "severity": "Low",
                "status": "open",
                "suggested_action": "Reconcile posted ledger entries.",
            }
        )

    return alerts
