"""Reports hybrid Model D — profitability vs customer collections.

PROFITABILITY (Procedure.date):
  Procedure Revenue = Σ selling_price
  Procedure Costs Incurred = Σ cost
  Operating Expenses = expense_reporting (payroll_period rule)
  Operating Profit = revenue − costs − opex

COLLECTIONS (Payment / PaymentRefund event dates):
  Independent of profitability. Customer-level (procedure=NULL) payments are valid.

Proportional matched-cost helpers are retained for a possible future feature only.
"""
from __future__ import annotations

from calendar import monthrange
from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any

from django.db.models import Count, Sum

from dashboard.services.expense_reporting import (
    operating_expenses_by_category,
    operating_expenses_total,
)
from payments.models import Payment, PaymentRefund
from payments.services.collections import collection_breakdown
from procedures.models import Procedure

MONEY_ZERO = Decimal("0.00")
MONEY_QUANT = Decimal("0.01")

DISCOUNT_TREATMENT_NOTE = (
    "Discount treatment requires separate profitability policy. "
    "Procedure Revenue uses gross Procedure.selling_price for this phase."
)


def _dec(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(MONEY_QUANT)


def _money_str(value: Decimal) -> str:
    return f"{_dec(value):.2f}"


def parse_month_period(period: str | None) -> tuple[date, date, str]:
    """Parse YYYY-MM into inclusive [start, end] and normalized key."""
    today = date.today()
    if not period:
        key = f"{today.year:04d}-{today.month:02d}"
        start = date(today.year, today.month, 1)
        end = date(today.year, today.month, monthrange(today.year, today.month)[1])
        return start, end, key
    text = str(period).strip()[:7]
    year = int(text[0:4])
    month = int(text[5:7])
    start = date(year, month, 1)
    end = date(year, month, monthrange(year, month)[1])
    return start, end, f"{year:04d}-{month:02d}"


def procedure_revenue(date_from: date, date_to: date) -> Decimal:
    """Σ Procedure.selling_price for Procedure.date in period (all statuses present)."""
    total = (
        Procedure.objects.filter(date__gte=date_from, date__lte=date_to)
        .aggregate(t=Sum("selling_price"))
        .get("t")
    )
    return _dec(total)


def procedure_costs_incurred(date_from: date, date_to: date) -> Decimal:
    """
    Σ Procedure.cost for Procedure.date in period.

    Soft status changes do not reverse BankCard cash-out. Hard delete restores cost
    and removes the row, so deleted procedures are excluded.
    """
    total = (
        Procedure.objects.filter(date__gte=date_from, date__lte=date_to)
        .aggregate(t=Sum("cost"))
        .get("t")
    )
    return _dec(total)


def procedure_revenue_by_category(date_from: date, date_to: date) -> list[dict]:
    rows = (
        Procedure.objects.filter(date__gte=date_from, date__lte=date_to)
        .values("category")
        .annotate(total=Sum("selling_price"), count=Count("id"))
        .order_by("-total")
    )
    return [
        {
            "category": row["category"] or "Uncategorized",
            "total": _money_str(_dec(row["total"])),
            "count": int(row["count"] or 0),
        }
        for row in rows
    ]


def procedure_costs_by_category(date_from: date, date_to: date) -> list[dict]:
    rows = (
        Procedure.objects.filter(date__gte=date_from, date__lte=date_to)
        .values("category")
        .annotate(total=Sum("cost"), count=Count("id"))
        .order_by("-total")
    )
    return [
        {
            "category": row["category"] or "Uncategorized",
            "total": _money_str(_dec(row["total"])),
            "count": int(row["count"] or 0),
        }
        for row in rows
    ]


# ---------------------------------------------------------------------------
# Matched Collection Margin helpers (NOT used by primary Reports KPIs)
# ---------------------------------------------------------------------------


def _cost_ratio(procedure: Procedure) -> Decimal:
    selling = _dec(procedure.selling_price)
    cost = _dec(procedure.cost)
    if selling <= MONEY_ZERO:
        return MONEY_ZERO
    return (cost / selling).quantize(Decimal("0.0000001"))


def _procedure_events(procedure_id) -> list[tuple[date, str, Decimal]]:
    events: list[tuple[date, str, Decimal, str]] = []
    for p in Payment.objects.filter(procedure_id=procedure_id).only("id", "date", "amount"):
        events.append((p.date, "p", _dec(p.amount), str(p.id)))
    for r in PaymentRefund.objects.filter(payment__procedure_id=procedure_id).only(
        "id", "date", "amount"
    ):
        events.append((r.date, "r", -_dec(r.amount), str(r.id)))
    events.sort(key=lambda e: (e[0], e[1], e[3]))
    return [(d, kind, amt) for d, kind, amt, _ in events]


def recognized_cost_delta_for_period(
    procedure: Procedure,
    date_from: date,
    date_to: date,
) -> Decimal:
    """Proportional matched cost (future matched-margin use only)."""
    ratio = _cost_ratio(procedure)
    max_cost = _dec(procedure.cost)
    if ratio == MONEY_ZERO or max_cost == MONEY_ZERO:
        return MONEY_ZERO

    running_net = MONEY_ZERO
    running_recognized = MONEY_ZERO
    period_delta = MONEY_ZERO

    for event_date, _kind, signed in _procedure_events(procedure.pk):
        if event_date > date_to:
            break
        running_net = _dec(running_net + signed)
        target = _dec(running_net * ratio)
        if target < MONEY_ZERO:
            target = MONEY_ZERO
        if target > max_cost:
            target = max_cost
        delta = _dec(target - running_recognized)
        running_recognized = target
        if date_from <= event_date <= date_to:
            period_delta = _dec(period_delta + delta)

    return period_delta


def recognized_procedure_cost_total(date_from: date, date_to: date) -> Decimal:
    """Sum of proportional matched costs (not used by primary Reports KPIs)."""
    proc_ids = set(
        Payment.objects.filter(procedure_id__isnull=False).values_list("procedure_id", flat=True)
    )
    total = MONEY_ZERO
    for proc in Procedure.objects.filter(pk__in=proc_ids).only("id", "cost", "selling_price"):
        total = _dec(total + recognized_cost_delta_for_period(proc, date_from, date_to))
    return total


def procedure_linked_net_collected(date_from: date, date_to: date) -> Decimal:
    """Net collections with Payment.procedure set (analytical only)."""
    gross = _dec(
        Payment.objects.filter(
            procedure_id__isnull=False, date__gte=date_from, date__lte=date_to
        ).aggregate(t=Sum("amount")).get("t")
    )
    refunds = _dec(
        PaymentRefund.objects.filter(
            payment__procedure_id__isnull=False, date__gte=date_from, date__lte=date_to
        ).aggregate(t=Sum("amount")).get("t")
    )
    return _dec(gross - refunds)


def customer_level_net_collected(date_from: date, date_to: date) -> Decimal:
    """Net collections with Payment.procedure NULL (valid customer-level cash)."""
    gross = _dec(
        Payment.objects.filter(
            procedure_id__isnull=True, date__gte=date_from, date__lte=date_to
        ).aggregate(t=Sum("amount")).get("t")
    )
    refunds = _dec(
        PaymentRefund.objects.filter(
            payment__procedure_id__isnull=True, date__gte=date_from, date__lte=date_to
        ).aggregate(t=Sum("amount")).get("t")
    )
    return _dec(gross - refunds)


# Back-compat aliases for older imports/tests
allocated_net_collected = procedure_linked_net_collected
unallocated_net_collected = customer_level_net_collected


def collections_by_link_type(date_from: date, date_to: date) -> list[dict]:
    """Collections breakdown by procedure-linked vs customer-level (not profitability)."""
    linked = procedure_linked_net_collected(date_from, date_to)
    customer_level = customer_level_net_collected(date_from, date_to)
    rows = []
    if linked != MONEY_ZERO:
        rows.append({"category": "Procedure-linked", "net_collected": _money_str(linked)})
    if customer_level != MONEY_ZERO:
        rows.append({"category": "Customer-level", "net_collected": _money_str(customer_level)})
    return rows


def build_collected_profitability(period: str | None = None) -> dict[str, Any]:
    date_from, date_to, period_key = parse_month_period(period)

    # --- Profitability ---
    revenue = procedure_revenue(date_from, date_to)
    incurred_cost = procedure_costs_incurred(date_from, date_to)
    operating = operating_expenses_total(date_from, date_to)
    operating_profit = _dec(revenue - incurred_cost - operating)

    if revenue != MONEY_ZERO:
        margin = (operating_profit / revenue * Decimal("100")).quantize(Decimal("0.01"))
        margin_str = f"{margin:.2f}"
    else:
        margin_str = None

    expense_dist = operating_expenses_by_category(date_from, date_to)
    dist_sum = _dec(sum((_dec(r["total"]) for r in expense_dist), MONEY_ZERO))
    rev_by_cat = procedure_revenue_by_category(date_from, date_to)
    cost_by_cat = procedure_costs_by_category(date_from, date_to)

    # --- Collections (independent) ---
    breakdown = collection_breakdown(date_from=date_from, date_to=date_to)
    gross = _dec(breakdown["gross_collected"])
    refunds = _dec(breakdown["refunds"])
    net = _dec(breakdown["net_collected"])
    linked = procedure_linked_net_collected(date_from, date_to)
    customer_level = customer_level_net_collected(date_from, date_to)

    profitability = {
        "procedure_revenue": _money_str(revenue),
        "procedure_costs_incurred": _money_str(incurred_cost),
        "operating_expenses": _money_str(operating),
        "operating_profit": _money_str(operating_profit),
        "profit_margin": margin_str,
        "profit_margin_pct": f"{margin_str}%" if margin_str is not None else None,
    }

    collections = {
        "gross_customer_collections": _money_str(gross),
        "refunds": _money_str(refunds),
        "net_customer_collections": _money_str(net),
        "procedure_linked_collections": _money_str(linked),
        "customer_level_collections": _money_str(customer_level),
    }

    return {
        "period": period_key,
        "period_start": date_from.isoformat(),
        "period_end": date_to.isoformat(),
        "profitability": profitability,
        "collections": collections,
        # Flat mirrors of nested blocks (same semantics — no renamed Phase-3 meanings).
        "procedure_revenue": profitability["procedure_revenue"],
        "procedure_costs_incurred": profitability["procedure_costs_incurred"],
        "operating_expenses": profitability["operating_expenses"],
        "operating_profit": profitability["operating_profit"],
        "profit_margin": profitability["profit_margin"],
        "profit_margin_pct": profitability["profit_margin_pct"],
        "gross_collected": collections["gross_customer_collections"],
        "refunds": collections["refunds"],
        "net_collected": collections["net_customer_collections"],
        "procedure_linked_collections": collections["procedure_linked_collections"],
        "customer_level_collections": collections["customer_level_collections"],
        "expense_distribution": expense_dist,
        "expense_distribution_total": _money_str(dist_sum),
        "procedure_revenue_by_category": rev_by_cat,
        "procedure_costs_by_category": cost_by_cat,
        "collections_by_category": collections_by_link_type(date_from, date_to),
        "collection_breakdown": {
            "gross_customer_collections": collections["gross_customer_collections"],
            "refunds": collections["refunds"],
            "net_customer_collections": collections["net_customer_collections"],
            "procedure_linked_collections": collections["procedure_linked_collections"],
            "customer_level_collections": collections["customer_level_collections"],
        },
        "notes": {
            "discount_treatment": DISCOUNT_TREATMENT_NOTE,
            "procedure_date_edit": (
                "Changing Procedure.date may move selling_price/cost between reporting "
                "months without relocating the historical BankCard cash-out event."
            ),
        },
        "labels": {
            "procedure_revenue": "Procedure Revenue",
            "procedure_costs_incurred": "Procedure Costs Incurred",
            "operating_expenses": "Operating Expenses",
            "operating_profit": "Operating Profit",
            "customer_level_collections": "Customer-level Collections",
            "customer_level_note": (
                "Customer-level collections have no Payment.procedure link. "
                "They are valid account payments and are not synonymous with customer credit. "
                "True customer credit is Customer.balance < 0."
            ),
        },
    }
