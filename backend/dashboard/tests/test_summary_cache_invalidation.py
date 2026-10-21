from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from banking.models import BankCard
from customers.models import Customer
from dashboard.cache import (
    bump_dashboard_summary_generation,
    get_dashboard_summary_generation,
)
from expenses.models import Expense
from payments.models import Payment
from procedures.models import Procedure

User = get_user_model()


@override_settings(
    DASHBOARD_SUMMARY_CACHE_ENABLED=True,
    DASHBOARD_SUMMARY_CACHE_TTL=300,
)
class DashboardSummaryInvalidationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user(
            username="cacheadmin", password="CacheTest123!", role="admin"
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.cash = BankCard.objects.create(
            bank_name="Cash",
            cardholder_name="Till",
            card_type="Cash",
            card_number="0000",
            last4="0000",
            expiry_month="12",
            expiry_year="2030",
            method_type=BankCard.MethodType.CASH,
            balance=1000,
        )
        self.customer = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Cache Cust",
            phone="0500000999",
            balance=0,
        )

    def test_payment_mutation_bumps_generation_and_misses_cache(self):
        r1 = self.client.get("/api/dashboard/summary/")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.get("X-Cache"), "MISS")
        r2 = self.client.get("/api/dashboard/summary/")
        self.assertEqual(r2.get("X-Cache"), "HIT")
        gen_before = get_dashboard_summary_generation()

        Payment.objects.create(
            customer=self.customer,
            amount="10.00",
            date="2026-10-01",
            type=Payment.PaymentType.CASH,
            bank_card=self.cash,
            recorded_by=self.admin,
        )
        self.assertGreater(get_dashboard_summary_generation(), gen_before)

        r3 = self.client.get("/api/dashboard/summary/")
        self.assertEqual(r3.get("X-Cache"), "MISS")

    def test_procedure_and_expense_mutations_invalidate(self):
        self.client.get("/api/dashboard/summary/")
        self.assertEqual(self.client.get("/api/dashboard/summary/").get("X-Cache"), "HIT")

        Procedure.objects.create(
            customer=self.customer,
            category="Typing",
            cost="1.00",
            selling_price="2.00",
            cash_in="2.00",
            status="done",
            assigned_employee=self.admin,
            date="2026-10-01",
        )
        self.assertEqual(self.client.get("/api/dashboard/summary/").get("X-Cache"), "MISS")
        self.assertEqual(self.client.get("/api/dashboard/summary/").get("X-Cache"), "HIT")

        Expense.objects.create(
            category="office",
            date="2026-10-01",
            amount="5.00",
            paid_by=self.cash,
            notes="cache-bust",
        )
        self.assertEqual(self.client.get("/api/dashboard/summary/").get("X-Cache"), "MISS")

    def test_manual_bump(self):
        a = bump_dashboard_summary_generation()
        b = bump_dashboard_summary_generation()
        self.assertGreater(b, a)
