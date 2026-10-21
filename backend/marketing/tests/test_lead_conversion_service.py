"""Service tests for Lead conversion (Phase 2C.4)."""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import transaction
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from customers.models import Customer
from marketing.exceptions import (
    CustomerMatchNotFoundError,
    CustomerCreationFailedError,
    InvalidConversionModeError,
    InvalidCustomerLinkError,
    LeadAlreadyConvertedError,
    LeadNotConvertibleError,
    MarketingPermissionDeniedError,
    MatchingCustomerFoundError,
    OperationNotPermittedError,
)
from marketing.models import Lead, LeadActivity, LeadAssignment, LeadFollowUp
from marketing.services.activities import create_activity
from marketing.services.assignments import assign_lead
from marketing.services.followups import create_followup
from marketing.services.lead_archive import archive_lead
from marketing.services.lead_convert import (
    MODE_CREATE_CUSTOMER,
    MODE_LINK_EXISTING,
    convert_lead_atomic,
)
from marketing.services.lead_create import create_lead

User = get_user_model()


def _grant(user, *codenames):
    for code in codenames:
        perm = Permission.objects.get(content_type__app_label="marketing", codename=code)
        user.user_permissions.add(perm)
    return User.objects.get(pk=user.pk)


class ConversionServiceFixtures(TestCase):
    def setUp(self):
        self.actor = User.objects.create_user(
            username="conv-actor", password="pass", role=User.Roles.EMPLOYEE
        )
        self.actor = _grant(
            self.actor,
            "view_lead",
            "add_lead",
            "change_lead",
            "convert_lead",
            "assign_lead",
            "manage_lead_activity",
            "add_leadactivity",
            "add_leadfollowup",
            "view_leadassignment",
        )


class CreateCustomerConversionTests(ConversionServiceFixtures):
    def test_valid_create_conversion(self):
        lead = create_lead(
            actor=self.actor,
            name="New Person",
            raw_phone="0501112233",
            email="np@example.com",
        )
        converted = convert_lead_atomic(
            lead=lead,
            actor=self.actor,
            mode=MODE_CREATE_CUSTOMER,
            customer_data={"type": "individual"},
        )
        self.assertEqual(converted.status, Lead.Status.CONVERTED)
        self.assertIsNotNone(converted.converted_at)
        self.assertEqual(converted.converted_by_id, self.actor.pk)
        self.assertIsNotNone(converted.linked_customer_id)
        customer = converted.linked_customer
        self.assertEqual(customer.name, "New Person")
        self.assertEqual(customer.phone, "0501112233")
        self.assertEqual(customer.email, "np@example.com")
        self.assertEqual(customer.balance, Decimal("0"))

    def test_matching_customer_blocks_create(self):
        Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Existing",
            phone="0502223344",
            balance=Decimal("0"),
        )
        lead = create_lead(
            actor=self.actor,
            name="Dup",
            raw_phone="050-222-3344",
            selected_customer_id=Customer.objects.get(phone="0502223344").pk,
        )
        # Lead may already be linked at create — clear link for conversion test of phone match
        Lead.objects.filter(pk=lead.pk).update(linked_customer=None)
        lead.refresh_from_db()

        with self.assertRaises(MatchingCustomerFoundError) as ctx:
            convert_lead_atomic(
                lead=lead, actor=self.actor, mode=MODE_CREATE_CUSTOMER, customer_data={}
            )
        self.assertEqual(ctx.exception.code, "matching_customer_found")
        self.assertTrue(ctx.exception.details["matches"])
        lead.refresh_from_db()
        self.assertNotEqual(lead.status, Lead.Status.CONVERTED)
        self.assertIsNone(lead.converted_at)

    def test_customer_validation_failure_rolls_back(self):
        lead = create_lead(actor=self.actor, name="Bad Cust", raw_phone="0503334455")
        before_customers = Customer.objects.count()
        with self.assertRaises(CustomerCreationFailedError):
            convert_lead_atomic(
                lead=lead,
                actor=self.actor,
                mode=MODE_CREATE_CUSTOMER,
                customer_data={"type": "not-a-valid-type", "name": "X"},
            )
        lead.refresh_from_db()
        self.assertNotEqual(lead.status, Lead.Status.CONVERTED)
        self.assertEqual(Customer.objects.count(), before_customers)

    def test_history_preserved_no_side_effects(self):
        lead = create_lead(actor=self.actor, name="Hist", raw_phone="0504445566")
        create_activity(
            actor=self.actor,
            lead_id=lead.pk,
            activity_type=LeadActivity.ActivityType.NOTE,
            notes="keep me",
        )
        create_followup(
            actor=self.actor,
            lead_id=lead.pk,
            scheduled_for=timezone.now(),
        )
        ops = User.objects.create_user(username="ops-c", password="pass", role=User.Roles.EMPLOYEE)
        assign_lead(actor=self.actor, lead_id=lead.pk, operations_employee_id=ops.pk)

        act_count = LeadActivity.objects.filter(lead=lead).count()
        fu_count = LeadFollowUp.objects.filter(lead=lead).count()
        asg_count = LeadAssignment.objects.filter(lead=lead).count()
        lead_number = lead.lead_number
        normalized = lead.normalized_phone

        convert_lead_atomic(
            lead=lead, actor=self.actor, mode=MODE_CREATE_CUSTOMER, customer_data={}
        )
        lead.refresh_from_db()
        self.assertEqual(lead.lead_number, lead_number)
        self.assertEqual(lead.normalized_phone, normalized)
        self.assertEqual(LeadActivity.objects.filter(lead=lead).count(), act_count)
        self.assertEqual(LeadFollowUp.objects.filter(lead=lead).count(), fu_count)
        self.assertEqual(LeadAssignment.objects.filter(lead=lead).count(), asg_count)
        # No procedures/payments/expenses
        from expenses.models import Expense

        self.assertEqual(Expense.objects.count(), 0)


class LinkExistingConversionTests(ConversionServiceFixtures):
    def test_link_primary_and_secondary(self):
        c1 = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Primary Match",
            phone="0505556677",
            balance=Decimal("10.00"),
        )
        lead = create_lead(
            actor=self.actor,
            name="L1",
            raw_phone="0505556677",
            selected_customer_id=c1.pk,
        )
        Lead.objects.filter(pk=lead.pk).update(linked_customer=None, status=Lead.Status.NEW)
        lead.refresh_from_db()

        converted = convert_lead_atomic(
            lead=lead,
            actor=self.actor,
            mode=MODE_LINK_EXISTING,
            customer_id=c1.pk,
        )
        self.assertEqual(converted.linked_customer_id, c1.pk)
        c1.refresh_from_db()
        self.assertEqual(c1.balance, Decimal("10.00"))
        self.assertEqual(c1.phone, "0505556677")

    def test_secondary_phone_match(self):
        c = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Sec",
            phone="0400000001",
            phone_secondary="0506667788",
            balance=Decimal("0"),
        )
        lead = create_lead(
            actor=self.actor,
            name="L2",
            raw_phone="0506667788",
            selected_customer_id=c.pk,
        )
        Lead.objects.filter(pk=lead.pk).update(
            linked_customer=None, status=Lead.Status.CONTACTED, converted_at=None
        )
        lead.refresh_from_db()

        converted = convert_lead_atomic(
            lead=lead, actor=self.actor, mode=MODE_LINK_EXISTING, customer_id=c.pk
        )
        self.assertEqual(converted.linked_customer_id, c.pk)

    def test_missing_customer_id_returns_matches(self):
        c = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="M",
            phone="0507778899",
            balance=Decimal("0"),
        )
        lead = create_lead(
            actor=self.actor, name="L3", raw_phone="0507778899", selected_customer_id=c.pk
        )
        Lead.objects.filter(pk=lead.pk).update(linked_customer=None, status=Lead.Status.NEW)
        lead.refresh_from_db()

        with self.assertRaises(MatchingCustomerFoundError) as ctx:
            convert_lead_atomic(lead=lead, actor=self.actor, mode=MODE_LINK_EXISTING)
        self.assertTrue(ctx.exception.details["matches"])

    def test_arbitrary_customer_rejected(self):
        match = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Match",
            phone="0508889900",
            balance=Decimal("0"),
        )
        other = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Other",
            phone="0401111111",
            balance=Decimal("0"),
        )
        lead = create_lead(
            actor=self.actor,
            name="L4",
            raw_phone="0508889900",
            selected_customer_id=match.pk,
        )
        Lead.objects.filter(pk=lead.pk).update(linked_customer=None, status=Lead.Status.NEW)
        lead.refresh_from_db()

        with self.assertRaises(InvalidCustomerLinkError):
            convert_lead_atomic(
                lead=lead,
                actor=self.actor,
                mode=MODE_LINK_EXISTING,
                customer_id=other.pk,
            )

    def test_no_match_rejected(self):
        lead = create_lead(actor=self.actor, name="L5", raw_phone="0509990011")
        with self.assertRaises(CustomerMatchNotFoundError):
            convert_lead_atomic(
                lead=lead,
                actor=self.actor,
                mode=MODE_LINK_EXISTING,
                customer_id=Customer.objects.create(
                    type=Customer.CustomerType.INDIVIDUAL,
                    name="NoPhoneMatch",
                    phone="0402222222",
                    balance=Decimal("0"),
                ).pk,
            )


class ConversionGuardrailTests(ConversionServiceFixtures):
    def test_already_converted_and_archived(self):
        lead = create_lead(actor=self.actor, name="Once", raw_phone="0501010101")
        convert_lead_atomic(
            lead=lead, actor=self.actor, mode=MODE_CREATE_CUSTOMER, customer_data={}
        )
        with self.assertRaises(LeadAlreadyConvertedError):
            convert_lead_atomic(
                lead=lead, actor=self.actor, mode=MODE_CREATE_CUSTOMER, customer_data={}
            )

        lead2 = create_lead(actor=self.actor, name="Arch", raw_phone="0501010102")
        archive_lead(lead=lead2, actor=self.actor, reason="done")
        with self.assertRaises(LeadNotConvertibleError):
            convert_lead_atomic(
                lead=lead2, actor=self.actor, mode=MODE_CREATE_CUSTOMER, customer_data={}
            )

    def test_invalid_mode_and_permission(self):
        lead = create_lead(actor=self.actor, name="Mode", raw_phone="0501010103")
        with self.assertRaises(InvalidConversionModeError):
            convert_lead_atomic(lead=lead, actor=self.actor, mode="merge_customers")

        bare = User.objects.create_user(username="nop", password="pass", role=User.Roles.EMPLOYEE)
        with self.assertRaises(MarketingPermissionDeniedError):
            convert_lead_atomic(
                lead=lead, actor=bare, mode=MODE_CREATE_CUSTOMER, customer_data={}
            )

    def test_lost_lead_may_convert(self):
        lead = create_lead(actor=self.actor, name="Lost", raw_phone="0501010104")
        Lead.objects.filter(pk=lead.pk).update(status=Lead.Status.LOST)
        lead.refresh_from_db()
        converted = convert_lead_atomic(
            lead=lead, actor=self.actor, mode=MODE_CREATE_CUSTOMER, customer_data={}
        )
        self.assertEqual(converted.status, Lead.Status.CONVERTED)


class ConversionConcurrencyDocTests(TransactionTestCase):
    """
    SQLite limitation: select_for_update does not provide PostgreSQL-grade
    concurrency. This test documents sequential double-conversion rejection
    rather than multi-threaded SQLite races.
    """

    def test_second_conversion_rejected_after_first_commits(self):
        actor = User.objects.create_user(
            username="conc", password="pass", role=User.Roles.MANAGER
        )
        lead = create_lead(actor=actor, name="Race", raw_phone="0502020202")
        convert_lead_atomic(
            lead=lead, actor=actor, mode=MODE_CREATE_CUSTOMER, customer_data={}
        )
        with self.assertRaises(LeadAlreadyConvertedError):
            convert_lead_atomic(
                lead=lead, actor=actor, mode=MODE_CREATE_CUSTOMER, customer_data={}
            )
        self.assertEqual(Customer.objects.filter(phone="0502020202").count(), 1)
