from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from customers.models import Customer
from expenses.models import Expense
from marketing.models import (
    CampaignSpend,
    Lead,
    LeadActivity,
    LeadAssignment,
    LeadFollowUp,
    LeadNumberSequence,
    MarketingAdSet,
    MarketingAdvertisement,
    MarketingCampaign,
    MarketingChannel,
    MarketingPlatform,
)

User = get_user_model()


class MarketingModelFixturesMixin:
    def setUp(self):
        self.user = User.objects.create_user(username="mkt-user", password="pass", role=User.Roles.MANAGER)
        self.ops = User.objects.create_user(username="ops-user", password="pass", role=User.Roles.EMPLOYEE)
        self.channel = MarketingChannel.objects.create(name="Online", code="online")
        self.platform = MarketingPlatform.objects.create(
            channel=self.channel, name="Meta", code="meta"
        )
        self.campaign = MarketingCampaign.objects.create(
            platform=self.platform,
            name="Spring Ads",
            code="spring-ads",
            created_by=self.user,
        )
        self.customer = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Existing Customer",
            phone="0509998877",
            balance=Decimal("250.00"),
        )
        self._lead_seq = 0

    def _next_lead_number(self) -> str:
        self._lead_seq += 1
        return f"L-{self._lead_seq:06d}"

    def _make_lead(self, **overrides) -> Lead:
        phone = overrides.pop("raw_phone", f"050100{self._lead_seq + 1:04d}")
        normalized = overrides.pop("normalized_phone", phone.replace("-", "").replace(" ", ""))
        defaults = {
            "lead_number": self._next_lead_number(),
            "name": "Test Lead",
            "raw_phone": phone,
            "normalized_phone": normalized,
            "created_by": self.user,
        }
        defaults.update(overrides)
        return Lead.objects.create(**defaults)


class LeadNumberSequenceTests(TestCase):
    def test_default_scope_and_next_value(self):
        seq = LeadNumberSequence(scope_key="default", next_value=1)
        seq.full_clean()
        seq.save()
        self.assertEqual(str(seq), "LeadNumberSequence(default) next=1")

    def test_next_value_must_be_positive(self):
        seq = LeadNumberSequence(scope_key="bad", next_value=0)
        with self.assertRaises(ValidationError):
            seq.full_clean()


class LeadConstraintTests(MarketingModelFixturesMixin, TestCase):
    def test_phone_fields_required(self):
        lead = Lead(
            lead_number="L-REQ-1",
            name="No Phone",
            raw_phone="",
            normalized_phone="",
        )
        with self.assertRaises(ValidationError):
            lead.full_clean()

    def test_normalized_phone_unique(self):
        self._make_lead(raw_phone="0501112233", normalized_phone="0501112233")
        with self.assertRaises(Exception):
            self._make_lead(raw_phone="050-111-2233", normalized_phone="0501112233")

    def test_lead_number_unique(self):
        self._make_lead(lead_number="L-UNIQUE-1", normalized_phone="0502223344")
        with self.assertRaises(Exception):
            Lead.objects.create(
                lead_number="L-UNIQUE-1",
                name="Dup",
                raw_phone="0503334455",
                normalized_phone="0503334455",
            )

    def test_default_status_and_optional_outcome(self):
        lead = self._make_lead()
        self.assertEqual(lead.status, Lead.Status.NEW)
        self.assertEqual(lead.outcome, "")

    def test_valid_status_and_outcome(self):
        lead = self._make_lead(status=Lead.Status.CONTACTED, outcome=Lead.Outcome.INTERESTED)
        lead.full_clean()
        self.assertEqual(lead.outcome, Lead.Outcome.INTERESTED)

    def test_optional_campaign_attribution(self):
        lead = self._make_lead()
        self.assertIsNone(lead.campaign_id)
        self.assertIsNone(lead.ad_set_id)
        self.assertIsNone(lead.advertisement_id)

    def test_archived_metadata_consistency(self):
        lead = self._make_lead()
        lead.status = Lead.Status.ARCHIVED
        with self.assertRaises(ValidationError):
            lead.full_clean()
        lead.archived_at = timezone.now()
        lead.archived_by = self.user
        lead.archive_reason = "Duplicate inquiry"
        lead.full_clean()
        lead.save()

    def test_linked_customer_does_not_change_financial_fields(self):
        balance_before = self.customer.balance
        lead = self._make_lead(linked_customer=self.customer)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.balance, balance_before)
        self.assertEqual(Expense.objects.count(), 0)
        self.assertEqual(lead.linked_customer_id, self.customer.id)

    def test_customer_delete_preserves_lead(self):
        lead = self._make_lead(linked_customer=self.customer)
        lead_id = lead.id
        self.customer.delete()
        lead = Lead.objects.get(pk=lead_id)
        self.assertIsNone(lead.linked_customer_id)


class CampaignHierarchyTests(MarketingModelFixturesMixin, TestCase):
    def test_campaign_without_ad_set_or_advertisement(self):
        self.campaign.full_clean()
        lead = self._make_lead(
            channel=self.channel,
            platform=self.platform,
            campaign=self.campaign,
        )
        lead.full_clean()
        self.assertIsNone(lead.ad_set_id)
        self.assertIsNone(lead.advertisement_id)

    def test_advertisement_without_ad_set_valid(self):
        ad = MarketingAdvertisement(
            campaign=self.campaign,
            name="Creative A",
        )
        ad.full_clean()
        ad.save()
        self.assertIsNone(ad.ad_set_id)

    def test_advertisement_mismatched_ad_set_invalid(self):
        other_campaign = MarketingCampaign.objects.create(
            platform=self.platform, name="Other", code="other-camp"
        )
        other_ad_set = MarketingAdSet.objects.create(campaign=other_campaign, name="Other Set")
        ad = MarketingAdvertisement(
            campaign=self.campaign,
            ad_set=other_ad_set,
            name="Bad Ad",
        )
        with self.assertRaises(ValidationError):
            ad.full_clean()

    def test_invalid_campaign_dates(self):
        camp = MarketingCampaign(
            platform=self.platform,
            name="Bad Dates",
            code="bad-dates",
            start_date=date.today(),
            end_date=date.today() - timedelta(days=1),
        )
        with self.assertRaises(ValidationError):
            camp.full_clean()

    def test_negative_budget_invalid(self):
        camp = MarketingCampaign(
            platform=self.platform,
            name="Neg Budget",
            code="neg-budget",
            budget=Decimal("-10.00"),
        )
        with self.assertRaises(ValidationError):
            camp.full_clean()

    def test_deactivated_campaign_remains_linked_to_lead(self):
        lead = self._make_lead(
            channel=self.channel,
            platform=self.platform,
            campaign=self.campaign,
        )
        self.campaign.is_active = False
        self.campaign.save(update_fields=["is_active", "updated_at"])
        lead.refresh_from_db()
        self.assertEqual(lead.campaign_id, self.campaign.id)
        self.assertFalse(lead.campaign.is_active)


class CampaignSpendTests(MarketingModelFixturesMixin, TestCase):
    def test_positive_amount_required(self):
        spend = CampaignSpend(
            campaign=self.campaign,
            spend_date=date.today(),
            amount=Decimal("0.00"),
        )
        with self.assertRaises(ValidationError):
            spend.full_clean()

    def test_no_automatic_expense_or_ledger_records(self):
        spend = CampaignSpend.objects.create(
            campaign=self.campaign,
            spend_date=date.today(),
            amount=Decimal("100.00"),
            created_by=self.user,
        )
        self.assertEqual(spend.integration_status, CampaignSpend.IntegrationStatus.PENDING)
        self.assertIsNone(spend.expense_id)
        self.assertEqual(Expense.objects.count(), 0)

    def test_hierarchy_consistency(self):
        other = MarketingCampaign.objects.create(
            platform=self.platform, name="Other2", code="other2"
        )
        ad_set = MarketingAdSet.objects.create(campaign=other, name="Wrong set")
        spend = CampaignSpend(
            campaign=self.campaign,
            ad_set=ad_set,
            spend_date=date.today(),
            amount=Decimal("50.00"),
        )
        with self.assertRaises(ValidationError):
            spend.full_clean()


class ActivityFollowUpTests(MarketingModelFixturesMixin, TestCase):
    def test_all_approved_activity_types(self):
        lead = self._make_lead()
        now = timezone.now()
        for activity_type, _label in LeadActivity.ActivityType.choices:
            LeadActivity.objects.create(
                lead=lead,
                activity_type=activity_type,
                occurred_at=now,
                created_by=self.user,
            )
        self.assertEqual(lead.activities.count(), len(LeadActivity.ActivityType.choices))

    def test_follow_up_completion_validation(self):
        lead = self._make_lead()
        follow = LeadFollowUp(
            lead=lead,
            scheduled_for=timezone.now() + timedelta(days=1),
            status=LeadFollowUp.Status.COMPLETED,
            created_by=self.user,
        )
        with self.assertRaises(ValidationError):
            follow.full_clean()
        follow.completed_at = timezone.now()
        follow.completed_by = self.user
        follow.full_clean()

    def test_activities_survive_lead_archival(self):
        lead = self._make_lead()
        activity = LeadActivity.objects.create(
            lead=lead,
            activity_type=LeadActivity.ActivityType.NOTE,
            notes="Keep me",
            occurred_at=timezone.now(),
        )
        lead.status = Lead.Status.ARCHIVED
        lead.archived_at = timezone.now()
        lead.archived_by = self.user
        lead.archive_reason = "Closed"
        lead.save()
        self.assertTrue(LeadActivity.objects.filter(pk=activity.pk).exists())


class AssignmentTests(MarketingModelFixturesMixin, TestCase):
    def test_multiple_historical_assignments_permitted(self):
        lead = self._make_lead()
        now = timezone.now()
        a1 = LeadAssignment.objects.create(
            lead=lead,
            operations_employee=self.ops,
            assigned_by=self.user,
            assigned_at=now,
            status=LeadAssignment.Status.REASSIGNED,
        )
        a2 = LeadAssignment.objects.create(
            lead=lead,
            operations_employee=self.ops,
            assigned_by=self.user,
            assigned_at=now + timedelta(minutes=1),
            status=LeadAssignment.Status.PENDING,
        )
        self.assertEqual(lead.assignments.count(), 2)
        self.assertNotEqual(a1.id, a2.id)

    def test_invalid_timestamp_status_rejected(self):
        lead = self._make_lead()
        assignment = LeadAssignment(
            lead=lead,
            operations_employee=self.ops,
            assigned_by=self.user,
            assigned_at=timezone.now(),
            status=LeadAssignment.Status.ACCEPTED,
        )
        with self.assertRaises(ValidationError):
            assignment.full_clean()

    def test_active_assignment_uniqueness_deferred_to_phase_2c(self):
        """
        Documented: one-active enforcement is service-level in Phase 2C.
        Multiple pending/accepted rows are allowed at the DB layer.
        """
        lead = self._make_lead()
        now = timezone.now()
        LeadAssignment.objects.create(
            lead=lead,
            operations_employee=self.ops,
            assigned_by=self.user,
            assigned_at=now,
            status=LeadAssignment.Status.PENDING,
        )
        LeadAssignment.objects.create(
            lead=lead,
            operations_employee=self.user,
            assigned_by=self.user,
            assigned_at=now + timedelta(seconds=1),
            status=LeadAssignment.Status.ACCEPTED,
            accepted_at=now + timedelta(seconds=1),
        )
        active = lead.assignments.filter(status__in=LeadAssignment.ACTIVE_STATUSES)
        self.assertEqual(active.count(), 2)
