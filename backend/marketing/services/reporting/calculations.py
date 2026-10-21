"""Shared Decimal-safe reporting calculations."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

RATE_QUANTUM = Decimal("0.0001")
MONEY_QUANTUM = Decimal("0.01")


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


def safe_ratio(numerator: Any, denominator: Any) -> Decimal | None:
    """
    Return Decimal ratio in [0, 1+] with RATE_QUANTUM precision.
    Returns None when denominator is zero.
    """
    den = as_decimal(denominator)
    if den == 0:
        return None
    return quantize_rate(as_decimal(numerator) / den)


def decimal_to_str(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(quantize_money(value), "f")


def rate_to_str(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(quantize_rate(value), "f")
