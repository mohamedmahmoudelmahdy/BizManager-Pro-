"""Centralized employee performance, commission, and payroll helpers."""
from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Q, Sum
from django.utils import timezone

from accounts.services.performance_period import (
    MODE_MONTH,
    PerformancePeriod,
    iter_month_keys,
    resolve_performance_period,
)
from expenses.models import Expense
from payments.models import Payment
from procedures.models import Procedure
from procedures.services.profitability import net_profit_sum

OPEN_STATUSES = [
    Procedure.Status.SUBMITTED,
    Procedure.Status.IN_PROCESS,
    Procedure.Status.NEED_INFO,
]

# Authoritative ceiling used by team_performance scoring (do not duplicate elsewhere).
PERFORMANCE_SCORE_MAXIMUM = 100


def current_period_key(today: date | None = None) -> str:
    """YYYY-MM for the given (or local) date — matches Employee Log default period."""
    d = today or timezone.localdate()
    return f"{d.year:04d}-{d.month:02d}"


def _parse_period(period: str | None) -> tuple[date | None, date | None, str | None]:
    """Legacy period format YYYY-MM -> (start, end_inclusive, period_key)."""
    if not period or len(period) < 7:
        return None, None, None
    try:
        year, month = int(period[:4]), int(period[5:7])
        start = date(year, month, 1)
        end = date(year, month, monthrange(year, month)[1])
        return start, end, f"{year:04d}-{month:02d}"
    except (ValueError, TypeError):
        return None, None, None


def _bounds_from_period_arg(
    period: str | PerformancePeriod | None,
) -> tuple[date | None, date | None, str | None, PerformancePeriod | None]:
    """
    Normalize legacy YYYY-MM string or PerformancePeriod into filter bounds.

    Returns (start_inclusive, end_inclusive, period_key, resolved_period_or_none).
    When both start and end are None → lifetime / unfiltered.
    """
    if isinstance(period, PerformancePeriod):
        start = period.start
        end_incl = period.end_inclusive
        if start is not None and start >= period.end_exclusive:
            return start, start - timedelta(days=1), period.period_key, period
        return start, end_incl, period.period_key, period

    if period is None:
        return None, None, None, None

    # Legacy YYYY-MM (and all/lifetime) → same resolver as period_mode (excludes future).
    try:
        resolved = resolve_performance_period(period=period)
    except Exception:
        start, end, key = _parse_period(period)
        return start, end, key, None
    return resolved.start, resolved.end_inclusive, resolved.period_key, resolved


def procedures_for_user(user, start: date | None = None, end: date | None = None):
    qs = Procedure.objects.filter(assigned_employee=user)
    if start is not None and end is not None:
        if end < start:
            return qs.none()
        qs = qs.filter(date__gte=start, date__lte=end)
    elif start is not None:
        qs = qs.filter(date__gte=start)
    elif end is not None:
        qs = qs.filter(date__lte=end)
    return qs


def payments_for_user(user, start: date | None = None, end: date | None = None):
    """Payments recorded by user OR linked to their assigned procedures."""
    procedure_ids = Procedure.objects.filter(assigned_employee=user).values_list("id", flat=True)
    qs = Payment.objects.filter(Q(recorded_by=user) | Q(procedure_id__in=procedure_ids))
    if start is not None and end is not None:
        if end < start:
            return qs.none()
        qs = qs.filter(date__gte=start, date__lte=end)
    elif start is not None:
        qs = qs.filter(date__gte=start)
    elif end is not None:
        qs = qs.filter(date__lte=end)
    return qs.distinct()


def commission_amount(net_profit: Decimal, rate: Decimal) -> Decimal:
    return (net_profit * Decimal(str(rate or 0)) / Decimal("100")).quantize(Decimal("0.01"))


def payroll_exists(user, payroll_type: str, period_key: str) -> bool:
    start, _, key = _parse_period(period_key)
    if not key:
        return False
    marker = f"[payroll:{payroll_type}:{key}]"
    if Expense.objects.filter(
        assigned_employee=user,
        payroll_type=payroll_type,
        payroll_period=start,
        payroll_status=Expense.PayrollStatus.ACTIVE,
    ).exists():
        return True
    return Expense.objects.filter(
        assigned_employee=user,
        notes__icontains=marker,
        payroll_status=Expense.PayrollStatus.ACTIVE,
    ).exists()


def _salary_settlement(user, profile, period_key: str) -> dict:
    from accounts.services.pay_salary import salary_settlement_status

    return salary_settlement_status(user, profile, period_key)


def _salary_settlement_for_range(
    user, profile, start: date | None, end_inclusive: date
) -> dict:
    """
    Aggregate unpaid salary obligations across payroll months intersecting the range.

    Documented semantics for year / all_time:
    total unpaid salary remaining_due across months from start through end_inclusive.
    """
    from accounts.services.pay_salary import salary_settlement_status

    if start is None:
        start = date(end_inclusive.year, 1, 1)
        # Cap lookback to avoid unbounded loops — earliest activity or 5 years.
        earliest = date(end_inclusive.year - 5, 1, 1)
        start = max(start, earliest) if start else earliest

    keys = iter_month_keys(start, end_inclusive)
    remaining_total = Decimal("0")
    paid_total = Decimal("0")
    statuses: list[str] = []
    for key in keys:
        st = salary_settlement_status(user, profile, key)
        remaining_total += Decimal(str(st["salary_remaining_due"] or 0))
        paid_total += Decimal(str(st["salary_paid_total"] or 0))
        statuses.append(st["salary_status"])

    if not statuses:
        return {
            "salary_status": "pending",
            "salary_remaining_due": float(profile.salary or 0),
            "salary_paid_total": 0.0,
            "salary_paid": False,
        }
    if all(s == "paid" for s in statuses):
        status = "paid"
    elif any(s in ("paid", "partial") for s in statuses):
        status = "partial"
    else:
        status = "pending"
    return {
        "salary_status": status,
        "salary_remaining_due": float(remaining_total),
        "salary_paid_total": float(paid_total),
        "salary_paid": status == "paid",
    }


def _commission_paid_for_range(user, start: date | None, end_inclusive: date) -> bool:
    if start is None:
        start = date(end_inclusive.year - 5, 1, 1)
    keys = iter_month_keys(start, end_inclusive)
    return any(payroll_exists(user, "commission", key) for key in keys)


def _outstanding_advances(user) -> Decimal:
    """Sum of remaining balances on the employee's active advances (lazy import
    to avoid a hard dependency cycle with financial_control)."""
    from financial_control.models import EmployeeAdvance

    total = (
        EmployeeAdvance.objects.filter(employee=user, status=EmployeeAdvance.Status.ACTIVE)
        .aggregate(t=Sum("outstanding_balance"))
        .get("t")
    )
    return total or Decimal("0")


def employee_metrics(user, profile, period: str | PerformancePeriod | None = None) -> dict:
    start, end, period_key, resolved = _bounds_from_period_arg(period)
    proc_qs = procedures_for_user(user, start, end)
    pay_qs = payments_for_user(user, start, end)

    total = proc_qs.count()
    open_count = proc_qs.filter(status__in=OPEN_STATUSES).count()
    in_progress = proc_qs.filter(status=Procedure.Status.IN_PROCESS).count()
    closed = proc_qs.filter(status=Procedure.Status.DONE).count()
    rejected = proc_qs.filter(status=Procedure.Status.REJECTED).count()

    revenue = proc_qs.aggregate(t=Sum("selling_price")).get("t") or Decimal("0")
    collected_on_procedures = proc_qs.aggregate(t=Sum("paid")).get("t") or Decimal("0")
    payments_gross = pay_qs.aggregate(t=Sum("amount")).get("t") or Decimal("0")
    from payments.services.collections import refunds_collected_sum

    payment_ids = list(pay_qs.values_list("id", flat=True))
    refunds_for_payments = refunds_collected_sum(
        payment_ids=payment_ids,
        date_from=start,
        date_to=end,
    )
    payments_collected = (Decimal(str(payments_gross)) - refunds_for_payments).quantize(
        Decimal("0.01")
    )
    net_profit = net_profit_sum(proc_qs.filter(status=Procedure.Status.DONE))

    rate = Decimal(str(profile.commission_rate or 0))
    comm = commission_amount(net_profit, rate)

    closure_ratio = float(closed / total) if total else 0.0

    outstanding_advances = _outstanding_advances(user)

    if resolved is not None and resolved.mode != MODE_MONTH:
        settlement = _salary_settlement_for_range(
            user, profile, start or date(2000, 1, 1), end or timezone.localdate()
        )
        commission_paid = _commission_paid_for_range(
            user, start or date(2000, 1, 1), end or timezone.localdate()
        )
        period_out = resolved.period_key or resolved.mode
    else:
        settlement = _salary_settlement(user, profile, period_key or "")
        commission_paid = payroll_exists(user, "commission", period_key or "")
        period_out = period_key

    return {
        "period": period_out,
        "total_procedures": total,
        "open_procedures": open_count,
        "in_progress_procedures": in_progress,
        "closed_procedures": closed,
        "rejected_procedures": rejected,
        "closure_ratio": round(closure_ratio, 4),
        "revenue": float(revenue),
        "collected_on_procedures": float(collected_on_procedures),
        "payments_collected": float(payments_collected),
        "net_profit": float(net_profit),
        "commission_rate": float(rate),
        "commission_amount": float(comm),
        "salary": float(profile.salary or 0),
        "salary_paid": settlement["salary_paid"],
        "salary_status": settlement["salary_status"],
        "salary_remaining_due": settlement["salary_remaining_due"],
        "salary_paid_total": settlement["salary_paid_total"],
        "commission_paid": commission_paid,
        "outstanding_advances": float(outstanding_advances),
    }


def team_performance(period: str | PerformancePeriod | None = None) -> list[dict]:
    from accounts.models import EmployeeProfile

    profiles = EmployeeProfile.objects.select_related("user").all()
    rows = []
    for profile in profiles:
        m = employee_metrics(profile.user, profile, period)
        m["employee_id"] = str(profile.id)
        m["user_id"] = profile.user_id
        m["full_name"] = profile.full_name
        m["role"] = profile.user.role
        m["maximum_score"] = PERFORMANCE_SCORE_MAXIMUM
        rows.append(m)

    if not rows:
        return rows

    max_proc = max(r["total_procedures"] for r in rows) or 1
    max_pay = max(r["payments_collected"] for r in rows) or 1
    max_profit = max(r["net_profit"] for r in rows) or 1

    for r in rows:
        proc_norm = r["total_procedures"] / max_proc
        pay_norm = r["payments_collected"] / max_pay
        profit_norm = r["net_profit"] / max_profit
        score = (proc_norm + pay_norm + profit_norm + r["closure_ratio"]) * 25
        r["performance_score"] = round(min(PERFORMANCE_SCORE_MAXIMUM, max(0, score)))
        if r["performance_score"] >= 75:
            r["performance_level"] = "High"
        elif r["performance_score"] >= 50:
            r["performance_level"] = "Medium"
        else:
            r["performance_level"] = "Low"

    rows.sort(key=lambda x: x["performance_score"], reverse=True)
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
        r["rank_total"] = len(rows)
    return rows


def build_team_performance_report(
    resolved: PerformancePeriod,
    *,
    role: str | None = None,
    performance_level: str | None = None,
) -> dict:
    """
    Authoritative Employee Log payload: period metadata, summary KPIs, ranked employees.
    Score/rank use the same selected period for every row and the summary.
    """
    rows = team_performance(resolved)

    # Rank is computed across all profiles for the period (existing definition).
    # Role / performance filters apply after ranking for display.
    filtered = rows
    if role and role.lower() not in ("all", ""):
        filtered = [r for r in filtered if (r.get("role") or "").lower() == role.lower()]
    if performance_level and performance_level.lower() not in ("all", ""):
        level = performance_level.strip().capitalize()
        if level in ("High", "Medium", "Low"):
            filtered = [r for r in filtered if r.get("performance_level") == level]

    summary = {
        "total_employees": len(filtered),
        "open_procedures": sum(r["open_procedures"] for r in filtered),
        "closed_procedures": sum(r["closed_procedures"] for r in filtered),
        "total_collected": round(sum(r["payments_collected"] for r in filtered), 2),
        "salaries_due": round(
            sum(
                float(r.get("salary_remaining_due") or 0)
                for r in filtered
                if not r.get("salary_paid")
            ),
            2,
        ),
        "commissions_due": round(
            sum(
                float(r.get("commission_amount") or 0)
                for r in filtered
                if not r.get("commission_paid") and float(r.get("commission_rate") or 0) > 0
            ),
            2,
        ),
        "rank_total": len(rows),
    }

    return {
        "period": resolved.to_meta(),
        "summary": summary,
        "employees": filtered,
    }


def score_payload_for_user(user, period: str | None = None) -> dict:
    """
    Read-only score/rank for one user from the authoritative team_performance result.

    Reuses the same formula and ranking as Employee Log /employees/{id}/dashboard/.
    Does not accept a client-supplied employee id — callers must pass request.user.
    """
    period_key = period
    if period_key is None:
        period_key = current_period_key()
    elif period_key == "" or period_key.lower() in ("all", "lifetime"):
        period_key = None

    if period_key is None:
        resolved = resolve_performance_period(period_mode="all_time")
        team = team_performance(resolved)
        period_info = {
            "type": "lifetime",
            "month": None,
            "year": None,
            "key": None,
            "mode": "all_time",
        }
    else:
        _, _, resolved_key = _parse_period(period_key)
        if not resolved_key:
            return {
                "score": {
                    "value": None,
                    "maximum": PERFORMANCE_SCORE_MAXIMUM,
                    "rank": None,
                    "rank_total": None,
                    "performance_level": None,
                    "period": None,
                }
            }
        resolved = resolve_performance_period(period=resolved_key)
        team = team_performance(resolved)
        period_info = {
            "type": "month",
            "month": resolved.month,
            "year": resolved.year,
            "key": resolved.period_key,
            "mode": "month",
        }

    rank_total = len(team)

    from accounts.models import EmployeeProfile

    profile = EmployeeProfile.objects.filter(user=user).first()
    rank_row = (
        next((r for r in team if r["employee_id"] == str(profile.id)), None)
        if profile is not None
        else None
    )

    if rank_row is None:
        return {
            "score": {
                "value": None,
                "maximum": PERFORMANCE_SCORE_MAXIMUM,
                "rank": None,
                "rank_total": rank_total if rank_total else None,
                "performance_level": None,
                "period": period_info,
            }
        }

    return {
        "score": {
            "value": rank_row.get("performance_score"),
            "maximum": PERFORMANCE_SCORE_MAXIMUM,
            "rank": rank_row.get("rank"),
            "rank_total": rank_total,
            "performance_level": rank_row.get("performance_level"),
            "period": period_info,
        }
    }
