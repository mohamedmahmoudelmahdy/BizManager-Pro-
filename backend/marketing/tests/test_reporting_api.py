"""API tests for Marketing reporting endpoints (Phase 3.3A)."""

from datetime import date, datetime, time
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from marketing.models import CampaignSpend, Lead, MarketingCampaign, MarketingChannel, MarketingPlatform
from marketing.services.lead_create import create_lead

User = get_user_model()

OVERVIEW = "/api/marketing/reports/overview/"
TRENDS = "/api/marketing/reports/lead-trends/"
CAMPAIGNS = "/api/marketing/reports/campaign-performance/"
FOLLOWUPS = "/api/marketing/reports/followup-workload/"
ASSIGNMENTS = "/api/marketing/reports/assignment-workload/"


def _grant(user, *codenames):
    for code in codenames:
        perm = Permission.objects.get(content_type__app_label="marketing", codename=code)
        user.user_permissions.add(perm)
    return User.objects.get(pk=user.pk)


class ReportingAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="rpt-api", password="pass", role=User.Roles.EMPLOYEE
        )
        self.user = _grant(
            self.user,
            "view_marketing_dashboard",
            "view_marketing_report",
            "view_lead",
            "add_lead",
        )
        self.dash_only = User.objects.create_user(
            username="dash-only", password="pass", role=User.Roles.EMPLOYEE
        )
        self.dash_only = _grant(self.dash_only, "view_marketing_dashboard", "view_lead")

        self.channel = MarketingChannel.objects.create(name="Ch", code="ch-api-rpt")
        self.platform = MarketingPlatform.objects.create(
            channel=self.channel, name="Pl", code="pl-api-rpt"
        )
        self.campaign = MarketingCampaign.objects.create(
            platform=self.platform, name="Cp", code="cp-api-rpt"
        )
        lead = create_lead(
            actor=self.user,
            name="R",
            raw_phone="0503333001",
            channel_id=self.channel.id,
            platform_id=self.platform.id,
            campaign_id=self.campaign.id,
        )
        Lead.objects.filter(pk=lead.pk).update(
            created_at=timezone.make_aware(datetime.combine(date(2026, 1, 10), time(12)))
        )
        CampaignSpend.objects.create(
            campaign=self.campaign,
            spend_date=date(2026, 1, 10),
            amount=Decimal("10.00"),
            created_by=self.user,
        )
        self.params = {"date_from": "2026-01-01", "date_to": "2026-01-31"}

    def _auth(self, user=None):
        self.client.force_authenticate(user or self.user)

    def test_auth_required(self):
        self.assertEqual(self.client.get(OVERVIEW).status_code, 401)

    def test_permission_denied(self):
        bare = User.objects.create_user(username="x", password="pass", role=User.Roles.EMPLOYEE)
        self.client.force_authenticate(bare)
        self.assertEqual(self.client.get(OVERVIEW).status_code, 403)

    def test_dashboard_only_can_overview_not_trends(self):
        self._auth(self.dash_only)
        self.assertEqual(self.client.get(OVERVIEW, self.params).status_code, 200)
        self.assertEqual(self.client.get(TRENDS, self.params).status_code, 403)

    def test_overview_schema(self):
        self._auth()
        res = self.client.get(OVERVIEW, self.params)
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()
        self.assertIn("leads", data)
        self.assertIn("spend", data)
        self.assertIn("breakdowns", data)
        self.assertEqual(data["filters"]["date_from"], "2026-01-01")
        self.assertEqual(data["leads"]["total"], 1)
        self.assertEqual(data["spend"]["total"], "10.00")

    def test_default_filters(self):
        self._auth()
        res = self.client.get(OVERVIEW)
        self.assertEqual(res.status_code, 200)
        today = timezone.localdate()
        self.assertEqual(res.json()["filters"]["date_from"], today.replace(day=1).isoformat())
        self.assertEqual(res.json()["filters"]["date_to"], today.isoformat())

    def test_invalid_dates(self):
        self._auth()
        res = self.client.get(OVERVIEW, {"date_from": "2026-02-01", "date_to": "2026-01-01"})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["error"]["code"], "invalid_report_date_range")

    def test_invalid_hierarchy(self):
        self._auth()
        other = MarketingChannel.objects.create(name="Other", code="other-api-rpt")
        res = self.client.get(
            OVERVIEW,
            {
                **self.params,
                "channel_id": str(other.id),
                "platform_id": str(self.platform.id),
            },
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["error"]["code"], "invalid_report_hierarchy")

    def test_invalid_interval(self):
        self._auth()
        res = self.client.get(TRENDS, {**self.params, "interval": "hour"})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["error"]["code"], "invalid_reporting_interval")

    def test_excessive_range(self):
        self._auth()
        res = self.client.get(
            TRENDS,
            {"date_from": "2015-01-01", "date_to": "2020-01-01", "interval": "day"},
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["error"]["code"], "report_date_range_too_large")

    def test_lead_trends_and_campaign_performance(self):
        self._auth()
        trends = self.client.get(TRENDS, {**self.params, "interval": "day"})
        self.assertEqual(trends.status_code, 200)
        self.assertEqual(len(trends.json()["series"]), 31)

        camps = self.client.get(CAMPAIGNS, self.params)
        self.assertEqual(camps.status_code, 200)
        body = camps.json()
        self.assertIn("results", body)
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["spend"], "10.00")

    def test_followup_and_assignment_endpoints(self):
        self._auth()
        self.assertEqual(self.client.get(FOLLOWUPS, self.params).status_code, 200)
        self.assertEqual(self.client.get(ASSIGNMENTS, self.params).status_code, 200)

    def test_mutations_not_allowed(self):
        self._auth()
        for method in ("post", "patch", "put", "delete"):
            for url in (OVERVIEW, TRENDS, CAMPAIGNS, FOLLOWUPS, ASSIGNMENTS):
                res = getattr(self.client, method)(url, {}, format="json")
                self.assertEqual(res.status_code, 405, f"{method} {url}")

    def test_unknown_report_route_404(self):
        self._auth()
        self.assertEqual(self.client.get("/api/marketing/reports/unknown/").status_code, 404)
