"""Financial-summary must surface Procedure.description without changing money logic."""

from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from customers.models import Customer
from payments.models import Payment
from procedures.models import Procedure

User = get_user_model()


class FinancialSummaryProcedureDescriptionTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="fs_desc_admin",
            password="pass",
            role=User.Roles.ADMIN,
        )
        self.customer = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Desc Customer",
            phone="0509999001",
            balance=Decimal("250.00"),
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _create_procedure(self, *, description: str, selling_price="250.00", paid="0.00"):
        return Procedure.objects.create(
            customer=self.customer,
            category="تعديل بيانات جوازات",
            description=description,
            cost=Decimal("50.00"),
            selling_price=Decimal(selling_price),
            paid=Decimal(paid),
            status=Procedure.Status.DONE,
            date=date(2026, 7, 15),
        )

    def test_procedure_description_in_financial_summary(self):
        self._create_procedure(description="تجديد بيانات جوازات للعميل")

        response = self.client.get(f"/api/customers/{self.customer.pk}/financial-summary/")
        self.assertEqual(response.status_code, 200, response.content)
        rows = response.json()["procedures"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["description"], "تجديد بيانات جوازات للعميل")
        self.assertEqual(rows[0]["category"], "تعديل بيانات جوازات")
        self.assertEqual(rows[0]["customer_id"], str(self.customer.pk))

    def test_english_description_preserved(self):
        self._create_procedure(description="Passport data renewal for the customer")

        response = self.client.get(f"/api/customers/{self.customer.pk}/financial-summary/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            response.json()["procedures"][0]["description"],
            "Passport data renewal for the customer",
        )

    def test_empty_description_returns_empty_string(self):
        self._create_procedure(description="")

        response = self.client.get(f"/api/customers/{self.customer.pk}/financial-summary/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["procedures"][0]["description"], "")

    def test_financial_amounts_unchanged_with_description(self):
        self._create_procedure(description="Any note", selling_price="250.00", paid="100.00")
        balance_before = self.customer.balance

        response = self.client.get(f"/api/customers/{self.customer.pk}/financial-summary/")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        row = body["procedures"][0]

        self.assertEqual(row["selling_price"], "250.00")
        self.assertEqual(row["cost"], "50.00")
        self.assertEqual(row["paid"], "100.00")
        self.assertEqual(row["outstanding"], "150.00")
        self.assertEqual(body["totals"]["total_procedure_charges"], "250.00")
        self.assertEqual(body["customer"]["balance"], "250.00")

        self.customer.refresh_from_db()
        self.assertEqual(self.customer.balance, balance_before)
        self.assertEqual(Payment.objects.count(), 0)
        self.assertEqual(Procedure.objects.count(), 1)

    def test_payment_rows_unaffected_and_no_duplicate_procedures(self):
        proc = self._create_procedure(description="Shared desc")
        Payment.objects.create(
            customer=self.customer,
            procedure=proc,
            amount=Decimal("50.00"),
            date=date(2026, 7, 16),
            type=Payment.PaymentType.CASH,
        )

        response = self.client.get(f"/api/customers/{self.customer.pk}/financial-summary/")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertEqual(len(body["procedures"]), 1)
        self.assertEqual(body["procedures"][0]["description"], "Shared desc")
        self.assertEqual(len(body["payments"]), 1)
        self.assertNotIn("description", body["payments"][0])
        # Statement procedure line uses category as ledger label, not Procedure.description.
        proc_statement = next(r for r in body["statement"] if r["kind"] == "procedure")
        self.assertEqual(proc_statement["description"], "تعديل بيانات جوازات")
