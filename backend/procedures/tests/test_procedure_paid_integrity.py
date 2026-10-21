"""Phase 2.1: Procedure.paid may only change via Payment / PaymentRefund."""
from datetime import date
from decimal import Decimal
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from banking.models import BankCard
from customers.models import Customer
from dashboard.services.collected_profitability import build_collected_profitability
from payments.models import Payment, PaymentRefund
from payments.services.payment_effects import revert_payment_effects
from payments.services.refunds import refund_payment_atomic
from procedures.models import Procedure
from procedures.serializers import PROCEDURE_PAID_DIRECT_UPDATE_CODE
from procedures.services.create_with_accounting import (
    INITIAL_PAYMENT_NOTE,
    create_procedure_with_accounting,
)

User = get_user_model()


class ProcedurePaidIntegrityTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="paidadmin", password="pass", role=User.Roles.ADMIN
        )
        self.manager = User.objects.create_user(
            username="paidmgr", password="pass", role=User.Roles.MANAGER
        )
        self.customer = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Paid Co",
            company_name="Paid Co",
            balance=Decimal("0.00"),
        )
        self.cash = BankCard.objects.create(
            bank_name="Cash Box",
            cardholder_name="Office",
            card_type="Cash",
            card_number="1111",
            last4="1111",
            expiry_month="12",
            expiry_year="2030",
            method_type=BankCard.MethodType.CASH,
            balance=Decimal("10000.00"),
        )
        self.out = BankCard.objects.create(
            bank_name="Out Box",
            cardholder_name="Office",
            card_type="Cash",
            card_number="2222",
            last4="2222",
            expiry_month="12",
            expiry_year="2030",
            method_type=BankCard.MethodType.CASH,
            balance=Decimal("10000.00"),
        )
        self.client = APIClient()

    def _payload(self, **overrides):
        data = {
            "customer": str(self.customer.pk),
            "category": "Visa Renewal",
            "description": "Integrity test",
            "cost": "50.00",
            "selling_price": "200.00",
            "paid": "0.00",
            "cash_in": "0.00",
            "cash_out_type": self.out.pk,
            "cash_in_type": None,
            "customer_card_mode": False,
            "status": "submitted",
            "assigned_employee": None,
            "date": date.today().isoformat(),
        }
        data.update(overrides)
        return data

    def test_create_paid_zero_no_payment(self):
        self.client.force_authenticate(self.admin)
        cust_before = self.customer.balance
        cash_before = self.cash.balance
        out_before = self.out.balance

        response = self.client.post("/api/procedures/", self._payload(), format="json")
        self.assertEqual(response.status_code, 201, response.content)
        proc = Procedure.objects.get()
        self.assertEqual(proc.paid, Decimal("0.00"))
        self.assertEqual(Payment.objects.filter(procedure=proc).count(), 0)

        self.customer.refresh_from_db()
        self.cash.refresh_from_db()
        self.out.refresh_from_db()
        self.assertEqual(self.customer.balance, cust_before + Decimal("200.00"))
        self.assertEqual(self.cash.balance, cash_before)
        self.assertEqual(self.out.balance, out_before - Decimal("50.00"))

    def test_create_initial_paid_requires_cash_in_type(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/procedures/",
            self._payload(paid="40.00", cash_in="40.00", cash_in_type=None),
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("cash_in_type", response.json())
        self.assertEqual(Procedure.objects.count(), 0)
        self.assertEqual(Payment.objects.count(), 0)

    def test_create_initial_paid_single_payment_and_effects_once(self):
        self.client.force_authenticate(self.admin)
        cust_before = self.customer.balance
        cash_before = self.cash.balance
        out_before = self.out.balance

        response = self.client.post(
            "/api/procedures/",
            self._payload(
                paid="40.00",
                cash_in="40.00",
                cash_in_type=self.cash.pk,
            ),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        proc = Procedure.objects.get()
        payments = list(Payment.objects.filter(procedure=proc))
        self.assertEqual(len(payments), 1)
        self.assertEqual(payments[0].amount, Decimal("40.00"))
        self.assertEqual(payments[0].notes, INITIAL_PAYMENT_NOTE)
        self.assertEqual(proc.paid, Decimal("40.00"))

        self.customer.refresh_from_db()
        self.cash.refresh_from_db()
        self.out.refresh_from_db()
        self.assertEqual(self.out.balance, out_before - Decimal("50.00"))
        self.assertEqual(self.cash.balance, cash_before + Decimal("40.00"))
        self.assertEqual(
            self.customer.balance, cust_before + Decimal("200.00") - Decimal("40.00")
        )

    def test_patch_increase_paid_rejected(self):
        self.client.force_authenticate(self.admin)
        create = self.client.post("/api/procedures/", self._payload(), format="json")
        proc_id = create.json()["id"]

        response = self.client.patch(
            f"/api/procedures/{proc_id}/",
            {"paid": "25.00"},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        body = response.json()
        self.assertEqual(body.get("code"), PROCEDURE_PAID_DIRECT_UPDATE_CODE)
        Procedure.objects.get(pk=proc_id).refresh_from_db()
        self.assertEqual(Procedure.objects.get(pk=proc_id).paid, Decimal("0.00"))
        self.assertEqual(Payment.objects.count(), 0)

    def test_patch_decrease_paid_rejected(self):
        proc = create_procedure_with_accounting(
            user=self.admin,
            validated_data={
                "customer": self.customer,
                "category": "Renewal",
                "cost": Decimal("0.00"),
                "selling_price": Decimal("100.00"),
                "paid": Decimal("30.00"),
                "cash_out_type": None,
                "cash_in_type": self.cash,
                "status": Procedure.Status.SUBMITTED,
                "date": date.today(),
            },
        )
        self.assertEqual(proc.paid, Decimal("30.00"))
        self.client.force_authenticate(self.manager)
        response = self.client.patch(
            f"/api/procedures/{proc.pk}/",
            {"paid": "10.00"},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json().get("code"), PROCEDURE_PAID_DIRECT_UPDATE_CODE)
        proc.refresh_from_db()
        self.assertEqual(proc.paid, Decimal("30.00"))

    def test_put_paid_mutation_rejected(self):
        self.client.force_authenticate(self.admin)
        create = self.client.post("/api/procedures/", self._payload(), format="json")
        data = create.json()
        proc_id = data["id"]
        put_body = {
            "customer": data["customer"],
            "category": data["category"],
            "description": data.get("description") or "",
            "notes": data.get("notes") or "",
            "cost": data["cost"],
            "selling_price": data["selling_price"],
            "cash_in": data.get("cash_in") or "0.00",
            "cash_out_type": data.get("cash_out_type"),
            "cash_in_type": data.get("cash_in_type"),
            "status": data["status"],
            "assigned_employee": data.get("assigned_employee"),
            "date": data["date"],
            "paid": "99.00",
        }
        response = self.client.put(f"/api/procedures/{proc_id}/", put_body, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json().get("code"), PROCEDURE_PAID_DIRECT_UPDATE_CODE)
        self.assertEqual(Procedure.objects.get(pk=proc_id).paid, Decimal("0.00"))

    def test_unrelated_field_patch_preserves_paid(self):
        proc = create_procedure_with_accounting(
            user=self.admin,
            validated_data={
                "customer": self.customer,
                "category": "Renewal",
                "cost": Decimal("0.00"),
                "selling_price": Decimal("100.00"),
                "paid": Decimal("25.00"),
                "cash_out_type": None,
                "cash_in_type": self.cash,
                "status": Procedure.Status.SUBMITTED,
                "date": date.today(),
            },
        )
        cash_before = BankCard.objects.get(pk=self.cash.pk).balance
        cust_before = Customer.objects.get(pk=self.customer.pk).balance

        self.client.force_authenticate(self.admin)
        response = self.client.patch(
            f"/api/procedures/{proc.pk}/",
            {"notes": "status note only", "status": "in-process"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        proc.refresh_from_db()
        self.assertEqual(proc.paid, Decimal("25.00"))
        self.assertEqual(proc.notes, "status note only")
        self.assertEqual(proc.status, Procedure.Status.IN_PROCESS)

        self.cash.refresh_from_db()
        self.customer.refresh_from_db()
        self.assertEqual(self.cash.balance, cash_before)
        self.assertEqual(self.customer.balance, cust_before)

    def test_normal_payment_increases_paid(self):
        self.client.force_authenticate(self.admin)
        create = self.client.post("/api/procedures/", self._payload(), format="json")
        proc_id = create.json()["id"]
        cash_before = self.cash.balance
        cust_before = Customer.objects.get(pk=self.customer.pk).balance

        pay = self.client.post(
            "/api/payments/",
            {
                "amount": "60.00",
                "date": date.today().isoformat(),
                "type": "cash",
                "customer": str(self.customer.pk),
                "procedure": proc_id,
                "bank_card": self.cash.pk,
                "notes": "collection",
            },
            format="json",
        )
        self.assertEqual(pay.status_code, 201, pay.content)
        self.assertEqual(Procedure.objects.get(pk=proc_id).paid, Decimal("60.00"))
        self.cash.refresh_from_db()
        self.customer.refresh_from_db()
        self.assertEqual(self.cash.balance, cash_before + Decimal("60.00"))
        self.assertEqual(self.customer.balance, cust_before - Decimal("60.00"))

    def test_payment_delete_reconciles_paid(self):
        self.client.force_authenticate(self.admin)
        create = self.client.post("/api/procedures/", self._payload(), format="json")
        proc_id = create.json()["id"]
        pay = self.client.post(
            "/api/payments/",
            {
                "amount": "60.00",
                "date": date.today().isoformat(),
                "type": "cash",
                "customer": str(self.customer.pk),
                "procedure": proc_id,
                "bank_card": self.cash.pk,
            },
            format="json",
        )
        payment_id = pay.json()["id"]
        delete = self.client.delete(f"/api/payments/{payment_id}/")
        self.assertEqual(delete.status_code, 204, delete.content)
        self.assertEqual(Procedure.objects.get(pk=proc_id).paid, Decimal("0.00"))

    def test_refund_partial_and_multiple_never_negative(self):
        proc = create_procedure_with_accounting(
            user=self.admin,
            validated_data={
                "customer": self.customer,
                "category": "Renewal",
                "cost": Decimal("0.00"),
                "selling_price": Decimal("100.00"),
                "paid": Decimal("50.00"),
                "cash_out_type": None,
                "cash_in_type": self.cash,
                "status": Procedure.Status.SUBMITTED,
                "date": date.today(),
            },
        )
        payment = Payment.objects.get(procedure=proc)

        refund_payment_atomic(
            payment_id=payment.pk,
            amount=Decimal("20.00"),
            date=date.today(),
            payment_method_id=self.cash.pk,
            reason="partial",
            notes="",
            created_by=self.admin,
        )
        proc.refresh_from_db()
        self.assertEqual(proc.paid, Decimal("30.00"))
        self.assertEqual(PaymentRefund.objects.filter(payment=payment).count(), 1)

        refund_payment_atomic(
            payment_id=payment.pk,
            amount=Decimal("30.00"),
            date=date.today(),
            payment_method_id=self.cash.pk,
            reason="rest",
            notes="",
            created_by=self.admin,
        )
        proc.refresh_from_db()
        self.assertEqual(proc.paid, Decimal("0.00"))
        self.assertGreaterEqual(proc.paid, Decimal("0.00"))

        # Clamp: if stored paid is already 0, revert must not go negative
        orphan = Payment.objects.create(
            amount=Decimal("5.00"),
            date=date.today(),
            type=Payment.PaymentType.CASH,
            customer=self.customer,
            procedure=proc,
            bank_card=self.cash,
            recorded_by=self.admin,
        )
        revert_payment_effects(orphan)
        proc.refresh_from_db()
        self.assertEqual(proc.paid, Decimal("0.00"))

    def test_reports_use_payment_not_procedure_paid(self):
        """Collected profitability must read Payment ledger, not Procedure.paid alone."""
        proc = Procedure.objects.create(
            customer=self.customer,
            category="Legacy",
            cost=Decimal("0.00"),
            selling_price=Decimal("100.00"),
            paid=Decimal("999.00"),  # divergent stored value
            status=Procedure.Status.SUBMITTED,
            date=date(2026, 8, 15),
        )
        payment = Payment.objects.create(
            amount=Decimal("40.00"),
            date=date(2026, 8, 15),
            type=Payment.PaymentType.CASH,
            customer=self.customer,
            procedure=proc,
            bank_card=self.cash,
            recorded_by=self.admin,
        )
        # Do not apply effects — report still sees Payment row
        body = build_collected_profitability("2026-08")
        self.assertEqual(body["gross_collected"], "40.00")
        self.assertNotEqual(body["gross_collected"], "999.00")
        self.assertEqual(payment.amount, Decimal("40.00"))

    def test_audit_command_read_only_reports_difference(self):
        proc = Procedure.objects.create(
            customer=self.customer,
            category="Gap",
            cost=Decimal("0.00"),
            selling_price=Decimal("100.00"),
            paid=Decimal("50.00"),
            status=Procedure.Status.SUBMITTED,
            date=date(2026, 8, 10),
        )
        # No payments → discrepancy
        out = StringIO()
        call_command("audit_initial_paid_gaps", stdout=out)
        text = out.getvalue()
        self.assertIn("Procedure.paid discrepancies: 1", text)
        self.assertIn(str(proc.pk), text)
        self.assertIn("stored_paid=50.00", text)
        self.assertIn("expected_linked_net_paid=0", text)
        self.assertIn("difference=50.00", text)
        # unchanged
        proc.refresh_from_db()
        self.assertEqual(proc.paid, Decimal("50.00"))
        self.assertEqual(Payment.objects.count(), 0)

    def test_manager_cannot_bypass_via_api(self):
        self.client.force_authenticate(self.manager)
        create = self.client.post("/api/procedures/", self._payload(cost="0.00"), format="json")
        self.assertEqual(create.status_code, 201, create.content)
        proc_id = create.json()["id"]
        response = self.client.patch(
            f"/api/procedures/{proc_id}/",
            {"paid": "5.00", "notes": "try bypass"},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json().get("code"), PROCEDURE_PAID_DIRECT_UPDATE_CODE)
        self.assertEqual(Procedure.objects.get(pk=proc_id).paid, Decimal("0.00"))
