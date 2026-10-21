"""Authoritative hierarchy validation for Marketing CRM attribution entities."""

from __future__ import annotations

from uuid import UUID

from marketing.exceptions import (
    InvalidAdSetCampaignError,
    InvalidAdvertisementHierarchyError,
    InvalidCampaignPlatformError,
    InvalidPlatformChannelError,
)
from marketing.models import (
    MarketingAdSet,
    MarketingAdvertisement,
    MarketingCampaign,
    MarketingChannel,
    MarketingPlatform,
)


def validate_platform_channel(
    *,
    channel_id: UUID | None,
    platform: MarketingPlatform | None = None,
    expected_channel_id: UUID | None = None,
) -> None:
    """Ensure a Platform is (or will be) attached to the given Channel."""
    if channel_id is None:
        raise InvalidPlatformChannelError(details={"field": "channel_id"})
    if not MarketingChannel.objects.filter(pk=channel_id).exists():
        raise InvalidPlatformChannelError(
            details={"field": "channel_id", "channel_id": str(channel_id), "reason": "not_found"}
        )
    if platform is not None and expected_channel_id is not None:
        if platform.channel_id != expected_channel_id:
            raise InvalidPlatformChannelError(
                details={
                    "platform_id": str(platform.pk),
                    "channel_id": str(expected_channel_id),
                    "actual_channel_id": str(platform.channel_id),
                }
            )


def validate_campaign_platform(
    *,
    platform_id: UUID | None,
    campaign: MarketingCampaign | None = None,
    expected_platform_id: UUID | None = None,
) -> MarketingPlatform:
    """Ensure a Campaign is attached to an existing Platform. Returns the Platform."""
    if platform_id is None:
        raise InvalidCampaignPlatformError(details={"field": "platform_id"})
    try:
        platform = MarketingPlatform.objects.select_related("channel").get(pk=platform_id)
    except MarketingPlatform.DoesNotExist as exc:
        raise InvalidCampaignPlatformError(
            details={"field": "platform_id", "platform_id": str(platform_id), "reason": "not_found"}
        ) from exc
    if campaign is not None and expected_platform_id is not None:
        if campaign.platform_id != expected_platform_id:
            raise InvalidCampaignPlatformError(
                details={
                    "campaign_id": str(campaign.pk),
                    "platform_id": str(expected_platform_id),
                    "actual_platform_id": str(campaign.platform_id),
                }
            )
    return platform


def validate_adset_campaign(
    *,
    campaign_id: UUID | None,
    ad_set: MarketingAdSet | None = None,
) -> MarketingCampaign:
    """Ensure an Ad Set belongs to an existing Campaign. Returns the Campaign."""
    if campaign_id is None:
        raise InvalidAdSetCampaignError(details={"field": "campaign_id"})
    try:
        campaign = MarketingCampaign.objects.select_related("platform", "platform__channel").get(
            pk=campaign_id
        )
    except MarketingCampaign.DoesNotExist as exc:
        raise InvalidAdSetCampaignError(
            details={"field": "campaign_id", "campaign_id": str(campaign_id), "reason": "not_found"}
        ) from exc
    if ad_set is not None and ad_set.campaign_id != campaign_id:
        raise InvalidAdSetCampaignError(
            details={
                "ad_set_id": str(ad_set.pk),
                "campaign_id": str(campaign_id),
                "actual_campaign_id": str(ad_set.campaign_id),
            }
        )
    return campaign


def validate_advertisement(
    *,
    campaign_id: UUID | None,
    ad_set_id: UUID | None = None,
) -> tuple[MarketingCampaign, MarketingAdSet | None]:
    """
    Ensure Advertisement hierarchy:
    - Campaign exists
    - Optional Ad Set exists and belongs to that Campaign
    """
    if campaign_id is None:
        raise InvalidAdvertisementHierarchyError(details={"field": "campaign_id"})
    try:
        campaign = MarketingCampaign.objects.select_related("platform").get(pk=campaign_id)
    except MarketingCampaign.DoesNotExist as exc:
        raise InvalidAdvertisementHierarchyError(
            details={"field": "campaign_id", "campaign_id": str(campaign_id), "reason": "not_found"}
        ) from exc

    ad_set = None
    if ad_set_id is not None:
        try:
            ad_set = MarketingAdSet.objects.get(pk=ad_set_id)
        except MarketingAdSet.DoesNotExist as exc:
            raise InvalidAdvertisementHierarchyError(
                details={"field": "ad_set_id", "ad_set_id": str(ad_set_id), "reason": "not_found"}
            ) from exc
        if ad_set.campaign_id != campaign_id:
            raise InvalidAdvertisementHierarchyError(
                details={
                    "field": "ad_set_id",
                    "ad_set_id": str(ad_set_id),
                    "campaign_id": str(campaign_id),
                    "ad_set_campaign_id": str(ad_set.campaign_id),
                }
            )
    return campaign, ad_set


def validate_spend_hierarchy(
    *,
    campaign_id: UUID | None,
    ad_set_id: UUID | None = None,
    advertisement_id: UUID | None = None,
) -> tuple[MarketingCampaign, MarketingAdSet | None, MarketingAdvertisement | None]:
    """Validate optional Ad Set / Advertisement attachments for CampaignSpend."""
    if campaign_id is None:
        raise InvalidAdvertisementHierarchyError(details={"field": "campaign_id"})
    try:
        campaign = MarketingCampaign.objects.get(pk=campaign_id)
    except MarketingCampaign.DoesNotExist as exc:
        raise InvalidAdvertisementHierarchyError(
            details={"field": "campaign_id", "campaign_id": str(campaign_id), "reason": "not_found"}
        ) from exc

    ad_set = None
    if ad_set_id is not None:
        try:
            ad_set = MarketingAdSet.objects.get(pk=ad_set_id)
        except MarketingAdSet.DoesNotExist as exc:
            raise InvalidAdvertisementHierarchyError(
                details={"field": "ad_set_id", "ad_set_id": str(ad_set_id), "reason": "not_found"}
            ) from exc
        if ad_set.campaign_id != campaign_id:
            raise InvalidAdSetCampaignError(
                details={
                    "ad_set_id": str(ad_set_id),
                    "campaign_id": str(campaign_id),
                    "actual_campaign_id": str(ad_set.campaign_id),
                }
            )

    advertisement = None
    if advertisement_id is not None:
        try:
            advertisement = MarketingAdvertisement.objects.get(pk=advertisement_id)
        except MarketingAdvertisement.DoesNotExist as exc:
            raise InvalidAdvertisementHierarchyError(
                details={
                    "field": "advertisement_id",
                    "advertisement_id": str(advertisement_id),
                    "reason": "not_found",
                }
            ) from exc
        if advertisement.campaign_id != campaign_id:
            raise InvalidAdvertisementHierarchyError(
                details={
                    "field": "advertisement_id",
                    "advertisement_id": str(advertisement_id),
                    "campaign_id": str(campaign_id),
                }
            )
        if (
            ad_set_id is not None
            and advertisement.ad_set_id
            and advertisement.ad_set_id != ad_set_id
        ):
            raise InvalidAdvertisementHierarchyError(
                details={
                    "field": "advertisement_id",
                    "advertisement_id": str(advertisement_id),
                    "ad_set_id": str(ad_set_id),
                    "advertisement_ad_set_id": str(advertisement.ad_set_id),
                }
            )
    return campaign, ad_set, advertisement
