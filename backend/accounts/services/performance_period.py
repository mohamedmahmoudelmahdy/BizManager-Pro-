"""Shared Employee Performance period resolution.

Normalizes month / year / all_time into inclusive-start, exclusive-end date bounds.
All performance services must use the same resolved period — do not rebuild ranges elsewhere.
"""

from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from django.utils import timezone
from rest_framework.exceptions import ValidationError

MODE_MONTH = "month"
MODE_YEAR = "year"
MODE_ALL_TIME = "all_time"
VALID_MODES = frozenset({MODE_MONTH, MODE_YEAR, MODE_ALL_TIME})

ERR_INVALID_PERIOD = "invalid_performance_period"
ERR_INVALID_YEAR = "invalid_performance_year"
ERR_INVALID_MONTH = "invalid_performance_month"


@dataclass(frozen=True)
class PerformancePeriod:
    mode: str
    start: date | None
    end_exclusive: date
    year: int | None
    month: int | None
    label: str
    """YYYY-MM when mode is month; otherwise None (payroll uses monthly keys separately)."""
    period_key: str | None

    @property
    def end_inclusive(self) -> date:
        return self.end_exclusive - timedelta(days=1)

    @property
    def date_from(self) -> str | None:
        return self.start.isoformat() if self.start else None

    @property
    def date_to(self) -> str:
        return self.end_inclusive.isoformat()

    def to_meta(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "year": self.year,
            "month": self.month,
            "date_from": self.date_from,
            "date_to": self.date_to,
            "label": self.label,
            "period_key": self.period_key,
        }


def _raise(code: str, message: str, field: str | None = None) -> None:
    payload: dict[str, Any] = {"code": code, "detail": message}
    if field:
        raise ValidationError({field: [message], "code": code, "detail": message})
    raise ValidationError(payload)


def earliest_activity_date() -> date | None:
    """Earliest Procedure/Payment/Expense date across the system (local calendar dates)."""
    from expenses.models import Expense
    from payments.models import Payment
    from procedures.models import Procedure

    candidates: list[date] = []
    for model, field in (
        (Procedure, "date"),
        (Payment, "date"),
        (Expense, "date"),
    ):
        value = (
            model.objects.order_by(field).values_list(field, flat=True).first()
        )
        if value:
            candidates.append(value)
    return min(candidates) if candidates else None


def _parse_int(raw, *, field: str, code: str) -> int:
    try:
        return int(raw)
    except (TypeError, ValueError):
        _raise(code, f"Invalid {field}.", field=field)
        raise  # pragma: no cover


def resolve_performance_period(
    *,
    period_mode: str | None = None,
    year: int | str | None = None,
    month: int | str | None = None,
    period: str | None = None,
    today: date | None = None,
) -> PerformancePeriod:
    """
    Resolve a performance reporting window.

    Preferred: period_mode + year/month.
    Legacy: period=YYYY-MM → month mode (backward compatible with dashboard/FC).
    """
    today = today or timezone.localdate()
    tomorrow = today + timedelta(days=1)

    # Legacy YYYY-MM
    if not period_mode and period:
        if len(period) >= 7:
            try:
                y, m = int(period[:4]), int(period[5:7])
                return resolve_performance_period(
                    period_mode=MODE_MONTH, year=y, month=m, today=today
                )
            except (ValueError, TypeError):
                _raise(ERR_INVALID_PERIOD, "Invalid period. Use YYYY-MM.", field="period")
        if period.lower() in ("all", "lifetime", "all_time"):
            period_mode = MODE_ALL_TIME
        else:
            _raise(ERR_INVALID_PERIOD, "Invalid period. Use YYYY-MM.", field="period")

    mode = (period_mode or MODE_MONTH).strip().lower()
    if mode not in VALID_MODES:
        _raise(
            ERR_INVALID_PERIOD,
            "period_mode must be month, year, or all_time.",
            field="period_mode",
        )

    if mode == MODE_ALL_TIME:
        start = earliest_activity_date()
        return PerformancePeriod(
            mode=MODE_ALL_TIME,
            start=start,
            end_exclusive=tomorrow,
            year=None,
            month=None,
            label="All time",
            period_key=None,
        )

    if year is None:
        _raise(ERR_INVALID_YEAR, "year is required for this period mode.", field="year")
    y = _parse_int(year, field="year", code=ERR_INVALID_YEAR)
    if y < 2000 or y > today.year + 1:
        _raise(ERR_INVALID_YEAR, "year is out of range.", field="year")

    if mode == MODE_YEAR:
        start = date(y, 1, 1)
        if y < today.year:
            end_exclusive = date(y + 1, 1, 1)
        elif y == today.year:
            end_exclusive = tomorrow
        else:
            # Future year — empty window ending at tomorrow (no future data).
            end_exclusive = tomorrow
            start = tomorrow
        return PerformancePeriod(
            mode=MODE_YEAR,
            start=start,
            end_exclusive=end_exclusive,
            year=y,
            month=None,
            label=str(y),
            period_key=None,
        )

    # MODE_MONTH
    if month is None:
        _raise(ERR_INVALID_MONTH, "month is required for month period mode.", field="month")
    m = _parse_int(month, field="month", code=ERR_INVALID_MONTH)
    if m < 1 or m > 12:
        _raise(ERR_INVALID_MONTH, "month must be between 1 and 12.", field="month")

    start = date(y, m, 1)
    last_day = monthrange(y, m)[1]
    month_end_exclusive = date(y, m, last_day) + timedelta(days=1)
    # Never include future dates within the current month.
    end_exclusive = min(month_end_exclusive, tomorrow)
    if start >= end_exclusive:
        # Entirely future month
        end_exclusive = tomorrow
        start = tomorrow

    months = (
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    )
    return PerformancePeriod(
        mode=MODE_MONTH,
        start=start,
        end_exclusive=end_exclusive,
        year=y,
        month=m,
        label=f"{months[m - 1]} {y}",
        period_key=f"{y:04d}-{m:02d}",
    )


def iter_month_keys(start: date, end_inclusive: date) -> list[str]:
    """YYYY-MM keys from start month through end_inclusive month inclusive."""
    keys: list[str] = []
    y, m = start.year, start.month
    end_y, end_m = end_inclusive.year, end_inclusive.month
    while (y, m) <= (end_y, end_m):
        keys.append(f"{y:04d}-{m:02d}")
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1
    return keys
