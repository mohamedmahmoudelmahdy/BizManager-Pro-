"""Tests for customer phone matching."""

from decimal import Decimal

from django.test import TestCase

from customers.models import Customer
from marketing.services.customer_matching import find_customers_by_phone
from marketing.services.phone_normalization import normalize_phone


class CustomerMatchingTests(TestCase):
    def setUp(self):
        self.c1 = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Alice Primary",
            phone="050-111-2233",
            balance=Decimal("0"),
        )
        self.c2 = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Contact",
            company_name="Beta Co",
            phone="971501112233",
            phone_secondary="050 222 3344",
            balance=Decimal("0"),
        )
        self.c3 = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Carol Secondary",
            phone="0400000000",
            phone_secondary="050-222-3344",
            balance=Decimal("0"),
        )

    def test_primary_phone_match(self):
        matches = find_customers_by_phone(normalized_phone=normalize_phone("0501112233"))
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].customer_id, self.c1.pk)
        self.assertEqual(matches[0].matched_field, "phone")

    def test_secondary_phone_match(self):
        matches = find_customers_by_phone(normalized_phone=normalize_phone("0502223344"))
        ids = {m.customer_id for m in matches}
        self.assertIn(self.c2.pk, ids)
        self.assertIn(self.c3.pk, ids)

    def test_multiple_customers_returned(self):
        matches = find_customers_by_phone(normalized_phone="0502223344")
        self.assertGreaterEqual(len(matches), 2)

    def test_same_customer_deduplicated_when_both_fields_match(self):
        customer = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Dup Fields",
            phone="0556667777",
            phone_secondary="055-666-7777",
            balance=Decimal("0"),
        )
        matches = find_customers_by_phone(normalized_phone="0556667777")
        self.assertEqual(len([m for m in matches if m.customer_id == customer.pk]), 1)
        self.assertEqual(matches[0].matched_field, "phone")

    def test_deterministic_ordering(self):
        matches = find_customers_by_phone(normalized_phone="0502223344")
        names = [m.display_name for m in matches]
        self.assertEqual(names, sorted(names, key=lambda n: n.casefold()))

    def test_does_not_mutate_customer(self):
        before = (self.c1.phone, self.c1.phone_secondary, self.c1.updated_at)
        find_customers_by_phone(normalized_phone="0501112233")
        self.c1.refresh_from_db()
        self.assertEqual((self.c1.phone, self.c1.phone_secondary, self.c1.updated_at), before)
