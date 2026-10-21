"""
Reporting filter parsing and hierarchy validation.

Date semantics:
- date_from / date_to are calendar dates (ISO YYYY-MM-DD)
- Inclusive range: [date_from 00:00:00, date_to+1 day 00:00:00) in TIME_ZONE
- Default: first day of current month → today (timezone.localdate)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any
from uuid import UUID

from django.utils import timezone

from marketing.exceptions import (
    InvalidReportDateRangeError,
    InvalidReportFilterError,
    InvalidReportHierarchyError,
    InvalidReportingIntervalError,
    ReportDateRangeTooLargeError,
)
from marketing.models import (
    MarketingAdSet,
    MarketingAdvertisement,
    MarketingCampaign,
    MarketingChannel,
    MarketingPlatform,
)


@dataclass(frozen=True)
class ReportFilters:
    date_from: date
    date_to: date
    channel_id: UUID | None = None
    platform_id: UUID | None = None
    campaign_id: UUID | None = None
    adset_id: UUID | None = None
    advertisement_id: UUID | None = None
    status: str | None = None
    outcome: str | None = None
    assigned_to: int | None = None
    include_archived: bool = False
    interval: str | None = None
    search: str | None = None
    ordering: str | None = None
    page: int = 1
    page_size: int = 20

    @property
    def range_start(self) -> datetime:
        """Inclusive start datetime (timezone-aware)."""
        return timezone.make_aware(datetime.combine(self.date_from, time.min))

    @property
    def range_end_exclusive(self) -> datetime:
        """Exclusive end datetime (start of day after date_to)."""
        return timezone.make_aware(datetime.combine(self.date_to + timedelta(days=1), time.min))

    @property
    def day_span(self) -> int:
        return (self.date_to - self.date_from).days + 1

    def to_dict(self) -> dict[str, Any]:
        return {
            "date_from": self.date_from.isoformat(),
            "date_to": self.date_to.isoformat(),
            "channel_id": str(self.channel_id) if self.channel_id else None,
            "platform_id": str(self.platform_id) if self.platform_id else None,
            "campaign_id": str(self.campaign_id) if self.campaign_id else None,
            "adset_id": str(self.adset_id) if self.adset_id else None,
            "advertisement_id": str(self.advertisement_id) if self.advertisement_id else None,
            "status": self.status,
            "outcome": self.outcome,
            "assigned_to": self.assigned_to,
            "include_archived": self.include_archived,
        }


def _default_dates() -> tuple[date, date]:
    today = timezone.localdate()
    return today.replace(day=1), today


def _parse_date(raw: Any, *, field: str) -> date:
    if raw in (None, ""):
        raise InvalidReportFilterError(details={"field": field, "reason": "required"})
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw
    text = str(raw).strip()
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise InvalidReportFilterError(
            details={"field": field, "reason": "invalid_iso_date", "value": text}
        ) from exc


def _parse_uuid(raw: Any, *, field: str) -> UUID | None:
    if raw in (None, ""):
        return None
    try:
        return UUID(str(raw))
    except (TypeError, ValueError) as exc:
        raise InvalidReportFilterError(
            details={"field": field, "reason": "invalid_uuid", "value": str(raw)}
        ) from exc


def _parse_bool(raw: Any, *, default: bool = False) -> bool:
    if raw in (None, ""):
        return default
    if isinstance(raw, bool):
        return raw
    return str(raw).strip().lower() in ("1", "true", "yes")


def _parse_int(raw: Any, *, field: str) -> int | None:
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError) as exc:
        raise InvalidReportFilterError(
            details={"field": field, "reason": "invalid_integer"}
        ) from exc


def validate_hierarchy(
    *,
    channel_id: UUID | None,
    platform_id: UUID | None,
    campaign_id: UUID | None,
    adset_id: UUID | None,
    advertisement_id: UUID | None,
) -> None:
    """Ensure selected child IDs belong to selected parents when both are provided."""
    channel = None
    platform = None
    campaign = None
    adset = None

    if channel_id is not None:
        channel = MarketingChannel.objects.filter(pk=channel_id).first()
        if channel is None:
            raise InvalidReportHierarchyError(
                details={"field": "channel_id", "reason": "not_found"},
                http_status=404,
            )

    if platform_id is not None:
        platform = MarketingPlatform.objects.filter(pk=platform_id).first()
        if platform is None:
            raise InvalidReportHierarchyError(
                details={"field": "platform_id", "reason": "not_found"},
                http_status=404,
            )
        if channel_id is not None and platform.channel_id != channel_id:
            raise InvalidReportHierarchyError(
                details={"field": "platform_id", "reason": "channel_mismatch"}
            )

    if campaign_id is not None:
        campaign = MarketingCampaign.objects.filter(pk=campaign_id).select_related("platform").first()
        if campaign is None:
            raise InvalidReportHierarchyError(
                details={"field": "campaign_id", "reason": "not_found"},
                http_status=404,
            )
        if platform_id is not None and campaign.platform_id != platform_id:
            raise InvalidReportHierarchyError(
                details={"field": "campaign_id", "reason": "platform_mismatch"}
            )
        if channel_id is not None and campaign.platform.channel_id != channel_id:
            raise InvalidReportHierarchyError(
                details={"field": "campaign_id", "reason": "channel_mismatch"}
            )

    if adset_id is not None:
        adset = MarketingAdSet.objects.filter(pk=adset_id).first()
        if adset is None:
            raise InvalidReportHierarchyError(
                details={"field": "adset_id", "reason": "not_found"},
                http_status=404,
            )
        if campaign_id is not None and adset.campaign_id != campaign_id:
            raise InvalidReportHierarchyError(
                details={"field": "adset_id", "reason": "campaign_mismatch"}
            )

    if advertisement_id is not None:
        ad = MarketingAdvertisement.objects.filter(pk=advertisement_id).first()
        if ad is None:
            raise InvalidReportHierarchyError(
                details={"field": "advertisement_id", "reason": "not_found"},
                http_status=404,
            )
        if campaign_id is not None and ad.campaign_id != campaign_id:
            raise InvalidReportHierarchyError(
                details={"field": "advertisement_id", "reason": "campaign_mismatch"}
            )
        if adset_id is not None and ad.ad_set_id and ad.ad_set_id != adset_id:
            raise InvalidReportHierarchyError(
                details={"field": "advertisement_id", "reason": "adset_mismatch"}
            )


def enforce_range_limits(*, day_span: int, interval: str | None) -> None:
    if interval == "day" and day_span > 366:
        raise ReportDateRangeTooLargeError(
            details={"interval": "day", "max_days": 366, "day_span": day_span}
        )
    if interval == "week" and day_span > 366 * 3:
        raise ReportDateRangeTooLargeError(
            details={"interval": "week", "max_days": 366 * 3, "day_span": day_span}
        )
    if interval == "month" and day_span > 366 * 10:
        raise ReportDateRangeTooLargeError(
            details={"interval": "month", "max_days": 366 * 10, "day_span": day_span}
        )
    # Overview / non-interval endpoints: soft cap 10 years
    if interval is None and day_span > 366 * 10:
        raise ReportDateRangeTooLargeError(
            details={"interval": None, "max_days": 366 * 10, "day_span": day_span}
        )


def parse_report_filters(
    params: dict[str, Any],
    *,
    allow_interval: bool = False,
    allow_pagination: bool = False,
) -> ReportFilters:
    default_from, default_to = _default_dates()
    raw_from = params.get("date_from")
    raw_to = params.get("date_to")
    date_from = _parse_date(raw_from, field="date_from") if raw_from not in (None, "") else default_from
    date_to = _parse_date(raw_to, field="date_to") if raw_to not in (None, "") else default_to

    if date_from > date_to:
        raise InvalidReportDateRangeError(
            details={"reason": "date_from_after_date_to", "date_from": date_from.isoformat(), "date_to": date_to.isoformat()}
        )

    channel_id = _parse_uuid(params.get("channel_id") or params.get("channel"), field="channel_id")
    platform_id = _parse_uuid(params.get("platform_id") or params.get("platform"), field="platform_id")
    campaign_id = _parse_uuid(params.get("campaign_id") or params.get("campaign"), field="campaign_id")
    adset_id = _parse_uuid(params.get("adset_id") or params.get("ad_set"), field="adset_id")
    advertisement_id = _parse_uuid(
        params.get("advertisement_id") or params.get("advertisement"), field="advertisement_id"
    )

    validate_hierarchy(
        channel_id=channel_id,
        platform_id=platform_id,
        campaign_id=campaign_id,
        adset_id=adset_id,
        advertisement_id=advertisement_id,
    )

    interval = None
    if allow_interval:
        interval = (params.get("interval") or "day").strip().lower()
        if interval not in ("day", "week", "month"):
            raise InvalidReportingIntervalError(
                details={"interval": interval, "allowed": ["day", "week", "month"]}
            )

    enforce_range_limits(day_span=(date_to - date_from).days + 1, interval=interval)

    page = 1
    page_size = 20
    search = None
    ordering = None
    if allow_pagination:
        page = _parse_int(params.get("page"), field="page") or 1
        page_size = _parse_int(params.get("page_size"), field="page_size") or 20
        if page < 1:
            raise InvalidReportFilterError(details={"field": "page", "reason": "min_1"})
        if page_size < 1 or page_size > 100:
            raise InvalidReportFilterError(
                details={"field": "page_size", "reason": "range_1_100"}
            )
        search = (params.get("search") or "").strip() or None
        ordering = (params.get("ordering") or "").strip() or None

    status = (params.get("status") or "").strip() or None
    outcome = params.get("outcome")
    if outcome is not None:
        outcome = str(outcome).strip()
        if outcome == "":
            outcome = ""  # explicit empty outcome filter
        # keep as-is for non-empty

    assigned_to = _parse_int(params.get("assigned_to"), field="assigned_to")

    return ReportFilters(
        date_from=date_from,
        date_to=date_to,
        channel_id=channel_id,
        platform_id=platform_id,
        campaign_id=campaign_id,
        adset_id=adset_id,
        advertisement_id=advertisement_id,
        status=status,
        outcome=None if outcome is None else outcome,
        assigned_to=assigned_to,
        include_archived=_parse_bool(params.get("include_archived"), default=False),
        interval=interval,
        search=search,
        ordering=ordering,
        page=page,
        page_size=page_size,
    )
