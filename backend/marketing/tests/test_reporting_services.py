"""Service tests for Marketing reporting (Phase 3.3A)."""

from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from customers.models import Customer
from marketing.exceptions import (
    InvalidReportDateRangeError,
    InvalidReportingIntervalError,
    ReportDateRangeTooLargeError,
    ReportPermissionDeniedError,
)
from marketing.models import (
    CampaignSpend,
    Lead,
    LeadAssignment,
    LeadFollowUp,
    MarketingCampaign,
    MarketingChannel,
    MarketingPlatform,
)
from marketing.permissions import GROUP_OPERATIONS_CRM_USER
from marketing.services.lead_create import create_lead
from marketing.services.reporting import (
    build_assignment_workload_report,
    build_campaign_performance_report,
    build_followup_workload_report,
    build_lead_trends_report,
    build_overview_report,
)
from marketing.services.reporting.calculations import safe_ratio
from marketing.services.reporting.filters import parse_report_filters

User = get_user_model()


def _grant(user, *codenames):
    for code in codenames:
        perm = Permission.objects.get(content_type__app_label="marketing", codename=code)
        user.user_permissions.add(perm)
    return User.objects.get(pk=user.pk)


def _aware(d: date, hour=12):
    return timezone.make_aware(datetime.combine(d, time(hour=hour)))


class ReportingServiceTests(TestCase):
    def setUp(self):
        self.manager = User.objects.create_user(
            username="rpt-mgr", password="pass", role=User.Roles.MANAGER
        )
        self.employee = User.objects.create_user(
            username="rpt-emp", password="pass", role=User.Roles.EMPLOYEE
        )
        self.employee = _grant(
            self.employee,
            "view_marketing_dashboard",
            "view_marketing_report",
            "view_lead",
            "add_lead",
            "view_campaignspend",
        )
        self.ops = User.objects.create_user(
            username="rpt-ops", password="pass", role=User.Roles.EMPLOYEE
        )
        ops_group, _ = Group.objects.get_or_create(name=GROUP_OPERATIONS_CRM_USER)
        self.ops.groups.add(ops_group)
        self.ops = _grant(self.ops, "view_lead", "view_marketing_report")

        self.channel_a = MarketingChannel.objects.create(name="Social", code="social-rpt")
        self.channel_b = MarketingChannel.objects.create(name="Search", code="search-rpt")
        self.platform_a = MarketingPlatform.objects.create(
            channel=self.channel_a, name="Meta", code="meta-rpt"
        )
        self.platform_b = MarketingPlatform.objects.create(
            channel=self.channel_b, name="Google", code="google-rpt"
        )
        self.camp_a = MarketingCampaign.objects.create(
            platform=self.platform_a, name="Camp A", code="camp-a-rpt"
        )
        self.camp_b = MarketingCampaign.objects.create(
            platform=self.platform_b, name="Camp B", code="camp-b-rpt"
        )
        self.camp_empty = MarketingCampaign.objects.create(
            platform=self.platform_a, name="Empty", code="camp-empty-rpt"
        )
        self.camp_spend_only = MarketingCampaign.objects.create(
            platform=self.platform_a, name="Spend Only", code="camp-spend-rpt"
        )

        self.range_from = date(2026, 1, 1)
        self.range_to = date(2026, 1, 31)
        self.params = {
            "date_from": "2026-01-01",
            "date_to": "2026-01-31",
            "include_archived": "false",
        }

        # Leads created inside range
        self.lead_new = create_lead(
            actor=self.employee,
            name="New",
            raw_phone="0501111001",
            channel_id=self.channel_a.id,
            platform_id=self.platform_a.id,
            campaign_id=self.camp_a.id,
        )
        Lead.objects.filter(pk=self.lead_new.pk).update(created_at=_aware(date(2026, 1, 10)))

        self.lead_converted = create_lead(
            actor=self.employee,
            name="Converted",
            raw_phone="0501111002",
            channel_id=self.channel_a.id,
            platform_id=self.platform_a.id,
            campaign_id=self.camp_a.id,
        )
        customer = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL, name="Cust Rpt", phone="0501111999"
        )
        Lead.objects.filter(pk=self.lead_converted.pk).update(
            created_at=_aware(date(2026, 1, 5)),
            status=Lead.Status.CONVERTED,
            linked_customer=customer,
            converted_at=_aware(date(2026, 1, 20)),
            converted_by=self.employee,
        )

        self.lead_lost = create_lead(
            actor=self.employee,
            name="Lost",
            raw_phone="0501111003",
            campaign_id=self.camp_a.id,
            channel_id=self.channel_a.id,
            platform_id=self.platform_a.id,
        )
        Lead.objects.filter(pk=self.lead_lost.pk).update(
            created_at=_aware(date(2026, 1, 12)),
            status=Lead.Status.LOST,
            outcome=Lead.Outcome.NOT_INTERESTED,
        )

        self.lead_null_outcome = create_lead(
            actor=self.employee,
            name="Null Outcome",
            raw_phone="0501111004",
            campaign_id=self.camp_b.id,
            channel_id=self.channel_b.id,
            platform_id=self.platform_b.id,
        )
        Lead.objects.filter(pk=self.lead_null_outcome.pk).update(
            created_at=_aware(date(2026, 1, 15)),
            outcome="",
        )

        # Created before range, converted in range
        self.lead_old_converted = create_lead(
            actor=self.employee,
            name="Old Converted",
            raw_phone="0501111005",
            campaign_id=self.camp_a.id,
            channel_id=self.channel_a.id,
            platform_id=self.platform_a.id,
        )
        customer_old = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Cust Rpt Old",
            phone="0501111998",
        )
        Lead.objects.filter(pk=self.lead_old_converted.pk).update(
            created_at=_aware(date(2025, 12, 1)),
            status=Lead.Status.CONVERTED,
            linked_customer=customer_old,
            converted_at=_aware(date(2026, 1, 18)),
            converted_by=self.employee,
        )

        # Archived in range
        self.lead_archived = create_lead(
            actor=self.employee,
            name="Archived",
            raw_phone="0501111006",
            campaign_id=self.camp_a.id,
            channel_id=self.channel_a.id,
            platform_id=self.platform_a.id,
        )
        Lead.objects.filter(pk=self.lead_archived.pk).update(
            created_at=_aware(date(2026, 1, 8)),
            status=Lead.Status.ARCHIVED,
            archived_at=_aware(date(2026, 1, 9)),
            archived_by=self.employee,
            archive_reason="test",
        )

        # Lead-only on camp_b already; spend-only campaign
        CampaignSpend.objects.create(
            campaign=self.camp_spend_only,
            spend_date=date(2026, 1, 10),
            amount=Decimal("100.00"),
            created_by=self.employee,
        )
        CampaignSpend.objects.create(
            campaign=self.camp_a,
            spend_date=date(2026, 1, 11),
            amount=Decimal("50.00"),
            created_by=self.employee,
        )
        CampaignSpend.objects.create(
            campaign=self.camp_a,
            spend_date=date(2026, 1, 12),
            amount=Decimal("25.50"),
            created_by=self.employee,
        )

        # Assignments
        self.lead_assigned = create_lead(
            actor=self.employee, name="Assigned", raw_phone="0501111007"
        )
        Lead.objects.filter(pk=self.lead_assigned.pk).update(created_at=_aware(date(2026, 1, 16)))
        LeadAssignment.objects.create(
            lead=self.lead_assigned,
            operations_employee=self.ops,
            assigned_by=self.manager,
            assigned_at=_aware(date(2026, 1, 16)),
            status=LeadAssignment.Status.ACCEPTED,
            accepted_at=_aware(date(2026, 1, 16)),
        )

        self.lead_hist_only = create_lead(
            actor=self.employee, name="Hist Only", raw_phone="0501111008"
        )
        Lead.objects.filter(pk=self.lead_hist_only.pk).update(created_at=_aware(date(2026, 1, 17)))
        LeadAssignment.objects.create(
            lead=self.lead_hist_only,
            operations_employee=self.ops,
            assigned_by=self.manager,
            assigned_at=_aware(date(2026, 1, 10)),
            status=LeadAssignment.Status.REJECTED,
            rejected_at=_aware(date(2026, 1, 11)),
        )

        # Follow-ups
        now = timezone.now()
        LeadFollowUp.objects.create(
            lead=self.lead_new,
            assigned_to=self.ops,
            scheduled_for=now - timedelta(days=2),
            status=LeadFollowUp.Status.PENDING,
            created_by=self.employee,
        )
        LeadFollowUp.objects.create(
            lead=self.lead_new,
            assigned_to=self.ops,
            scheduled_for=timezone.make_aware(
                datetime.combine(timezone.localdate(), time(15, 0))
            ),
            status=LeadFollowUp.Status.PENDING,
            created_by=self.employee,
        )
        LeadFollowUp.objects.create(
            lead=self.lead_lost,
            assigned_to=self.ops,
            scheduled_for=now + timedelta(days=3),
            status=LeadFollowUp.Status.PENDING,
            created_by=self.employee,
        )
        LeadFollowUp.objects.create(
            lead=self.lead_null_outcome,
            assigned_to=self.ops,
            scheduled_for=now - timedelta(days=1),
            status=LeadFollowUp.Status.COMPLETED,
            completed_at=now,
            completed_by=self.ops,
            created_by=self.employee,
        )

    def test_safe_ratio_zero_denominator(self):
        self.assertIsNone(safe_ratio(1, 0))
        self.assertEqual(safe_ratio(1, 2), Decimal("0.5000"))

    def test_parse_default_dates_and_reversed(self):
        f = parse_report_filters({})
        today = timezone.localdate()
        self.assertEqual(f.date_from, today.replace(day=1))
        self.assertEqual(f.date_to, today)
        with self.assertRaises(InvalidReportDateRangeError):
            parse_report_filters({"date_from": "2026-02-01", "date_to": "2026-01-01"})

    def test_overview_empty_range(self):
        payload = build_overview_report(
            self.employee,
            {"date_from": "2024-01-01", "date_to": "2024-01-31"},
        )
        self.assertEqual(payload["leads"]["total"], 0)
        self.assertIsNone(payload["leads"]["conversion_rate"])
        self.assertEqual(payload["spend"]["total"], "0.00")

    def test_overview_totals_and_cohort_rate(self):
        payload = build_overview_report(self.employee, self.params)
        # created in Jan excluding archived: new, converted, lost, null_outcome, assigned, hist_only = 6
        self.assertEqual(payload["leads"]["total"], 6)
        self.assertEqual(payload["leads"]["converted_cohort"], 1)
        self.assertEqual(payload["leads"]["conversion_events"], 2)  # converted + old_converted
        self.assertEqual(payload["leads"]["lost"], 1)
        self.assertEqual(payload["leads"]["conversion_rate"], "0.1667")
        self.assertIsNotNone(payload["leads"]["average_time_to_conversion_hours"])
        # spend: 100 + 50 + 25.50
        self.assertEqual(payload["spend"]["total"], "175.50")
        self.assertEqual(payload["spend"]["cost_per_lead"], "29.25")
        self.assertEqual(payload["followups"]["overdue"], 1)
        self.assertGreaterEqual(payload["followups"]["due_today"], 1)
        self.assertEqual(payload["assignments"]["unassigned_leads"], 6)  # only lead_assigned active

        status_codes = {r["code"] for r in payload["breakdowns"]["status"]}
        self.assertIn("new", status_codes)
        self.assertNotIn("archived", status_codes)
        outcomes = {r["code"]: r["count"] for r in payload["breakdowns"]["outcome"]}
        self.assertIn(None, outcomes)

    def test_overview_include_archived(self):
        payload = build_overview_report(
            self.employee, {**self.params, "include_archived": "true"}
        )
        self.assertEqual(payload["leads"]["total"], 7)

    def test_overview_permission(self):
        bare = User.objects.create_user(username="bare", password="pass", role=User.Roles.EMPLOYEE)
        with self.assertRaises(ReportPermissionDeniedError):
            build_overview_report(bare, self.params)

    def test_lead_trends_dense_day(self):
        payload = build_lead_trends_report(
            self.employee, {**self.params, "interval": "day"}
        )
        self.assertEqual(payload["interval"], "day")
        self.assertEqual(len(payload["series"]), 31)
        day10 = next(p for p in payload["series"] if p["period"] == "2026-01-10")
        self.assertEqual(day10["created"], 1)
        with self.assertRaises(InvalidReportingIntervalError):
            build_lead_trends_report(self.employee, {**self.params, "interval": "hour"})
        with self.assertRaises(ReportDateRangeTooLargeError):
            build_lead_trends_report(
                self.employee,
                {"date_from": "2020-01-01", "date_to": "2022-01-01", "interval": "day"},
            )

    def test_campaign_performance_no_multiplication(self):
        payload = build_campaign_performance_report(self.employee, self.params)
        by_code = {r["campaign_code"]: r for r in payload["results"]}
        self.assertEqual(by_code["camp-empty-rpt"]["leads_created"], 0)
        self.assertEqual(by_code["camp-empty-rpt"]["spend"], "0.00")
        self.assertEqual(by_code["camp-spend-rpt"]["leads_created"], 0)
        self.assertEqual(by_code["camp-spend-rpt"]["spend"], "100.00")
        # camp_a: leads created in range excluding archived: new, converted, lost = 3
        # (+ assigned/hist have no campaign)
        self.assertEqual(by_code["camp-a-rpt"]["leads_created"], 3)
        self.assertEqual(by_code["camp-a-rpt"]["converted_leads"], 1)
        self.assertEqual(by_code["camp-a-rpt"]["spend"], "75.50")

    def test_followup_and_assignment_workload(self):
        fu = build_followup_workload_report(self.employee, self.params)
        self.assertEqual(fu["summary"]["overdue"], 1)
        self.assertEqual(fu["summary"]["completed"], 1)
        self.assertTrue(any(a["user_id"] == self.ops.pk for a in fu["by_assignee"]))

        aw = build_assignment_workload_report(self.employee, self.params)
        self.assertEqual(aw["summary"]["accepted"], 1)
        self.assertEqual(aw["summary"]["rejected"], 1)
        # unassigned = operational leads without active assignment
        self.assertGreaterEqual(aw["summary"]["unassigned_leads"], 1)

    def test_operations_visibility_before_aggregation(self):
        # Ops with report perm sees only self-assigned + unassigned
        payload = build_overview_report(self.ops, self.params)
        # lead_assigned is self-assigned; others unassigned (not actively assigned to ops2)
        # Should include unassigned leads and lead_assigned; counts <= manager totals
        mgr = build_overview_report(self.manager, self.params)
        self.assertLessEqual(payload["leads"]["total"], mgr["leads"]["total"])
        self.assertGreaterEqual(payload["leads"]["total"], 1)

    def test_overview_query_count_stable(self):
        # Add many leads — query count should not scale linearly
        for i in range(40):
            lead = create_lead(
                actor=self.employee, name=f"Bulk {i}", raw_phone=f"0502222{i:03d}"
            )
            Lead.objects.filter(pk=lead.pk).update(created_at=_aware(date(2026, 1, 20)))

        with CaptureQueriesContext(connection) as ctx:
            build_overview_report(self.employee, self.params)
        # Soft upper bound (auth/group checks + aggregates); must not be O(n) ~40+
        self.assertLess(len(ctx.captured_queries), 40)

    def test_campaign_performance_query_count(self):
        with CaptureQueriesContext(connection) as ctx:
            build_campaign_performance_report(self.employee, self.params)
        # Must not be one query per campaign
        self.assertLess(len(ctx.captured_queries), 25)
