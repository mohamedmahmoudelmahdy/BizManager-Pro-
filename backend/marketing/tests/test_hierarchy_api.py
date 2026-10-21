"""API tests for campaign hierarchy and CampaignSpend endpoints."""

from datetime import date
from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase
from rest_framework.test import APIClient

from marketing.models import MarketingChannel
from marketing.services.channels import create_channel
from marketing.services.platforms import create_platform
from marketing.services.campaigns import create_campaign

User = get_user_model()


def _grant(user, *codenames):
    for code in codenames:
        perm = Permission.objects.get(content_type__app_label="marketing", codename=code)
        user.user_permissions.add(perm)
    return User.objects.get(pk=user.pk)


ALL_HIERARCHY_PERMS = (
    "view_marketingchannel",
    "add_marketingchannel",
    "change_marketingchannel",
    "view_marketingplatform",
    "add_marketingplatform",
    "change_marketingplatform",
    "view_marketingcampaign",
    "add_marketingcampaign",
    "change_marketingcampaign",
    "view_marketingadset",
    "add_marketingadset",
    "change_marketingadset",
    "view_marketingadvertisement",
    "add_marketingadvertisement",
    "change_marketingadvertisement",
    "view_campaignspend",
    "add_campaignspend",
    "change_campaignspend",
)


class HierarchyAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="hier-api", password="pass", role=User.Roles.EMPLOYEE
        )
        self.user = _grant(self.user, *ALL_HIERARCHY_PERMS)

    def _auth(self):
        self.client.force_authenticate(self.user)

    def test_auth_required(self):
        self.assertEqual(self.client.get("/api/marketing/channels/").status_code, 401)

    def test_channel_crud_archive_put_delete(self):
        self._auth()
        created = self.client.post(
            "/api/marketing/channels/",
            {"name": "Online", "code": "online-api", "description": "web"},
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        channel_id = created.json()["id"]

        listed = self.client.get("/api/marketing/channels/")
        self.assertEqual(listed.status_code, 200)
        self.assertIn("results", listed.json())
        self.assertEqual(listed.json()["count"], 1)

        patched = self.client.patch(
            f"/api/marketing/channels/{channel_id}/",
            {"name": "Online Media"},
            format="json",
        )
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.json()["name"], "Online Media")

        put = self.client.put(
            f"/api/marketing/channels/{channel_id}/",
            {"name": "X", "code": "online-api"},
            format="json",
        )
        self.assertEqual(put.status_code, 405)

        delete = self.client.delete(f"/api/marketing/channels/{channel_id}/")
        self.assertEqual(delete.status_code, 405)

        # immutable code
        bad = self.client.patch(
            f"/api/marketing/channels/{channel_id}/",
            {"code": "changed"},
            format="json",
        )
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.json()["error"]["code"], "immutable_field")

        archived = self.client.post(
            f"/api/marketing/channels/{channel_id}/archive/", {}, format="json"
        )
        self.assertEqual(archived.status_code, 200)
        self.assertFalse(archived.json()["is_active"])

        # excluded from default list
        listed2 = self.client.get("/api/marketing/channels/")
        self.assertEqual(listed2.json()["count"], 0)
        inactive = self.client.get("/api/marketing/channels/?inactive=true")
        self.assertEqual(inactive.json()["count"], 1)

        again = self.client.post(
            f"/api/marketing/channels/{channel_id}/archive/", {}, format="json"
        )
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()["error"]["code"], "entity_already_archived")

    def test_duplicate_channel_error(self):
        self._auth()
        self.client.post(
            "/api/marketing/channels/",
            {"name": "A", "code": "dup-code"},
            format="json",
        )
        response = self.client.post(
            "/api/marketing/channels/",
            {"name": "B", "code": "dup-code"},
            format="json",
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "duplicate_channel")

    def test_platform_campaign_adset_ad_spend_flow(self):
        self._auth()
        channel = self.client.post(
            "/api/marketing/channels/",
            {"name": "Online", "code": "online-flow"},
            format="json",
        ).json()
        platform = self.client.post(
            "/api/marketing/platforms/",
            {
                "channel_id": channel["id"],
                "name": "Meta",
                "code": "meta-flow",
            },
            format="json",
        )
        self.assertEqual(platform.status_code, 201, platform.content)
        platform_id = platform.json()["id"]

        # invalid hierarchy
        bad_plat = self.client.post(
            "/api/marketing/platforms/",
            {"channel_id": str(uuid4()), "name": "X", "code": "x-flow"},
            format="json",
        )
        self.assertEqual(bad_plat.status_code, 400)
        self.assertEqual(bad_plat.json()["error"]["code"], "invalid_platform_channel")

        campaign = self.client.post(
            "/api/marketing/campaigns/",
            {
                "platform_id": platform_id,
                "name": "Launch",
                "code": "launch-flow",
                "budget": "1000.00",
                "start_date": "2026-01-01",
                "end_date": "2026-12-31",
            },
            format="json",
        )
        self.assertEqual(campaign.status_code, 201, campaign.content)
        campaign_id = campaign.json()["id"]
        self.assertEqual(campaign.json()["platform"]["code"], "meta-flow")
        self.assertEqual(campaign.json()["channel"]["code"], "online-flow")

        bad_dates = self.client.post(
            "/api/marketing/campaigns/",
            {
                "platform_id": platform_id,
                "name": "Bad",
                "code": "bad-flow",
                "start_date": "2026-12-31",
                "end_date": "2026-01-01",
            },
            format="json",
        )
        self.assertEqual(bad_dates.status_code, 400)
        self.assertEqual(bad_dates.json()["error"]["code"], "campaign_dates_invalid")

        adset = self.client.post(
            "/api/marketing/adsets/",
            {"campaign_id": campaign_id, "name": "Lookalike"},
            format="json",
        )
        self.assertEqual(adset.status_code, 201, adset.content)
        adset_id = adset.json()["id"]

        ad = self.client.post(
            "/api/marketing/advertisements/",
            {
                "campaign_id": campaign_id,
                "ad_set_id": adset_id,
                "name": "Creative A",
            },
            format="json",
        )
        self.assertEqual(ad.status_code, 201, ad.content)

        # wrong ad set / campaign
        other_campaign = self.client.post(
            "/api/marketing/campaigns/",
            {"platform_id": platform_id, "name": "Other", "code": "other-flow"},
            format="json",
        ).json()
        bad_ad = self.client.post(
            "/api/marketing/advertisements/",
            {
                "campaign_id": other_campaign["id"],
                "ad_set_id": adset_id,
                "name": "Mismatch",
            },
            format="json",
        )
        self.assertEqual(bad_ad.status_code, 400)
        self.assertEqual(bad_ad.json()["error"]["code"], "invalid_advertisement_hierarchy")

        expense_id = str(uuid4())
        spend = self.client.post(
            "/api/marketing/campaign-spend/",
            {
                "campaign_id": campaign_id,
                "spend_date": "2026-06-01",
                "amount": "250.50",
                "ad_set_id": adset_id,
                "expense_id": expense_id,
                "description": "June ads",
            },
            format="json",
        )
        self.assertEqual(spend.status_code, 201, spend.content)
        self.assertEqual(spend.json()["expense_id"], expense_id)
        self.assertEqual(spend.json()["integration_status"], "pending")
        spend_id = spend.json()["id"]

        patched_spend = self.client.patch(
            f"/api/marketing/campaign-spend/{spend_id}/",
            {"amount": "300.00"},
            format="json",
        )
        self.assertEqual(patched_spend.status_code, 200)
        self.assertEqual(Decimal(patched_spend.json()["amount"]), Decimal("300.00"))

        # no spend archive route
        no_archive = self.client.post(
            f"/api/marketing/campaign-spend/{spend_id}/archive/", {}, format="json"
        )
        self.assertEqual(no_archive.status_code, 404)

        # filters / search
        filtered = self.client.get(f"/api/marketing/campaigns/?platform={platform_id}")
        self.assertGreaterEqual(filtered.json()["count"], 1)
        searched = self.client.get("/api/marketing/campaigns/?search=Launch")
        self.assertEqual(searched.json()["count"], 1)

        # archive with children blocked
        blocked = self.client.post(
            f"/api/marketing/campaigns/{campaign_id}/archive/", {}, format="json"
        )
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.json()["error"]["code"], "campaign_has_children")

    def test_permission_denied(self):
        bare = User.objects.create_user(username="bare-h", password="pass", role=User.Roles.EMPLOYEE)
        self.client.force_authenticate(bare)
        response = self.client.get("/api/marketing/channels/")
        self.assertEqual(response.status_code, 403)

    def test_manager_bypass(self):
        manager = User.objects.create_user(
            username="mgr-h", password="pass", role=User.Roles.MANAGER
        )
        self.client.force_authenticate(manager)
        response = self.client.post(
            "/api/marketing/channels/",
            {"name": "Mgr Channel", "code": "mgr-ch"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_channel_archive_blocked_by_platform(self):
        self._auth()
        channel = create_channel(actor=self.user, name="Ch", code="ch-block")
        create_platform(
            actor=self.user, channel_id=channel.pk, name="P", code="p-block"
        )
        response = self.client.post(
            f"/api/marketing/channels/{channel.pk}/archive/", {}, format="json"
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "entity_has_children")
