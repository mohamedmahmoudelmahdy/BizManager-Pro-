"""Service tests for campaign hierarchy CRUD and inactivation."""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase

from marketing.exceptions import (
    CampaignBudgetInvalidError,
    CampaignDatesInvalidError,
    CampaignHasChildrenError,
    DuplicateChannelError,
    EntityAlreadyArchivedError,
    EntityHasChildrenError,
    ImmutableFieldError,
    InvalidAdvertisementHierarchyError,
    InvalidCampaignPlatformError,
    InvalidPlatformChannelError,
    MarketingPermissionDeniedError,
)
from marketing.models import CampaignSpend, MarketingChannel
from marketing.services.adsets import archive_adset, create_adset
from marketing.services.advertisements import (
    archive_advertisement,
    create_advertisement,
)
from marketing.services.campaign_spend import create_campaign_spend, update_campaign_spend
from marketing.services.campaigns import archive_campaign, create_campaign, update_campaign
from marketing.services.channels import archive_channel, create_channel, update_channel
from marketing.services.platforms import archive_platform, create_platform

User = get_user_model()


def _grant(user, *codenames):
    for code in codenames:
        perm = Permission.objects.get(content_type__app_label="marketing", codename=code)
        user.user_permissions.add(perm)
    return User.objects.get(pk=user.pk)


class HierarchyServiceFixtures(TestCase):
    def setUp(self):
        self.actor = User.objects.create_user(
            username="hier-actor", password="pass", role=User.Roles.EMPLOYEE
        )
        self.actor = _grant(
            self.actor,
            "add_marketingchannel",
            "change_marketingchannel",
            "view_marketingchannel",
            "add_marketingplatform",
            "change_marketingplatform",
            "view_marketingplatform",
            "add_marketingcampaign",
            "change_marketingcampaign",
            "view_marketingcampaign",
            "add_marketingadset",
            "change_marketingadset",
            "view_marketingadset",
            "add_marketingadvertisement",
            "change_marketingadvertisement",
            "view_marketingadvertisement",
            "add_campaignspend",
            "change_campaignspend",
            "view_campaignspend",
        )


class ChannelServiceTests(HierarchyServiceFixtures):
    def test_create_update_duplicate_archive(self):
        ch = create_channel(actor=self.actor, name="Online", code="online-s")
        self.assertTrue(ch.is_active)
        updated = update_channel(channel=ch, actor=self.actor, updates={"name": "Online Ads"})
        self.assertEqual(updated.name, "Online Ads")

        with self.assertRaises(ImmutableFieldError):
            update_channel(channel=ch, actor=self.actor, updates={"code": "x"})

        with self.assertRaises(DuplicateChannelError):
            create_channel(actor=self.actor, name="Other", code="online-s")

        archived = archive_channel(channel=ch, actor=self.actor)
        self.assertFalse(archived.is_active)
        with self.assertRaises(EntityAlreadyArchivedError):
            archive_channel(channel=ch, actor=self.actor)

    def test_cannot_archive_with_active_platforms(self):
        ch = create_channel(actor=self.actor, name="Ch", code="ch-child")
        create_platform(actor=self.actor, channel_id=ch.pk, name="P", code="p-child")
        with self.assertRaises(EntityHasChildrenError):
            archive_channel(channel=ch, actor=self.actor)

    def test_permission_denied(self):
        bare = User.objects.create_user(username="nop", password="pass", role=User.Roles.EMPLOYEE)
        with self.assertRaises(MarketingPermissionDeniedError):
            create_channel(actor=bare, name="X", code="x")


class PlatformCampaignServiceTests(HierarchyServiceFixtures):
    def setUp(self):
        super().setUp()
        self.channel = create_channel(actor=self.actor, name="Online", code="online-pc")

    def test_platform_requires_valid_channel(self):
        import uuid

        with self.assertRaises(InvalidPlatformChannelError):
            create_platform(
                actor=self.actor,
                channel_id=uuid.uuid4(),
                name="Ghost",
                code="ghost-p",
            )

    def test_campaign_dates_and_budget(self):
        platform = create_platform(
            actor=self.actor, channel_id=self.channel.pk, name="Meta", code="meta-pc"
        )
        with self.assertRaises(CampaignDatesInvalidError):
            create_campaign(
                actor=self.actor,
                platform_id=platform.pk,
                name="Bad Dates",
                code="bad-dates",
                start_date=date.today(),
                end_date=date.today() - timedelta(days=1),
            )
        with self.assertRaises(CampaignBudgetInvalidError):
            create_campaign(
                actor=self.actor,
                platform_id=platform.pk,
                name="Bad Budget",
                code="bad-budget",
                budget=Decimal("-1"),
            )

        campaign = create_campaign(
            actor=self.actor,
            platform_id=platform.pk,
            name="Good",
            code="good-c",
            budget=Decimal("100.00"),
        )
        self.assertEqual(campaign.created_by_id, self.actor.pk)

        with self.assertRaises(InvalidCampaignPlatformError):
            import uuid

            update_campaign(
                campaign=campaign,
                actor=self.actor,
                updates={"platform_id": uuid.uuid4()},
            )

    def test_campaign_archive_blocked_by_children(self):
        platform = create_platform(
            actor=self.actor, channel_id=self.channel.pk, name="Meta", code="meta-arch"
        )
        campaign = create_campaign(
            actor=self.actor, platform_id=platform.pk, name="C", code="c-arch"
        )
        create_adset(actor=self.actor, campaign_id=campaign.pk, name="Set")
        with self.assertRaises(CampaignHasChildrenError):
            archive_campaign(campaign=campaign, actor=self.actor)


class AdSetAdvertisementServiceTests(HierarchyServiceFixtures):
    def setUp(self):
        super().setUp()
        self.channel = create_channel(actor=self.actor, name="Online", code="online-ad")
        self.platform = create_platform(
            actor=self.actor, channel_id=self.channel.pk, name="Meta", code="meta-ad"
        )
        self.campaign = create_campaign(
            actor=self.actor, platform_id=self.platform.pk, name="C", code="c-ad"
        )
        self.other = create_campaign(
            actor=self.actor, platform_id=self.platform.pk, name="Other", code="c-ad-2"
        )

    def test_advertisement_hierarchy(self):
        ad_set = create_adset(actor=self.actor, campaign_id=self.campaign.pk, name="Set")
        ad = create_advertisement(
            actor=self.actor,
            campaign_id=self.campaign.pk,
            ad_set_id=ad_set.pk,
            name="Ad 1",
        )
        self.assertEqual(ad.ad_set_id, ad_set.pk)

        with self.assertRaises(InvalidAdvertisementHierarchyError):
            create_advertisement(
                actor=self.actor,
                campaign_id=self.other.pk,
                ad_set_id=ad_set.pk,
                name="Bad Ad",
            )

        # optional ad set
        bare = create_advertisement(
            actor=self.actor, campaign_id=self.campaign.pk, name="Bare Ad"
        )
        self.assertIsNone(bare.ad_set_id)

        with self.assertRaises(EntityHasChildrenError):
            archive_adset(ad_set=ad_set, actor=self.actor)

        archive_advertisement(advertisement=ad, actor=self.actor)
        archived_set = archive_adset(ad_set=ad_set, actor=self.actor)
        self.assertFalse(archived_set.is_active)


class CampaignSpendServiceTests(HierarchyServiceFixtures):
    def setUp(self):
        super().setUp()
        self.channel = create_channel(actor=self.actor, name="Online", code="online-sp")
        self.platform = create_platform(
            actor=self.actor, channel_id=self.channel.pk, name="Meta", code="meta-sp"
        )
        self.campaign = create_campaign(
            actor=self.actor, platform_id=self.platform.pk, name="C", code="c-sp"
        )

    def test_create_update_expense_id_no_lookup(self):
        import uuid

        expense_uuid = uuid.uuid4()
        spend = create_campaign_spend(
            actor=self.actor,
            campaign_id=self.campaign.pk,
            spend_date=date.today(),
            amount=Decimal("50.00"),
            expense_id=expense_uuid,
        )
        self.assertEqual(spend.expense_id, expense_uuid)
        self.assertEqual(spend.integration_status, CampaignSpend.IntegrationStatus.PENDING)
        self.assertEqual(CampaignSpend.objects.count(), 1)

        # Opaque UUID is preserved; no Expense row required or created.
        self.assertFalse(
            __import__("expenses.models", fromlist=["Expense"]).Expense.objects.filter(
                pk=expense_uuid
            ).exists()
        )

        updated = update_campaign_spend(
            spend=spend, actor=self.actor, updates={"amount": Decimal("75.00")}
        )
        self.assertEqual(updated.amount, Decimal("75.00"))

        with self.assertRaises(ImmutableFieldError):
            update_campaign_spend(
                spend=spend,
                actor=self.actor,
                updates={"integration_status": "integrated"},
            )

    def test_amount_must_be_positive(self):
        with self.assertRaises(CampaignBudgetInvalidError):
            create_campaign_spend(
                actor=self.actor,
                campaign_id=self.campaign.pk,
                spend_date=date.today(),
                amount=Decimal("0"),
            )
