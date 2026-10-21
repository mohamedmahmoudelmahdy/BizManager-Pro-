"""Tests for sequential lead-number allocation.

Policy under test: **permanent reservation** (non-reuse).
``allocate_lead_number`` uses ``transaction.atomic(durable=True)`` so the
sequence increment commits independently of later Lead-write failures.

SQLite concurrency limitation:
``select_for_update`` does not provide the same row-level locking as PostgreSQL.
True multi-threaded allocator contention is not asserted under SQLite; uniqueness
of ``Lead.lead_number`` remains the safety net. Use PostgreSQL for production
concurrency guarantees.
"""

from django.db import transaction
from django.test import TestCase, TransactionTestCase

from marketing.exceptions import InvalidCampaignHierarchyError
from marketing.models import Lead, LeadNumberSequence, MarketingChannel, MarketingPlatform
from marketing.services.lead_create import create_lead
from marketing.services.lead_numbers import allocate_lead_number, format_lead_number
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission

User = get_user_model()


class FormatLeadNumberTests(TestCase):
    def test_formatting(self):
        self.assertEqual(format_lead_number(1), "L-000001")
        self.assertEqual(format_lead_number(12), "L-000012")
        self.assertEqual(format_lead_number(123456), "L-123456")


class AllocateLeadNumberTests(TestCase):
    def test_first_number_is_l_000001(self):
        self.assertEqual(allocate_lead_number(), "L-000001")
        seq = LeadNumberSequence.objects.get(scope_key="default")
        self.assertEqual(seq.next_value, 2)

    def test_sequence_increments(self):
        self.assertEqual(allocate_lead_number(), "L-000001")
        self.assertEqual(allocate_lead_number(), "L-000002")
        self.assertEqual(allocate_lead_number(), "L-000003")

    def test_scope_keys_are_independent(self):
        self.assertEqual(allocate_lead_number(scope_key="default"), "L-000001")
        self.assertEqual(allocate_lead_number(scope_key="company-a"), "L-000001")
        self.assertEqual(allocate_lead_number(scope_key="default"), "L-000002")
        self.assertEqual(allocate_lead_number(scope_key="company-a"), "L-000002")

    def test_durable_allocation_rejects_nesting_inside_atomic(self):
        """Permanent reservation must not nest as a savepoint."""
        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                allocate_lead_number()

    def test_sequence_persists(self):
        allocate_lead_number()
        allocate_lead_number()
        seq = LeadNumberSequence.objects.get(scope_key="default")
        self.assertEqual(seq.next_value, 3)
        self.assertEqual(allocate_lead_number(), "L-000003")


class PermanentReservationTests(TestCase):
    """Failed Lead creation must not reuse an already reserved number."""

    def setUp(self):
        self.actor = User.objects.create_user(
            username="num-actor", password="pass", role=User.Roles.EMPLOYEE
        )
        for code in ("add_lead", "change_lead", "view_lead"):
            perm = Permission.objects.get(content_type__app_label="marketing", codename=code)
            self.actor.user_permissions.add(perm)
        self.actor = User.objects.get(pk=self.actor.pk)
        self.channel = MarketingChannel.objects.create(name="Online", code="online-num")
        self.platform = MarketingPlatform.objects.create(
            channel=self.channel, name="Meta", code="meta-num"
        )
        self.other_channel = MarketingChannel.objects.create(name="Offline", code="offline-num")

    def test_failed_create_leaves_gap_and_does_not_reuse_number(self):
        with self.assertRaises(InvalidCampaignHierarchyError):
            create_lead(
                actor=self.actor,
                name="Will Fail",
                raw_phone="0501110001",
                channel_id=self.other_channel.pk,
                platform_id=self.platform.pk,
            )

        self.assertEqual(Lead.objects.count(), 0)
        seq = LeadNumberSequence.objects.get(scope_key="default")
        # L-000001 was reserved then create failed → next is 2 (gap / non-reuse).
        self.assertEqual(seq.next_value, 2)

        lead = create_lead(actor=self.actor, name="Next", raw_phone="0501110002")
        self.assertEqual(lead.lead_number, "L-000002")
        self.assertFalse(Lead.objects.filter(lead_number="L-000001").exists())


class AllocateLeadNumberTransactionTests(TransactionTestCase):
    """
    Documented SQLite limitation: concurrent select_for_update tests are not
    reliable here. This class only verifies sequential allocation across
    separate transactions.
    """

    def test_sequential_across_transactions(self):
        self.assertEqual(allocate_lead_number(), "L-000001")
        self.assertEqual(allocate_lead_number(), "L-000002")
