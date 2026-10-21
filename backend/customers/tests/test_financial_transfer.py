"""Atomic Procedure/Payment transfer between customer accounts."""

from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from banking.models import BankCard
from customers.models import Customer, CustomerFinancialTransfer
from payments.models import Payment
from procedures.models import Procedure
from procedures.services.create_with_accounting import create_procedure_with_accounting

User = get_user_model()


class FinancialTransferTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="xfer-admin", password="pass", role=User.Roles.ADMIN
        )
        self.manager = User.objects.create_user(
            username="xfer-manager", password="pass", role=User.Roles.MANAGER
        )
        self.employee = User.objects.create_user(
            username="xfer-employee", password="pass", role=User.Roles.EMPLOYEE
        )
        self.cashier = User.objects.create_user(
            username="xfer-cashier", password="pass", role=User.Roles.CASHIER
        )
        self.source = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Source Customer",
            phone="0501000001",
            balance=Decimal("0.00"),
        )
        self.target = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Target Customer",
            phone="0501000002",
            balance=Decimal("0.00"),
        )
        self.closed = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Closed Customer",
            phone="0501000003",
            balance=Decimal("0.00"),
            account_status=Customer.AccountStatus.CLOSED,
        )
        self.card = BankCard.objects.create(
            bank_name="Cash Box",
            cardholder_name="Office",
            card_type="Cash",
            card_number="2222",
            last4="2222",
            expiry_month="12",
            expiry_year="2030",
            method_type=BankCard.MethodType.CASH,
            balance=Decimal("1000.00"),
        )
        self.client = APIClient()

    def _create_procedure(self, customer, *, selling="250.00", paid="0.00", cost="50.00", description=""):
        return create_procedure_with_accounting(
            user=self.admin,
            validated_data={
                "customer": customer,
                "category": "Visa",
                "description": description,
                "cost": Decimal(cost),
                "selling_price": Decimal(selling),
                "paid": Decimal(paid),
                "cash_in": Decimal("0.00"),
                "cash_out_type": self.card,
                "cash_in_type": None,
                "status": Procedure.Status.SUBMITTED,
                "assigned_employee": None,
                "date": date(2026, 8, 1),
            },
            raw_data={},
        )

    def _create_payment(self, customer, *, amount="100.00", procedure=None):
        self.client.force_authenticate(self.admin)
        payload = {
            "amount": amount,
            "date": date(2026, 8, 2).isoformat(),
            "type": "cash",
            "customer": str(customer.pk),
            "bank_card": self.card.pk,
            "procedure": str(procedure.pk) if procedure else None,
            "notes": "Transfer test payment",
        }
        resp = self.client.post("/api/payments/", payload, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        return Payment.objects.get(pk=resp.json()["id"])

    def test_admin_can_transfer_procedure(self):
        proc = self._create_procedure(self.source, selling="250.00", paid="0.00")
        self.source.refresh_from_db()
        self.assertEqual(self.source.balance, Decimal("250.00"))

        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            f"/api/procedures/{proc.pk}/transfer-customer/",
            {
                "target_customer_id": str(self.target.pk),
                "reason": "Registered under wrong customer",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)

        proc.refresh_from_db()
        self.source.refresh_from_db()
        self.target.refresh_from_db()
        self.card.refresh_from_db()

        self.assertEqual(proc.customer_id, self.target.pk)
        self.assertEqual(self.source.balance, Decimal("0.00"))
        self.assertEqual(self.target.balance, Decimal("250.00"))
        self.assertEqual(self.card.balance, Decimal("950.00"))  # cost debit only once
        self.assertEqual(CustomerFinancialTransfer.objects.count(), 1)
        audit = CustomerFinancialTransfer.objects.get()
        self.assertEqual(audit.transfer_type, "procedure")
        self.assertEqual(audit.reason, "Registered under wrong customer")

    def test_manager_can_transfer_payment(self):
        self._create_procedure(self.source, selling="200.00", paid="0.00")
        pay = self._create_payment(self.source, amount="80.00")
        card_before = BankCard.objects.get(pk=self.card.pk).balance

        self.client.force_authenticate(self.manager)
        resp = self.client.post(
            f"/api/payments/{pay.pk}/transfer-customer/",
            {
                "target_customer_id": str(self.target.pk),
                "reason": "Payment posted to wrong account",
                "target_procedure_id": None,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)

        pay.refresh_from_db()
        self.source.refresh_from_db()
        self.target.refresh_from_db()
        self.card.refresh_from_db()

        self.assertEqual(pay.customer_id, self.target.pk)
        self.assertIsNone(pay.procedure_id)
        self.assertEqual(self.card.balance, card_before)
        self.assertEqual(CustomerFinancialTransfer.objects.count(), 1)

    def test_employee_can_transfer_procedure(self):
        proc = self._create_procedure(self.source, selling="250.00", paid="0.00")
        self.client.force_authenticate(self.employee)
        resp = self.client.post(
            f"/api/procedures/{proc.pk}/transfer-customer/",
            {
                "target_customer_id": str(self.target.pk),
                "reason": "Employee correction",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        proc.refresh_from_db()
        self.assertEqual(proc.customer_id, self.target.pk)

    def test_cashier_denied(self):
        proc = self._create_procedure(self.source)
        self.client.force_authenticate(self.cashier)
        resp = self.client.post(
            f"/api/procedures/{proc.pk}/transfer-customer/",
            {
                "target_customer_id": str(self.target.pk),
                "reason": "Nope",
            },
            format="json",
        )
        self.assertIn(resp.status_code, (403, 401), resp.content)

    def test_same_customer_rejected(self):
        proc = self._create_procedure(self.source)
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            f"/api/procedures/{proc.pk}/transfer-customer/",
            {
                "target_customer_id": str(self.source.pk),
                "reason": "Same",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_closed_target_rejected(self):
        proc = self._create_procedure(self.source)
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            f"/api/procedures/{proc.pk}/transfer-customer/",
            {
                "target_customer_id": str(self.closed.pk),
                "reason": "Closed target",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_reason_required(self):
        proc = self._create_procedure(self.source)
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            f"/api/procedures/{proc.pk}/transfer-customer/",
            {
                "target_customer_id": str(self.target.pk),
                "reason": "   ",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_procedure_moves_linked_payments(self):
        proc = self._create_procedure(self.source, selling="250.00", paid="0.00")
        pay = self._create_payment(self.source, amount="100.00", procedure=proc)
        self.source.refresh_from_db()
        # +250 from procedure, -100 from payment
        self.assertEqual(self.source.balance, Decimal("150.00"))
        card_before = BankCard.objects.get(pk=self.card.pk).balance

        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            f"/api/procedures/{proc.pk}/transfer-customer/",
            {
                "target_customer_id": str(self.target.pk),
                "reason": "Move with payments",
                "transfer_linked_payments": True,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)

        proc.refresh_from_db()
        pay.refresh_from_db()
        self.source.refresh_from_db()
        self.target.refresh_from_db()
        self.card.refresh_from_db()

        self.assertEqual(proc.customer_id, self.target.pk)
        self.assertEqual(pay.customer_id, self.target.pk)
        self.assertEqual(pay.procedure_id, proc.pk)
        self.assertEqual(self.source.balance, Decimal("0.00"))
        self.assertEqual(self.target.balance, Decimal("150.00"))
        self.assertEqual(self.card.balance, card_before)

    def test_statement_moves_with_procedure(self):
        proc = self._create_procedure(self.source, selling="120.00", paid="0.00", description="X")
        self.client.force_authenticate(self.admin)
        self.client.post(
            f"/api/procedures/{proc.pk}/transfer-customer/",
            {
                "target_customer_id": str(self.target.pk),
                "reason": "Statement check",
            },
            format="json",
        )

        src_summary = self.client.get(f"/api/customers/{self.source.pk}/financial-summary/").json()
        tgt_summary = self.client.get(f"/api/customers/{self.target.pk}/financial-summary/").json()
        self.assertEqual(len(src_summary["procedures"]), 0)
        self.assertEqual(len(tgt_summary["procedures"]), 1)
        self.assertEqual(tgt_summary["procedures"][0]["id"], str(proc.pk))

    def test_payment_apply_updates_procedure_paid(self):
        proc = self._create_procedure(self.source, selling="200.00", paid="0.00")
        self.assertEqual(proc.paid, Decimal("0.00"))
        pay = self._create_payment(self.source, amount="40.00", procedure=proc)
        proc.refresh_from_db()
        self.assertEqual(proc.paid, Decimal("40.00"))
        self.client.force_authenticate(self.admin)
        self.client.delete(f"/api/payments/{pay.pk}/")
        proc.refresh_from_db()
        self.assertEqual(proc.paid, Decimal("0.00"))

    def test_transfer_endpoints_reject_put_delete(self):
        proc = self._create_procedure(self.source)
        self.client.force_authenticate(self.admin)
        url = f"/api/procedures/{proc.pk}/transfer-customer/"
        self.assertEqual(self.client.put(url, {}, format="json").status_code, 405)
        self.assertEqual(self.client.patch(url, {}, format="json").status_code, 405)
        self.assertEqual(self.client.delete(url).status_code, 405)
