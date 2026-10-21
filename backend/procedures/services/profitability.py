"""Authoritative procedure Net Profit and collected-revenue helpers.

Used by employee performance and Marketing revenue attribution.
Do not duplicate these formulas elsewhere.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Iterable
from uuid import UUID

from django.db.models import Case, F, QuerySet, Sum, Value, When

from payments.models import Payment
from payments.services.collections import (
    collection_breakdown,
    gross_collected_sum,
    net_collected_sum,
    refunds_collected_sum,
)
from procedures.models import Procedure

MONEY_ZERO = Decimal("0")


def net_profit_expression():
    """SQL expression: max(selling_price - cost, 0) per procedure row."""
    return Case(
        When(selling_price__gt=F("cost"), then=F("selling_price") - F("cost")),
        default=Value(MONEY_ZERO),
    )


def net_profit_sum(queryset: QuerySet) -> Decimal:
    """
    Authoritative Net Profit over a Procedure queryset.

    Formula (matches accounts.services.employee_performance historically):
        Σ max(selling_price − cost, 0)

    Callers must filter status=done (and any date/customer scope) before calling.
    Net Profit is procedure-margin based and is NOT reduced by customer refunds
    (refunds are cash-flow / collected-revenue events, not charge reversals).
    """
    agg = queryset.aggregate(total=Sum(net_profit_expression()))
    return agg.get("total") or MONEY_ZERO


def done_procedures_for_customers(
    customer_ids: Iterable[UUID],
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> QuerySet[Procedure]:
    """DONE procedures for the given customers; optional inclusive Procedure.date range."""
    ids = list(customer_ids)
    if not ids:
        return Procedure.objects.none()
    qs = Procedure.objects.filter(customer_id__in=ids, status=Procedure.Status.DONE)
    if date_from is not None:
        qs = qs.filter(date__gte=date_from)
    if date_to is not None:
        qs = qs.filter(date__lte=date_to)
    return qs


def collected_revenue_sum(
    customer_ids: Iterable[UUID],
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Decimal:
    """
    Authoritative Collected Revenue (net) =
        Σ Payment.amount − Σ PaymentRefund.amount

    Gross receipts and refunds are filtered by their own dates (inclusive).
    Use collection_breakdown() when gross/refund/net must be shown separately.
    """
    return net_collected_sum(customer_ids, date_from=date_from, date_to=date_to)


def gross_collected_revenue_sum(
    customer_ids: Iterable[UUID],
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Decimal:
    return gross_collected_sum(customer_ids, date_from=date_from, date_to=date_to)


def refunds_revenue_sum(
    customer_ids: Iterable[UUID],
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Decimal:
    return refunds_collected_sum(customer_ids, date_from=date_from, date_to=date_to)


def collected_revenue_breakdown(
    customer_ids: Iterable[UUID],
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    return collection_breakdown(customer_ids, date_from=date_from, date_to=date_to)


def payment_date_bounds(
    customer_ids: Iterable[UUID],
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> tuple[date | None, date | None]:
    """Return (first_payment_date, latest_payment_date) within optional range."""
    from django.db.models import Max, Min

    ids = list(customer_ids)
    if not ids:
        return None, None
    qs = Payment.objects.filter(customer_id__in=ids)
    if date_from is not None:
        qs = qs.filter(date__gte=date_from)
    if date_to is not None:
        qs = qs.filter(date__lte=date_to)
    agg = qs.aggregate(first=Min("date"), latest=Max("date"))
    return agg.get("first"), agg.get("latest")
