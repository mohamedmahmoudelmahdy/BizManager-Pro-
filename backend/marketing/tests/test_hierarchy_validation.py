"""Tests for campaign hierarchy validation helpers."""

from django.test import TestCase

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
from marketing.services.campaign_validation import (
    validate_advertisement,
    validate_adset_campaign,
    validate_campaign_platform,
    validate_platform_channel,
    validate_spend_hierarchy,
)


class CampaignValidationTests(TestCase):
    def setUp(self):
        self.channel = MarketingChannel.objects.create(name="Online", code="online-v")
        self.other = MarketingChannel.objects.create(name="Offline", code="offline-v")
        self.platform = MarketingPlatform.objects.create(
            channel=self.channel, name="Meta", code="meta-v"
        )
        self.campaign = MarketingCampaign.objects.create(
            platform=self.platform, name="Spring", code="spring-v"
        )
        self.ad_set = MarketingAdSet.objects.create(campaign=self.campaign, name="Set A")
        self.other_campaign = MarketingCampaign.objects.create(
            platform=self.platform, name="Other", code="other-v"
        )
        self.other_ad_set = MarketingAdSet.objects.create(
            campaign=self.other_campaign, name="Set B"
        )

    def test_platform_channel_ok(self):
        validate_platform_channel(channel_id=self.channel.pk)

    def test_platform_channel_missing(self):
        with self.assertRaises(InvalidPlatformChannelError):
            validate_platform_channel(channel_id=None)

    def test_campaign_platform_ok(self):
        p = validate_campaign_platform(platform_id=self.platform.pk)
        self.assertEqual(p.pk, self.platform.pk)

    def test_campaign_platform_missing(self):
        with self.assertRaises(InvalidCampaignPlatformError):
            validate_campaign_platform(platform_id=self.channel.pk)

    def test_adset_campaign_ok(self):
        c = validate_adset_campaign(campaign_id=self.campaign.pk)
        self.assertEqual(c.pk, self.campaign.pk)

    def test_advertisement_adset_must_match_campaign(self):
        with self.assertRaises(InvalidAdvertisementHierarchyError):
            validate_advertisement(
                campaign_id=self.campaign.pk, ad_set_id=self.other_ad_set.pk
            )

    def test_advertisement_optional_adset(self):
        campaign, ad_set = validate_advertisement(campaign_id=self.campaign.pk, ad_set_id=None)
        self.assertEqual(campaign.pk, self.campaign.pk)
        self.assertIsNone(ad_set)

    def test_spend_hierarchy_mismatch(self):
        with self.assertRaises(InvalidAdSetCampaignError):
            validate_spend_hierarchy(
                campaign_id=self.campaign.pk, ad_set_id=self.other_ad_set.pk
            )
