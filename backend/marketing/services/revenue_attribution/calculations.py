"""Marketing-only Decimal helpers for contribution and ratios."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

RATE_QUANTUM = Decimal("0.0001")
MONEY_QUANTUM = Decimal("0.01")
ROAS_QUANTUM = Decimal("0.01")


def as_decimal(value: Any) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def quantize_money(value: Any) -> Decimal:
    return as_decimal(value).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def quantize_rate(value: Any) -> Decimal:
    return as_decimal(value).quantize(RATE_QUANTUM, rounding=ROUND_HALF_UP)


def quantize_roas(value: Any) -> Decimal:
    return as_decimal(value).quantize(ROAS_QUANTUM, rounding=ROUND_HALF_UP)


def safe_divide(numerator: Any, denominator: Any) -> Decimal | None:
    den = as_decimal(denominator)
    if den == 0:
        return None
    return as_decimal(numerator) / den


def marketing_contribution(net_profit: Any, campaign_spend: Any) -> Decimal:
    """Existing Net Profit − Campaign Spend. Negatives are valid."""
    return quantize_money(as_decimal(net_profit) - as_decimal(campaign_spend))


def roas(collected_revenue: Any, campaign_spend: Any) -> Decimal | None:
    """Collected Revenue ÷ Campaign Spend (multiplier). None if spend is zero."""
    ratio = safe_divide(collected_revenue, campaign_spend)
    if ratio is None:
        return None
    return quantize_roas(ratio)


def marketing_roi(contribution: Any, campaign_spend: Any) -> Decimal | None:
    """Marketing Contribution ÷ Campaign Spend (ratio, not %). None if spend is zero."""
    ratio = safe_divide(contribution, campaign_spend)
    if ratio is None:
        return None
    return quantize_rate(ratio)


def money_to_str(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(quantize_money(value), "f")


def rate_to_str(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(quantize_rate(value), "f")


def roas_to_str(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(quantize_roas(value), "f")
