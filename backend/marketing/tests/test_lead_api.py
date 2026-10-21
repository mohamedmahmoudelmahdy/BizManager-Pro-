"""API tests for Marketing CRM Lead endpoints."""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase
from rest_framework.test import APIClient

from customers.models import Customer
from marketing.models import Lead, MarketingCampaign, MarketingChannel, MarketingPlatform
from marketing.services.lead_create import create_lead

User = get_user_model()


def _grant(user, *codenames):
    for code in codenames:
        perm = Permission.objects.get(content_type__app_label="marketing", codename=code)
        user.user_permissions.add(perm)
    return User.objects.get(pk=user.pk)


class LeadAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="api-mkt",
            password="pass",
            role=User.Roles.EMPLOYEE,
            first_name="Api",
            last_name="User",
        )
        self.user = _grant(self.user, "view_lead", "add_lead", "change_lead")
        self.channel = MarketingChannel.objects.create(name="Online", code="online-api")
        self.platform = MarketingPlatform.objects.create(
            channel=self.channel, name="Meta", code="meta-api"
        )
        self.campaign = MarketingCampaign.objects.create(
            platform=self.platform,
            name="Launch",
            code="launch-api",
            created_by=self.user,
        )

    def _auth(self):
        self.client.force_authenticate(self.user)

    def test_authentication_required(self):
        response = self.client.get("/api/marketing/leads/")
        self.assertEqual(response.status_code, 401)

    def test_permission_denied_without_view(self):
        bare = User.objects.create_user(username="bare", password="pass", role=User.Roles.EMPLOYEE)
        self.client.force_authenticate(bare)
        response = self.client.get("/api/marketing/leads/")
        self.assertEqual(response.status_code, 403)

    def test_create_and_retrieve(self):
        self._auth()
        response = self.client.post(
            "/api/marketing/leads/",
            {
                "name": "API Lead",
                "raw_phone": "+971-50-400-5000",
                "email": "lead@example.com",
                "campaign_id": str(self.campaign.pk),
                "platform_id": str(self.platform.pk),
                "channel_id": str(self.channel.pk),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertEqual(data["lead_number"], "L-000001")
        self.assertEqual(data["normalized_phone"], "971504005000")
        self.assertEqual(data["raw_phone"], "+971-50-400-5000")
        self.assertEqual(data["campaign"]["code"], "launch-api")
        self.assertIsNone(data["converted_at"])

        detail = self.client.get(f"/api/marketing/leads/{data['id']}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["name"], "API Lead")

    def test_duplicate_lead_phone_error_contract(self):
        self._auth()
        self.client.post(
            "/api/marketing/leads/",
            {"name": "One", "raw_phone": "0504111222"},
            format="json",
        )
        response = self.client.post(
            "/api/marketing/leads/",
            {"name": "Two", "raw_phone": "050-411-1222"},
            format="json",
        )
        self.assertEqual(response.status_code, 409)
        body = response.json()
        self.assertEqual(body["error"]["code"], "duplicate_lead_phone")
        self.assertEqual(body["error"]["message"], "duplicate_lead_phone")
        self.assertIn("lead", body["error"]["details"])
        self.assertIn("lead_number", body["error"]["details"]["lead"])

    def test_matching_customer_found_error_contract(self):
        self._auth()
        Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Existing",
            phone="0504333444",
            balance=Decimal("0"),
        )
        response = self.client.post(
            "/api/marketing/leads/",
            {"name": "Lead", "raw_phone": "0504333444"},
            format="json",
        )
        self.assertEqual(response.status_code, 409)
        body = response.json()
        self.assertEqual(body["error"]["code"], "matching_customer_found")
        self.assertTrue(body["error"]["details"]["matches"])

    def test_explicit_customer_link_succeeds(self):
        self._auth()
        customer = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Existing",
            phone="0504555666",
            balance=Decimal("0"),
        )
        response = self.client.post(
            "/api/marketing/leads/",
            {
                "name": "Lead",
                "raw_phone": "0504555666",
                "selected_customer_id": str(customer.pk),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["linked_customer"]["id"], str(customer.pk))
        self.assertIsNone(response.json()["converted_at"])

    def test_invalid_customer_link_error_contract(self):
        self._auth()
        Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Existing",
            phone="0504777888",
            balance=Decimal("0"),
        )
        other = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Other",
            phone="0401111111",
            balance=Decimal("0"),
        )
        response = self.client.post(
            "/api/marketing/leads/",
            {
                "name": "Lead",
                "raw_phone": "0504777888",
                "selected_customer_id": str(other.pk),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_customer_link")

    def test_invalid_phone_error_contract(self):
        self._auth()
        response = self.client.post(
            "/api/marketing/leads/",
            {"name": "Lead", "raw_phone": "abc"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_phone")

    def test_invalid_campaign_hierarchy_error_contract(self):
        self._auth()
        other_channel = MarketingChannel.objects.create(name="Other", code="other-api")
        response = self.client.post(
            "/api/marketing/leads/",
            {
                "name": "Lead",
                "raw_phone": "0504888999",
                "channel_id": str(other_channel.pk),
                "platform_id": str(self.platform.pk),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_campaign_hierarchy")

    def test_patch_update_and_immutable_field(self):
        self._auth()
        lead = create_lead(actor=self.user, name="Patch", raw_phone="0505006001")
        ok = self.client.patch(
            f"/api/marketing/leads/{lead.pk}/",
            {"name": "Patched", "outcome": "interested"},
            format="json",
        )
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.json()["name"], "Patched")

        bad = self.client.patch(
            f"/api/marketing/leads/{lead.pk}/",
            {"lead_number": "L-999999"},
            format="json",
        )
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.json()["error"]["code"], "immutable_field")

    def test_archive_flow_and_contracts(self):
        self._auth()
        lead = create_lead(actor=self.user, name="Arch", raw_phone="0505007001")

        missing = self.client.post(
            f"/api/marketing/leads/{lead.pk}/archive/",
            {"reason": "  "},
            format="json",
        )
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json()["error"]["code"], "archive_reason_required")

        ok = self.client.post(
            f"/api/marketing/leads/{lead.pk}/archive/",
            {"reason": "spam"},
            format="json",
        )
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.json()["status"], "archived")
        self.assertEqual(ok.json()["archive_reason"], "spam")

        again = self.client.post(
            f"/api/marketing/leads/{lead.pk}/archive/",
            {"reason": "again"},
            format="json",
        )
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()["error"]["code"], "lead_already_archived")

        # Soft archive: record remains
        self.assertTrue(Lead.objects.filter(pk=lead.pk).exists())

    def test_no_delete_endpoint(self):
        self._auth()
        lead = create_lead(actor=self.user, name="NoDel", raw_phone="0505008001")
        response = self.client.delete(f"/api/marketing/leads/{lead.pk}/")
        self.assertEqual(response.status_code, 405)
        self.assertTrue(Lead.objects.filter(pk=lead.pk).exists())

    def test_put_disabled_patch_only(self):
        """Update serializer is partial; PUT is not exposed as full-replace."""
        self._auth()
        lead = create_lead(actor=self.user, name="PutCheck", raw_phone="0505008002")
        response = self.client.put(
            f"/api/marketing/leads/{lead.pk}/",
            {"name": "Full Replace Attempt", "raw_phone": "0505008002"},
            format="json",
        )
        self.assertEqual(response.status_code, 405)
        lead.refresh_from_db()
        self.assertEqual(lead.name, "PutCheck")

    def test_list_excludes_archived_by_default_and_pagination(self):
        self._auth()
        for i in range(3):
            create_lead(actor=self.user, name=f"L{i}", raw_phone=f"050600100{i}")
        archived = create_lead(actor=self.user, name="Archived", raw_phone="0506001999")
        self.client.post(
            f"/api/marketing/leads/{archived.pk}/archive/",
            {"reason": "done"},
            format="json",
        )

        response = self.client.get("/api/marketing/leads/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        # Default PageNumberPagination
        self.assertIn("results", data)
        self.assertIn("count", data)
        names = [row["name"] for row in data["results"]]
        self.assertNotIn("Archived", names)
        self.assertEqual(data["count"], 3)

        archived_list = self.client.get("/api/marketing/leads/?archived=true")
        self.assertEqual(archived_list.status_code, 200)
        self.assertEqual(archived_list.json()["count"], 1)

    def test_list_search_filter_ordering(self):
        self._auth()
        create_lead(
            actor=self.user,
            name="Alpha Search",
            raw_phone="0507001001",
            campaign_id=self.campaign.pk,
            platform_id=self.platform.pk,
            channel_id=self.channel.pk,
        )
        create_lead(actor=self.user, name="Beta Other", raw_phone="0507001002")

        search = self.client.get("/api/marketing/leads/?search=Alpha")
        self.assertEqual(search.json()["count"], 1)

        by_campaign = self.client.get(f"/api/marketing/leads/?campaign={self.campaign.pk}")
        self.assertEqual(by_campaign.json()["count"], 1)

        ordered = self.client.get("/api/marketing/leads/?ordering=lead_number")
        numbers = [r["lead_number"] for r in ordered.json()["results"]]
        self.assertEqual(numbers, sorted(numbers))

    def test_admin_manager_bypass(self):
        manager = User.objects.create_user(
            username="mgr", password="pass", role=User.Roles.MANAGER
        )
        self.client.force_authenticate(manager)
        response = self.client.post(
            "/api/marketing/leads/",
            {"name": "Mgr Lead", "raw_phone": "0508009001"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
