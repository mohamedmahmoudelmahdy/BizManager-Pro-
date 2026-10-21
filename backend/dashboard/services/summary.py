"""Authoritative dashboard summary for admin/manager.

Composes existing profitability, employee performance, marketing attribution,
and financial-control helpers. Do not duplicate Net Profit / Marketing formulas.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from django.db.models import Count, Max, Sum
from django.utils import timezone

from accounts.services.employee_performance import OPEN_STATUSES, team_performance
from banking.models import BankCard
from customers.models import Customer
from expenses.models import Expense
from financial_control.models import LedgerAccount
from financial_control.services.ledger import unreconciled_count
from marketing.services.revenue_attribution.calculations import (
    money_to_str,
    quantize_money,
    rate_to_str,
    safe_divide,
)
from payments.models import Payment
from payments.services.collections import collection_breakdown
from procedures.models import Procedure
from procedures.services.profitability import net_profit_sum

MONEY_ZERO = Decimal("0")
OVERDUE_DAYS = 7
AGING_BUCKETS = (
    ("current", 0, 0),
    ("1_30", 1, 30),
    ("31_60", 31, 60),
    ("61_90", 61, 90),
    ("90_plus", 91, None),
)
SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def _parse_period(period: str | None, today: date | None = None) -> tuple[date, date, int, int]:
    """Return (start, end_inclusive, year, month). Defaults to current local month."""
    today = today or timezone.localdate()
    if period and len(period) >= 7:
        try:
            year, month = int(period[:4]), int(period[5:7])
            if 1 <= month <= 12:
                start = date(year, month, 1)
                end = date(year, month, monthrange(year, month)[1])
                return start, end, year, month
        except (ValueError, TypeError):
            pass
    start = date(today.year, today.month, 1)
    end = date(today.year, today.month, monthrange(today.year, today.month)[1])
    return start, end, today.year, today.month


def _rate_str(numerator: Decimal, denominator: Decimal) -> str | None:
    ratio = safe_divide(numerator, denominator)
    return rate_to_str(ratio)


def _pct_display(rate_str: str | None) -> str | None:
    """Convert 0.7840 rate string to percentage string like 78.40."""
    if rate_str is None:
        return None
    return format(quantize_money(Decimal(rate_str) * Decimal("100")), "f")


def _aging_bucket(age_days: int) -> str:
    if age_days <= 0:
        return "current"
    if age_days <= 30:
        return "1_30"
    if age_days <= 60:
        return "31_60"
    if age_days <= 90:
        return "61_90"
    return "90_plus"


def _debt_aging(today: date) -> tuple[list[dict[str, Any]], Decimal]:
    """Bucket positive customer balances by days since last payment/procedure/created."""
    debtors = (
        Customer.objects.filter(balance__gt=0)
        .annotate(last_pay=Max("payments__date"), last_proc=Max("procedures__date"))
        .only("id", "name", "company_name", "balance", "created_at")
    )
    totals = {key: MONEY_ZERO for key, _, _ in AGING_BUCKETS}
    overdue_receivables = MONEY_ZERO

    for cust in debtors:
        anchor = cust.last_pay or cust.last_proc
        if anchor is None:
            anchor = cust.created_at.date() if cust.created_at else today
        age_days = (today - anchor).days
        bucket = _aging_bucket(age_days)
        bal = quantize_money(cust.balance)
        totals[bucket] += bal
        if bucket not in ("current", "1_30"):
            overdue_receivables += bal

    rows = [
        {"bucket": key, "amount": money_to_str(totals[key]) or "0.00"}
        for key, _, _ in AGING_BUCKETS
    ]
    return rows, quantize_money(overdue_receivables)


def _top_debtors(limit: int = 5) -> list[dict[str, Any]]:
    qs = Customer.objects.filter(balance__gt=0).order_by("-balance")[:limit]
    return [
        {
            "customer_id": str(c.id),
            "name": c.company_name or c.name,
            "balance": money_to_str(c.balance) or "0.00",
        }
        for c in qs
    ]


def _operations(today: date, date_from: date, date_to: date) -> dict[str, Any]:
    open_qs = Procedure.objects.filter(status__in=OPEN_STATUSES)
    overdue_cutoff = today - timedelta(days=OVERDUE_DAYS + 1)  # older than 7 days
    overdue_qs = open_qs.filter(date__lte=overdue_cutoff)
    open_over_14 = open_qs.filter(date__lte=today - timedelta(days=15)).count()

    status_counts = {
        row["status"]: int(row["c"] or 0)
        for row in Procedure.objects.values("status").annotate(c=Count("id"))
    }
    period_qs = Procedure.objects.filter(date__gte=date_from, date__lte=date_to)
    period_total = period_qs.count()
    period_done = period_qs.filter(status=Procedure.Status.DONE).count()
    period_rejected = period_qs.filter(status=Procedure.Status.REJECTED).count()

    oldest = list(
        open_qs.order_by("date", "created_at")[:5].values(
            "id", "category", "date", "status", "customer_id", "assigned_employee_id"
        )
    )
    for row in oldest:
        row["id"] = str(row["id"])
        row["customer_id"] = str(row["customer_id"]) if row["customer_id"] else None
        row["assigned_employee_id"] = (
            str(row["assigned_employee_id"]) if row["assigned_employee_id"] else None
        )
        row["date"] = row["date"].isoformat() if row["date"] else None

    return {
        "submitted": status_counts.get(Procedure.Status.SUBMITTED, 0),
        "in_process": status_counts.get(Procedure.Status.IN_PROCESS, 0),
        "need_info": status_counts.get(Procedure.Status.NEED_INFO, 0),
        "done": status_counts.get(Procedure.Status.DONE, 0),
        "rejected": status_counts.get(Procedure.Status.REJECTED, 0),
        "active": open_qs.count(),
        "overdue": overdue_qs.count(),
        "open_over_14_days": open_over_14,
        "unassigned": open_qs.filter(assigned_employee__isnull=True).count(),
        "completion_rate": _rate_str(Decimal(period_done), Decimal(period_total)),
        "completion_rate_pct": _pct_display(
            _rate_str(Decimal(period_done), Decimal(period_total))
        ),
        "rejection_rate": _rate_str(Decimal(period_rejected), Decimal(period_total)),
        "period_total": period_total,
        "period_done": period_done,
        "oldest_open": oldest,
    }


def _profit_by_type(date_from: date, date_to: date) -> list[dict[str, Any]]:
    qs = Procedure.objects.filter(
        status=Procedure.Status.DONE, date__gte=date_from, date__lte=date_to
    )
    # Group revenue/cost via Sum; Net Profit via authoritative helper (avoids
    # Sum(Case) annotate quirks on some Django/SQLite combinations).
    rows = (
        qs.values("category")
        .annotate(
            revenue=Sum("selling_price"),
            cost=Sum("cost"),
            procedure_count=Count("id"),
        )
        .order_by("category")
    )
    out = []
    for row in rows:
        category = row["category"] or ""
        revenue = quantize_money(row["revenue"] or MONEY_ZERO)
        cost = quantize_money(row["cost"] or MONEY_ZERO)
        profit = quantize_money(net_profit_sum(qs.filter(category=category)))
        margin = safe_divide(profit, revenue)
        out.append(
            {
                "procedure_type": category,
                "procedure_count": int(row["procedure_count"] or 0),
                "revenue": money_to_str(revenue) or "0.00",
                "cost": money_to_str(cost) or "0.00",
                "net_profit": money_to_str(profit) or "0.00",
                "margin": rate_to_str(margin),
                "margin_pct": _pct_display(rate_to_str(margin)),
            }
        )
    out.sort(key=lambda r: Decimal(r["net_profit"]), reverse=True)
    return out


def _top_customers_by_profit(date_from: date, date_to: date, limit: int = 5) -> list[dict[str, Any]]:
    qs = Procedure.objects.filter(
        status=Procedure.Status.DONE, date__gte=date_from, date__lte=date_to
    )
    rows = (
        qs.values("customer_id", "customer__name", "customer__company_name")
        .annotate(revenue=Sum("selling_price"), procedure_count=Count("id"))
        .order_by("customer_id")
    )
    out = []
    for row in rows:
        cid = row["customer_id"]
        profit = quantize_money(net_profit_sum(qs.filter(customer_id=cid)))
        out.append(
            {
                "customer_id": str(cid),
                "name": row["customer__company_name"] or row["customer__name"] or "",
                "net_profit": money_to_str(profit) or "0.00",
                "revenue": money_to_str(quantize_money(row["revenue"] or MONEY_ZERO))
                or "0.00",
            }
        )
    out.sort(key=lambda r: Decimal(r["net_profit"]), reverse=True)
    return out[:limit]


def _employee_section(period_key: str) -> dict[str, Any]:
    rows = team_performance(period_key)
    if not rows:
        return {
            "top_by_net_profit": None,
            "top_by_collections": None,
            "average_score": None,
            "commission_due_total": "0.00",
            "outstanding_advances_total": "0.00",
            "workload_imbalance": None,
            "employees": [],
        }

    by_profit = max(rows, key=lambda r: Decimal(str(r.get("net_profit") or 0)))
    by_collections = max(rows, key=lambda r: Decimal(str(r.get("payments_collected") or 0)))
    scores = [float(r.get("performance_score") or 0) for r in rows]
    avg_score = round(sum(scores) / len(scores), 2) if scores else None

    commission_due = sum(
        (
            Decimal(str(r.get("commission_amount") or 0))
            for r in rows
            if not r.get("commission_paid")
        ),
        MONEY_ZERO,
    )
    advances = sum(
        (Decimal(str(r.get("outstanding_advances") or 0)) for r in rows),
        MONEY_ZERO,
    )

    by_open = sorted(rows, key=lambda r: int(r.get("open_procedures") or 0), reverse=True)
    imbalance = None
    if len(by_open) >= 2:
        high, low = by_open[0], by_open[-1]
        imbalance = {
            "highest": {
                "name": high.get("full_name") or "",
                "open_procedures": int(high.get("open_procedures") or 0),
                "employee_id": high.get("employee_id"),
            },
            "lowest": {
                "name": low.get("full_name") or "",
                "open_procedures": int(low.get("open_procedures") or 0),
                "employee_id": low.get("employee_id"),
            },
        }

    slim = [
        {
            "employee_id": r.get("employee_id"),
            "full_name": r.get("full_name"),
            "performance_score": r.get("performance_score"),
            "rank": r.get("rank"),
            "open_procedures": r.get("open_procedures"),
            "closed_procedures": r.get("closed_procedures"),
            "net_profit": money_to_str(quantize_money(r.get("net_profit") or 0)) or "0.00",
            "payments_collected": money_to_str(quantize_money(r.get("payments_collected") or 0))
            or "0.00",
            "commission_amount": money_to_str(quantize_money(r.get("commission_amount") or 0))
            or "0.00",
            "commission_paid": bool(r.get("commission_paid")),
            "outstanding_advances": money_to_str(
                quantize_money(r.get("outstanding_advances") or 0)
            )
            or "0.00",
        }
        for r in rows[:10]
    ]

    def _pick(row: dict) -> dict:
        return {
            "employee_id": row.get("employee_id"),
            "full_name": row.get("full_name"),
            "performance_score": row.get("performance_score"),
            "rank": row.get("rank"),
            "net_profit": money_to_str(quantize_money(row.get("net_profit") or 0)) or "0.00",
            "payments_collected": money_to_str(
                quantize_money(row.get("payments_collected") or 0)
            )
            or "0.00",
            "open_procedures": row.get("open_procedures"),
        }

    return {
        "top_by_net_profit": _pick(by_profit),
        "top_by_collections": _pick(by_collections),
        "average_score": avg_score,
        "commission_due_total": money_to_str(quantize_money(commission_due)) or "0.00",
        "outstanding_advances_total": money_to_str(quantize_money(advances)) or "0.00",
        "workload_imbalance": imbalance,
        "employees": slim,
    }


def _marketing_section(actor, date_from: date, date_to: date) -> dict[str, Any] | None:
    try:
        from marketing.services.revenue_attribution.overview import build_overview_revenue
    except Exception:
        return None

    try:
        payload = build_overview_revenue(
            actor,
            {"date_from": date_from.isoformat(), "date_to": date_to.isoformat()},
        )
    except Exception:
        return None

    summary = payload.get("summary") or {}
    leads = int(summary.get("leads") or 0)
    converted = int(summary.get("converted_customers") or 0)
    conv_rate = _rate_str(Decimal(converted), Decimal(leads)) if leads else None
    return {
        "leads": leads,
        "converted_customers": converted,
        "conversion_rate": conv_rate,
        "conversion_rate_pct": _pct_display(conv_rate),
        "collected_revenue": summary.get("collected_revenue"),
        "net_profit": summary.get("net_profit"),
        "campaign_spend": summary.get("campaign_spend"),
        "marketing_contribution": summary.get("marketing_contribution"),
        "roas": summary.get("roas"),
        "marketing_roi": summary.get("marketing_roi"),
    }


def _expenses_section(date_from: date, date_to: date, collected: Decimal) -> dict[str, Any]:
    period_expenses = Expense.objects.filter(date__gte=date_from, date__lte=date_to)
    total = period_expenses.aggregate(t=Sum("amount")).get("t") or MONEY_ZERO
    payroll = (
        period_expenses.exclude(payroll_type="").aggregate(t=Sum("amount")).get("t")
        or MONEY_ZERO
    )
    operating = quantize_money(total - payroll)
    total = quantize_money(total)
    payroll = quantize_money(payroll)
    ratio = safe_divide(total, collected)
    return {
        "total": money_to_str(total) or "0.00",
        "payroll": money_to_str(payroll) or "0.00",
        "operating": money_to_str(operating) or "0.00",
        "expense_ratio": rate_to_str(ratio),
        "expense_ratio_pct": _pct_display(rate_to_str(ratio)),
    }


def _bank_section() -> dict[str, Any]:
    cash = BankCard.objects.aggregate(total=Sum("balance")).get("total") or MONEY_ZERO
    accounts = list(LedgerAccount.objects.filter(status=LedgerAccount.Status.ACTIVE))
    unreconciled_accounts = 0
    unreconciled_entries = 0
    for acc in accounts:
        count = unreconciled_count(acc)
        if count > 0:
            unreconciled_accounts += 1
            unreconciled_entries += count
    return {
        "cash_available": money_to_str(quantize_money(cash)) or "0.00",
        "unreconciled_accounts": unreconciled_accounts,
        "unreconciled_entries": unreconciled_entries,
    }


def _build_alerts(
    *,
    overdue_count: int,
    open_over_14: int,
    top_debtors: list[dict],
    bank: dict,
    employees: dict,
    marketing: dict | None,
    outstanding: Decimal,
) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []

    if overdue_count:
        severity = "critical" if open_over_14 else "high"
        alerts.append(
            {
                "id": "overdue-procedures",
                "severity": severity,
                "title_key": "overdue_procedures",
                "count": overdue_count,
                "detail_count": open_over_14,
                "amount": None,
            }
        )

    if outstanding >= Decimal("10000"):
        alerts.append(
            {
                "id": "large-receivables",
                "severity": "high" if outstanding >= Decimal("50000") else "medium",
                "title_key": "large_unpaid_balances",
                "count": len(top_debtors),
                "detail_count": None,
                "amount": money_to_str(outstanding),
            }
        )

    if bank.get("unreconciled_entries"):
        alerts.append(
            {
                "id": "bank-unreconciled",
                "severity": "high",
                "title_key": "unreconciled_bank",
                "count": bank.get("unreconciled_accounts") or 0,
                "detail_count": bank.get("unreconciled_entries"),
                "amount": None,
            }
        )

    commission_due = Decimal(employees.get("commission_due_total") or "0")
    advances = Decimal(employees.get("outstanding_advances_total") or "0")
    if commission_due > 0:
        alerts.append(
            {
                "id": "commission-due",
                "severity": "medium",
                "title_key": "commission_due",
                "count": None,
                "detail_count": None,
                "amount": money_to_str(commission_due),
            }
        )
    if advances > 0:
        alerts.append(
            {
                "id": "advances-outstanding",
                "severity": "medium",
                "title_key": "advances_outstanding",
                "count": None,
                "detail_count": None,
                "amount": money_to_str(advances),
            }
        )

    imbalance = employees.get("workload_imbalance")
    if imbalance:
        high = imbalance["highest"]["open_procedures"]
        low = imbalance["lowest"]["open_procedures"]
        if high >= 10 and high - low >= 5:
            alerts.append(
                {
                    "id": "workload-imbalance",
                    "severity": "medium",
                    "title_key": "workload_imbalance",
                    "count": high,
                    "detail_count": low,
                    "amount": None,
                    "meta": imbalance,
                }
            )

    if marketing:
        spend = Decimal(marketing.get("campaign_spend") or "0")
        converted = int(marketing.get("converted_customers") or 0)
        if spend > 0 and converted == 0:
            alerts.append(
                {
                    "id": "marketing-no-conversion",
                    "severity": "high",
                    "title_key": "campaigns_without_conversions",
                    "count": None,
                    "detail_count": None,
                    "amount": money_to_str(spend),
                }
            )

    alerts.sort(key=lambda a: SEVERITY_ORDER.get(a.get("severity") or "low", 9))
    return alerts


def build_dashboard_summary(actor, period: str | None = None) -> dict[str, Any]:
    """Build the full admin/manager dashboard summary payload."""
    today = timezone.localdate()
    date_from, date_to, year, month = _parse_period(period, today)
    period_key = f"{year:04d}-{month:02d}"

    # Net collected = gross payments − customer refunds (shared helper).
    _breakdown = collection_breakdown(date_from=date_from, date_to=date_to)
    collected = quantize_money(_breakdown["net_collected"])
    gross_collected = quantize_money(_breakdown["gross_collected"])
    refunds_total = quantize_money(_breakdown["refunds"])

    done_qs = Procedure.objects.filter(
        status=Procedure.Status.DONE, date__gte=date_from, date__lte=date_to
    )
    net_profit = quantize_money(net_profit_sum(done_qs))

    outstanding = Customer.objects.filter(balance__gt=0).aggregate(t=Sum("balance")).get(
        "t"
    ) or MONEY_ZERO
    outstanding = quantize_money(outstanding)

    debt_aging, overdue_receivables = _debt_aging(today)
    amount_due = quantize_money(collected + outstanding)
    collection_rate = safe_divide(collected, amount_due)

    operations = _operations(today, date_from, date_to)
    profit_by_type = _profit_by_type(date_from, date_to)
    top_customers = _top_customers_by_profit(date_from, date_to)
    employees = _employee_section(period_key)
    marketing = _marketing_section(actor, date_from, date_to)
    expenses = _expenses_section(date_from, date_to, collected)
    bank = _bank_section()
    top_debtors = _top_debtors()

    marketing_contribution = marketing.get("marketing_contribution") if marketing else None
    marketing_roas = marketing.get("roas") if marketing else None

    executive = {
        "collected_revenue": money_to_str(collected) or "0.00",
        "gross_collected_revenue": money_to_str(gross_collected) or "0.00",
        "refunds": money_to_str(refunds_total) or "0.00",
        "net_profit": money_to_str(net_profit) or "0.00",
        "outstanding_receivables": money_to_str(outstanding) or "0.00",
        "marketing_contribution": marketing_contribution,
        "cash_available": bank["cash_available"],
        "customers_with_debt": Customer.objects.filter(balance__gt=0).count(),
    }

    collection = {
        "collected": money_to_str(collected) or "0.00",
        "gross_collected": money_to_str(gross_collected) or "0.00",
        "refunds": money_to_str(refunds_total) or "0.00",
        "amount_due": money_to_str(amount_due) or "0.00",
        "rate": rate_to_str(collection_rate),
        "rate_pct": _pct_display(rate_to_str(collection_rate)),
        "overdue_receivables": money_to_str(overdue_receivables) or "0.00",
        "top_debtors": top_debtors,
    }

    alerts = _build_alerts(
        overdue_count=operations["overdue"],
        open_over_14=operations["open_over_14_days"],
        top_debtors=top_debtors,
        bank=bank,
        employees=employees,
        marketing=marketing,
        outstanding=outstanding,
    )

    return {
        "period": {
            "year": year,
            "month": month,
            "key": period_key,
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
        },
        "executive": executive,
        "collection": collection,
        "debt_aging": debt_aging,
        "operations": operations,
        "profit_by_type": profit_by_type,
        "top_customers_by_profit": top_customers,
        "employees": employees,
        "marketing": marketing,
        "expenses": expenses,
        "bank": bank,
        "alerts": alerts,
        "meta": {
            "currency": "AED",
            "overdue_days": OVERDUE_DAYS,
            "marketing_roas": marketing_roas,
        },
    }
