"""Shared collected-revenue helpers (gross / refunds / net).

Authoritative source for Dashboard, Marketing, and Customer Financials netting.
Do not re-implement Σ Payment − Σ Refund elsewhere.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Iterable
from uuid import UUID

from django.db.models import Sum

from payments.models import Payment, PaymentRefund

MONEY_ZERO = Decimal("0.00")
MONEY_QUANT = Decimal("0.01")


def _dec(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(MONEY_QUANT)


def gross_collected_sum(
    customer_ids: Iterable[UUID] | None = None,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Decimal:
    qs = Payment.objects.all()
    if customer_ids is not None:
        ids = list(customer_ids)
        if not ids:
            return MONEY_ZERO
        qs = qs.filter(customer_id__in=ids)
    if date_from is not None:
        qs = qs.filter(date__gte=date_from)
    if date_to is not None:
        qs = qs.filter(date__lte=date_to)
    return _dec(qs.aggregate(t=Sum("amount")).get("t"))


def refunds_collected_sum(
    customer_ids: Iterable[UUID] | None = None,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    payment_ids=None,
) -> Decimal:
    qs = PaymentRefund.objects.all()
    if customer_ids is not None:
        ids = list(customer_ids)
        if not ids:
            return MONEY_ZERO
        qs = qs.filter(customer_id__in=ids)
    if payment_ids is not None:
        ids = list(payment_ids)
        if not ids:
            return MONEY_ZERO
        qs = qs.filter(payment_id__in=ids)
    if date_from is not None:
        qs = qs.filter(date__gte=date_from)
    if date_to is not None:
        qs = qs.filter(date__lte=date_to)
    return _dec(qs.aggregate(t=Sum("amount")).get("t"))


def net_collected_sum(
    customer_ids: Iterable[UUID] | None = None,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Decimal:
    """Net Collected = Gross Payments − Refunds (same date filters on each)."""
    gross = gross_collected_sum(customer_ids, date_from=date_from, date_to=date_to)
    refunds = refunds_collected_sum(customer_ids, date_from=date_from, date_to=date_to)
    return _dec(gross - refunds)


def collection_breakdown(
    customer_ids: Iterable[UUID] | None = None,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    gross = gross_collected_sum(customer_ids, date_from=date_from, date_to=date_to)
    refunds = refunds_collected_sum(customer_ids, date_from=date_from, date_to=date_to)
    return {
        "gross_collected": gross,
        "refunds": refunds,
        "net_collected": _dec(gross - refunds),
    }
