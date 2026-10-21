"""Service-layer tests for lead create/update/archive."""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import transaction
from django.test import TestCase

from customers.models import Customer
from marketing.exceptions import (
    ArchiveReasonRequiredError,
    DuplicateLeadPhoneError,
    ImmutableFieldError,
    InvalidCampaignHierarchyError,
    InvalidCustomerLinkError,
    InvalidPhoneError,
    LeadAlreadyArchivedError,
    MarketingPermissionDeniedError,
    MatchingCustomerFoundError,
)
from marketing.models import Lead, MarketingCampaign, MarketingChannel, MarketingPlatform
from marketing.services.lead_archive import archive_lead
from marketing.services.lead_create import create_lead
from marketing.services.lead_update import update_lead

User = get_user_model()


def _grant(user, *codenames):
    for code in codenames:
        perm = Permission.objects.get(content_type__app_label="marketing", codename=code)
        user.user_permissions.add(perm)
    user = User.objects.get(pk=user.pk)
    return user


class LeadServiceFixtures(TestCase):
    def setUp(self):
        self.actor = User.objects.create_user(
            username="lead-actor",
            password="pass",
            role=User.Roles.EMPLOYEE,
        )
        self.actor = _grant(self.actor, "add_lead", "change_lead", "view_lead")
        self.channel = MarketingChannel.objects.create(name="Online", code="online")
        self.platform = MarketingPlatform.objects.create(
            channel=self.channel, name="Meta", code="meta"
        )
        self.other_channel = MarketingChannel.objects.create(name="Offline", code="offline")
        self.campaign = MarketingCampaign.objects.create(
            platform=self.platform,
            name="Spring",
            code="spring",
            created_by=self.actor,
        )


class LeadCreateServiceTests(LeadServiceFixtures):
    def test_valid_creation_allocates_number_and_creator(self):
        lead = create_lead(
            actor=self.actor,
            name="New Lead",
            raw_phone="+971 50 100 2000",
        )
        self.assertEqual(lead.lead_number, "L-000001")
        self.assertEqual(lead.raw_phone, "+971 50 100 2000")
        self.assertEqual(lead.normalized_phone, "971501002000")
        self.assertEqual(lead.created_by_id, self.actor.pk)
        self.assertIsNone(lead.converted_at)
        self.assertIsNone(lead.archived_at)

    def test_invalid_phone_rejected(self):
        with self.assertRaises(InvalidPhoneError) as ctx:
            create_lead(actor=self.actor, name="Bad", raw_phone="not-a-phone")
        self.assertEqual(ctx.exception.code, "invalid_phone")

    def test_no_uae_conversion(self):
        lead = create_lead(actor=self.actor, name="Local", raw_phone="0501234567")
        self.assertEqual(lead.normalized_phone, "0501234567")

    def test_duplicate_lead_phone(self):
        create_lead(actor=self.actor, name="One", raw_phone="0501111111")
        with self.assertRaises(DuplicateLeadPhoneError) as ctx:
            create_lead(actor=self.actor, name="Two", raw_phone="050-111-1111")
        self.assertEqual(ctx.exception.code, "duplicate_lead_phone")
        self.assertIn("lead", ctx.exception.details)

    def test_matching_customer_requires_explicit_link(self):
        Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Match Me",
            phone="0509998888",
            balance=Decimal("0"),
        )
        with self.assertRaises(MatchingCustomerFoundError) as ctx:
            create_lead(actor=self.actor, name="Lead", raw_phone="0509998888")
        self.assertEqual(ctx.exception.code, "matching_customer_found")
        self.assertTrue(ctx.exception.details["matches"])

    def test_valid_explicit_customer_link(self):
        customer = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Match Me",
            phone="0509997777",
            balance=Decimal("0"),
        )
        lead = create_lead(
            actor=self.actor,
            name="Lead",
            raw_phone="0509997777",
            selected_customer_id=customer.pk,
        )
        self.assertEqual(lead.linked_customer_id, customer.pk)
        self.assertIsNone(lead.converted_at)
        self.assertNotEqual(lead.status, Lead.Status.CONVERTED)
        customer.refresh_from_db()
        self.assertEqual(customer.phone, "0509997777")

    def test_invalid_customer_link(self):
        Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Match Me",
            phone="0509996666",
            balance=Decimal("0"),
        )
        other = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Other",
            phone="0400000001",
            balance=Decimal("0"),
        )
        with self.assertRaises(InvalidCustomerLinkError):
            create_lead(
                actor=self.actor,
                name="Lead",
                raw_phone="0509996666",
                selected_customer_id=other.pk,
            )

    def test_hierarchy_validation(self):
        with self.assertRaises(InvalidCampaignHierarchyError):
            create_lead(
                actor=self.actor,
                name="Lead",
                raw_phone="0501234001",
                channel_id=self.other_channel.pk,
                platform_id=self.platform.pk,
            )

    def test_permission_denied(self):
        bare = User.objects.create_user(username="noperm", password="pass", role=User.Roles.EMPLOYEE)
        with self.assertRaises(MarketingPermissionDeniedError):
            create_lead(actor=bare, name="X", raw_phone="0501234002")

    def test_failed_create_does_not_commit_lead(self):
        Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Block",
            phone="0505550000",
            balance=Decimal("0"),
        )
        with self.assertRaises(MatchingCustomerFoundError):
            create_lead(actor=self.actor, name="Blocked", raw_phone="0505550000")
        self.assertEqual(Lead.objects.count(), 0)


class LeadUpdateServiceTests(LeadServiceFixtures):
    def setUp(self):
        super().setUp()
        self.lead = create_lead(actor=self.actor, name="Updatable", raw_phone="0502003001")

    def test_mutable_fields_update(self):
        updated = update_lead(
            lead=self.lead,
            actor=self.actor,
            updates={"name": "Renamed", "email": "a@b.com", "outcome": Lead.Outcome.INTERESTED},
        )
        self.assertEqual(updated.name, "Renamed")
        self.assertEqual(updated.email, "a@b.com")
        self.assertEqual(updated.outcome, Lead.Outcome.INTERESTED)

    def test_immutable_lead_number_rejected(self):
        with self.assertRaises(ImmutableFieldError) as ctx:
            update_lead(
                lead=self.lead,
                actor=self.actor,
                updates={"lead_number": "L-999999"},
            )
        self.assertEqual(ctx.exception.code, "immutable_field")

    def test_phone_change_renormalized_and_duplicate_rejected(self):
        create_lead(actor=self.actor, name="Other", raw_phone="0502003999")
        with self.assertRaises(DuplicateLeadPhoneError):
            update_lead(
                lead=self.lead,
                actor=self.actor,
                updates={"raw_phone": "050-200-3999"},
            )

    def test_phone_change_reruns_customer_matching(self):
        customer = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Phone Match",
            phone="0502003888",
            balance=Decimal("0"),
        )
        with self.assertRaises(MatchingCustomerFoundError):
            update_lead(
                lead=self.lead,
                actor=self.actor,
                updates={"raw_phone": "0502003888"},
            )
        updated = update_lead(
            lead=self.lead,
            actor=self.actor,
            updates={"raw_phone": "0502003888"},
            selected_customer_id=customer.pk,
        )
        self.assertEqual(updated.normalized_phone, "0502003888")
        self.assertEqual(updated.linked_customer_id, customer.pk)

    def test_archive_status_blocked_on_generic_update(self):
        with self.assertRaises(ImmutableFieldError):
            update_lead(
                lead=self.lead,
                actor=self.actor,
                updates={"status": Lead.Status.ARCHIVED},
            )

    def test_hierarchy_on_update(self):
        with self.assertRaises(InvalidCampaignHierarchyError):
            update_lead(
                lead=self.lead,
                actor=self.actor,
                updates={
                    "channel_id": self.other_channel.pk,
                    "platform_id": self.platform.pk,
                },
            )


class LeadArchiveServiceTests(LeadServiceFixtures):
    def setUp(self):
        super().setUp()
        self.lead = create_lead(actor=self.actor, name="Archive Me", raw_phone="0503004001")

    def test_archive_sets_metadata(self):
        archived = archive_lead(lead=self.lead, actor=self.actor, reason="  duplicate inquiry  ")
        self.assertEqual(archived.status, Lead.Status.ARCHIVED)
        self.assertIsNotNone(archived.archived_at)
        self.assertEqual(archived.archived_by_id, self.actor.pk)
        self.assertEqual(archived.archive_reason, "duplicate inquiry")
        self.assertTrue(Lead.objects.filter(pk=archived.pk).exists())

    def test_reason_required(self):
        with self.assertRaises(ArchiveReasonRequiredError):
            archive_lead(lead=self.lead, actor=self.actor, reason="   ")

    def test_already_archived(self):
        archive_lead(lead=self.lead, actor=self.actor, reason="once")
        with self.assertRaises(LeadAlreadyArchivedError):
            archive_lead(lead=self.lead, actor=self.actor, reason="twice")
