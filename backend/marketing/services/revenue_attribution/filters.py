"""Revenue attribution filter parsing.

Financial period (optional): date_from / date_to — Payment.date / Procedure.date / spend_date.
Conversion cohort (optional): conversion_date_from / conversion_date_to — Lead.converted_at.
Lifetime default when financial dates omitted.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any
from uuid import UUID

from django.utils import timezone

from marketing.exceptions import (
    InvalidRevenueDateRangeError,
    InvalidRevenueFilterError,
    InvalidRevenueHierarchyError,
)
from marketing.models import (
    MarketingAdSet,
    MarketingAdvertisement,
    MarketingCampaign,
    MarketingChannel,
    MarketingPlatform,
)

MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 20
MAX_DAY_SPAN = 3660  # ~10 years when both dates provided


@dataclass(frozen=True)
class RevenueFilters:
    date_from: date | None = None
    date_to: date | None = None
    conversion_date_from: date | None = None
    conversion_date_to: date | None = None
    channel_id: UUID | None = None
    platform_id: UUID | None = None
    campaign_id: UUID | None = None
    adset_id: UUID | None = None
    advertisement_id: UUID | None = None
    lead_id: UUID | None = None
    customer_id: UUID | None = None
    procedure_type_id: str | None = None  # Procedure.category name (or category id string)
    include_archived: bool = False
    search: str | None = None
    ordering: str | None = None
    page: int = 1
    page_size: int = DEFAULT_PAGE_SIZE

    @property
    def has_financial_period(self) -> bool:
        return self.date_from is not None and self.date_to is not None

    @property
    def has_conversion_cohort(self) -> bool:
        return self.conversion_date_from is not None and self.conversion_date_to is not None

    @property
    def conversion_range_start(self) -> datetime | None:
        if self.conversion_date_from is None:
            return None
        return timezone.make_aware(datetime.combine(self.conversion_date_from, time.min))

    @property
    def conversion_range_end_exclusive(self) -> datetime | None:
        if self.conversion_date_to is None:
            return None
        return timezone.make_aware(
            datetime.combine(self.conversion_date_to + timedelta(days=1), time.min)
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "date_from": self.date_from.isoformat() if self.date_from else None,
            "date_to": self.date_to.isoformat() if self.date_to else None,
            "conversion_date_from": (
                self.conversion_date_from.isoformat() if self.conversion_date_from else None
            ),
            "conversion_date_to": (
                self.conversion_date_to.isoformat() if self.conversion_date_to else None
            ),
            "channel_id": str(self.channel_id) if self.channel_id else None,
            "platform_id": str(self.platform_id) if self.platform_id else None,
            "campaign_id": str(self.campaign_id) if self.campaign_id else None,
            "adset_id": str(self.adset_id) if self.adset_id else None,
            "advertisement_id": str(self.advertisement_id) if self.advertisement_id else None,
            "lead_id": str(self.lead_id) if self.lead_id else None,
            "customer_id": str(self.customer_id) if self.customer_id else None,
            "procedure_type_id": self.procedure_type_id,
            "include_archived": self.include_archived,
            "search": self.search,
            "ordering": self.ordering,
            "page": self.page,
            "page_size": self.page_size,
        }


def _parse_optional_date(raw: Any, *, field: str) -> date | None:
    if raw in (None, ""):
        return None
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw
    text = str(raw).strip()
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise InvalidRevenueFilterError(
            details={"field": field, "reason": "invalid_iso_date", "value": text}
        ) from exc


def _parse_uuid(raw: Any, *, field: str) -> UUID | None:
    if raw in (None, ""):
        return None
    try:
        return UUID(str(raw))
    except (ValueError, TypeError, AttributeError) as exc:
        raise InvalidRevenueFilterError(
            details={"field": field, "reason": "invalid_uuid", "value": str(raw)}
        ) from exc


def _validate_pair(d_from: date | None, d_to: date | None, *, pair: str) -> None:
    if (d_from is None) != (d_to is None):
        raise InvalidRevenueDateRangeError(
            details={"pair": pair, "reason": "both_or_neither_required"}
        )
    if d_from is not None and d_to is not None:
        if d_to < d_from:
            raise InvalidRevenueDateRangeError(
                details={"pair": pair, "reason": "end_before_start"}
            )
        span = (d_to - d_from).days + 1
        if span > MAX_DAY_SPAN:
            raise InvalidRevenueDateRangeError(
                details={"pair": pair, "reason": "range_too_large", "max_days": MAX_DAY_SPAN}
            )


def _validate_hierarchy(
    *,
    channel_id: UUID | None,
    platform_id: UUID | None,
    campaign_id: UUID | None,
    adset_id: UUID | None,
    advertisement_id: UUID | None,
) -> None:
    channel = platform = campaign = adset = ad = None
    if channel_id:
        channel = MarketingChannel.objects.filter(pk=channel_id).first()
        if channel is None:
            raise InvalidRevenueFilterError(
                details={"field": "channel_id", "reason": "not_found"}
            )
    if platform_id:
        platform = MarketingPlatform.objects.filter(pk=platform_id).first()
        if platform is None:
            raise InvalidRevenueFilterError(
                details={"field": "platform_id", "reason": "not_found"}
            )
        if channel_id and platform.channel_id != channel_id:
            raise InvalidRevenueHierarchyError(
                details={"field": "platform_id", "reason": "channel_mismatch"}
            )
    if campaign_id:
        campaign = MarketingCampaign.objects.filter(pk=campaign_id).first()
        if campaign is None:
            raise InvalidRevenueFilterError(
                details={"field": "campaign_id", "reason": "not_found"}
            )
        if platform_id and campaign.platform_id != platform_id:
            raise InvalidRevenueHierarchyError(
                details={"field": "campaign_id", "reason": "platform_mismatch"}
            )
        if channel_id and campaign.platform.channel_id != channel_id:
            raise InvalidRevenueHierarchyError(
                details={"field": "campaign_id", "reason": "channel_mismatch"}
            )
    if adset_id:
        adset = MarketingAdSet.objects.filter(pk=adset_id).first()
        if adset is None:
            raise InvalidRevenueFilterError(details={"field": "adset_id", "reason": "not_found"})
        if campaign_id and adset.campaign_id != campaign_id:
            raise InvalidRevenueHierarchyError(
                details={"field": "adset_id", "reason": "campaign_mismatch"}
            )
    if advertisement_id:
        ad = MarketingAdvertisement.objects.filter(pk=advertisement_id).first()
        if ad is None:
            raise InvalidRevenueFilterError(
                details={"field": "advertisement_id", "reason": "not_found"}
            )
        if campaign_id and ad.campaign_id != campaign_id:
            raise InvalidRevenueHierarchyError(
                details={"field": "advertisement_id", "reason": "campaign_mismatch"}
            )
        if adset_id and ad.ad_set_id and ad.ad_set_id != adset_id:
            raise InvalidRevenueHierarchyError(
                details={"field": "advertisement_id", "reason": "adset_mismatch"}
            )


def parse_revenue_filters(params: dict, *, allow_pagination: bool = False) -> RevenueFilters:
    date_from = _parse_optional_date(params.get("date_from"), field="date_from")
    date_to = _parse_optional_date(params.get("date_to"), field="date_to")
    conv_from = _parse_optional_date(
        params.get("conversion_date_from"), field="conversion_date_from"
    )
    conv_to = _parse_optional_date(params.get("conversion_date_to"), field="conversion_date_to")
    _validate_pair(date_from, date_to, pair="financial")
    _validate_pair(conv_from, conv_to, pair="conversion")

    channel_id = _parse_uuid(params.get("channel_id"), field="channel_id")
    platform_id = _parse_uuid(params.get("platform_id"), field="platform_id")
    campaign_id = _parse_uuid(params.get("campaign_id"), field="campaign_id")
    adset_id = _parse_uuid(params.get("adset_id"), field="adset_id")
    advertisement_id = _parse_uuid(params.get("advertisement_id"), field="advertisement_id")
    lead_id = _parse_uuid(params.get("lead_id"), field="lead_id")
    customer_id = _parse_uuid(params.get("customer_id"), field="customer_id")

    _validate_hierarchy(
        channel_id=channel_id,
        platform_id=platform_id,
        campaign_id=campaign_id,
        adset_id=adset_id,
        advertisement_id=advertisement_id,
    )

    include_archived = str(params.get("include_archived") or "").lower() in (
        "1",
        "true",
        "yes",
    )
    search = (params.get("search") or "").strip() or None
    procedure_type_id = (params.get("procedure_type_id") or "").strip() or None
    ordering = (params.get("ordering") or "").strip() or None

    page = 1
    page_size = DEFAULT_PAGE_SIZE
    if allow_pagination:
        try:
            page = max(1, int(params.get("page") or 1))
        except (TypeError, ValueError) as exc:
            raise InvalidRevenueFilterError(
                details={"field": "page", "reason": "invalid_int"}
            ) from exc
        try:
            page_size = int(params.get("page_size") or DEFAULT_PAGE_SIZE)
        except (TypeError, ValueError) as exc:
            raise InvalidRevenueFilterError(
                details={"field": "page_size", "reason": "invalid_int"}
            ) from exc
        if page_size < 1 or page_size > MAX_PAGE_SIZE:
            raise InvalidRevenueFilterError(
                details={
                    "field": "page_size",
                    "reason": "out_of_bounds",
                    "max": MAX_PAGE_SIZE,
                }
            )

    return RevenueFilters(
        date_from=date_from,
        date_to=date_to,
        conversion_date_from=conv_from,
        conversion_date_to=conv_to,
        channel_id=channel_id,
        platform_id=platform_id,
        campaign_id=campaign_id,
        adset_id=adset_id,
        advertisement_id=advertisement_id,
        lead_id=lead_id,
        customer_id=customer_id,
        procedure_type_id=procedure_type_id,
        include_archived=include_archived,
        search=search,
        ordering=ordering,
        page=page,
        page_size=page_size,
    )
