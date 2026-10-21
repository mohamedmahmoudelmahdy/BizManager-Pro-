"""Adapter over authoritative financial helpers (no formula duplication)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Iterable
from uuid import UUID

from django.db.models import Count, Sum

from procedures.models import Procedure
from procedures.services.profitability import (
    collected_revenue_breakdown,
    collected_revenue_sum,
    done_procedures_for_customers,
    net_profit_sum,
    payment_date_bounds,
)
from marketing.services.revenue_attribution.calculations import quantize_money


def financial_for_customers(
    customer_ids: Iterable[UUID],
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    """
    Return collected revenue + net profit for a customer set.

    Collected Revenue (net) = Σ Payment.amount − Σ PaymentRefund.amount (by date)
    Net Profit              = Σ max(selling_price − cost, 0) for DONE procedures (Procedure.date)
    """
    ids = list(customer_ids)
    breakdown = collected_revenue_breakdown(ids, date_from=date_from, date_to=date_to)
    revenue = breakdown["net_collected"]
    procs = done_procedures_for_customers(ids, date_from=date_from, date_to=date_to)
    profit = net_profit_sum(procs)
    proc_count = procs.count() if ids else 0
    first_pay, latest_pay = payment_date_bounds(ids, date_from=date_from, date_to=date_to)
    return {
        "collected_revenue": quantize_money(revenue),
        "gross_collected_revenue": quantize_money(breakdown["gross_collected"]),
        "refunds": quantize_money(breakdown["refunds"]),
        "net_profit": quantize_money(profit),
        "procedures": proc_count,
        "first_payment_at": first_pay,
        "latest_payment_at": latest_pay,
    }


def procedure_type_aggregates(
    customer_ids: Iterable[UUID],
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    category: str | None = None,
) -> list[dict]:
    """
    Aggregate Net Profit by Procedure.category for DONE procedures.

    Collected revenue is NOT allocated here: Payments are not reliably linked to
    procedures. Each row returns collected_revenue=None to document the limitation.
    """
    ids = list(customer_ids)
    if not ids:
        return []
    qs = done_procedures_for_customers(ids, date_from=date_from, date_to=date_to)
    if category:
        qs = qs.filter(category=category)
    from procedures.services.profitability import net_profit_expression

    rows = (
        qs.values("category")
        .annotate(
            procedure_count=Count("id"),
            customer_count=Count("customer_id", distinct=True),
            net_profit=Sum(net_profit_expression()),
        )
        .order_by("category")
    )
    out = []
    for row in rows:
        count = int(row["procedure_count"] or 0)
        profit = quantize_money(row["net_profit"] or Decimal("0"))
        avg = quantize_money(profit / count) if count else None
        out.append(
            {
                "procedure_type": row["category"] or "",
                "procedure_count": count,
                "customer_count": int(row["customer_count"] or 0),
                "collected_revenue": None,  # not allocatable at procedure type
                "net_profit": profit,
                "average_revenue": None,
                "average_net_profit": avg,
            }
        )
    return out
