from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from banking.models import BankCard
from customers.models import Customer, CustomerFinancialAdjustment
from payments.models import Payment
from procedures.models import Procedure

User = get_user_model()


class CustomerFinancialAdjustmentTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="acct-admin", password="pass", role=User.Roles.ADMIN)
        self.manager = User.objects.create_user(username="acct-manager", password="pass", role=User.Roles.MANAGER)
        self.employee = User.objects.create_user(username="acct-employee", password="pass", role=User.Roles.EMPLOYEE)
        self.customer = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Acme",
            company_name="Acme LLC",
            balance=Decimal("1000.00"),
        )
        self.card = BankCard.objects.create(
            bank_name="Cash Box",
            cardholder_name="Office",
            card_type="Cash",
            card_number="1111",
            last4="1111",
            expiry_month="12",
            expiry_year="2030",
            method_type=BankCard.MethodType.CASH,
            balance=Decimal("500.00"),
        )
        self.client = APIClient()

    def _discount_payload(self, **overrides):
        payload = {
            "adjustment_type": "discount",
            "amount": "200.00",
            "date": date.today().isoformat(),
            "reason": "Goodwill",
            "notes": "Approved by management",
        }
        payload.update(overrides)
        return payload

    def test_direct_discount_reduces_customer_debit_balance(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            f"/api/customers/{self.customer.pk}/financial-adjustments/",
            self._discount_payload(),
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.balance, Decimal("800.00"))
        adjustment = CustomerFinancialAdjustment.objects.get()
        self.assertEqual(adjustment.adjustment_type, "discount")
        self.assertEqual(adjustment.status, "posted")

    def test_direct_discount_does_not_mutate_payment_method_balance(self):
        self.client.force_authenticate(self.admin)
        self.client.post(
            f"/api/customers/{self.customer.pk}/financial-adjustments/",
            self._discount_payload(),
            format="json",
        )

        self.card.refresh_from_db()
        self.assertEqual(self.card.balance, Decimal("500.00"))
        self.assertEqual(Payment.objects.count(), 0)

    def test_customer_statement_shows_direct_discount_credit(self):
        self.client.force_authenticate(self.admin)
        self.client.post(
            f"/api/customers/{self.customer.pk}/financial-adjustments/",
            self._discount_payload(),
            format="json",
        )

        response = self.client.get(f"/api/customers/{self.customer.pk}/financial-summary/")
        self.assertEqual(response.status_code, 200, response.content)
        adjustment_rows = [row for row in response.json()["statement"] if row["kind"] == "adjustment"]
        self.assertEqual(len(adjustment_rows), 1)
        self.assertEqual(adjustment_rows[0]["credit"], "200.00")
        self.assertIn("Direct discount", adjustment_rows[0]["description"])

    def test_discount_exceeding_outstanding_is_blocked(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            f"/api/customers/{self.customer.pk}/financial-adjustments/",
            self._discount_payload(amount="1200.00"),
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.balance, Decimal("1000.00"))

    def test_discount_for_settled_or_credit_customer_is_blocked(self):
        self.client.force_authenticate(self.admin)
        self.customer.balance = Decimal("0.00")
        self.customer.save(update_fields=["balance"])

        settled = self.client.post(
            f"/api/customers/{self.customer.pk}/financial-adjustments/",
            self._discount_payload(amount="1.00"),
            format="json",
        )
        self.assertEqual(settled.status_code, 400, settled.content)

        self.customer.balance = Decimal("-10.00")
        self.customer.save(update_fields=["balance"])
        credit = self.client.post(
            f"/api/customers/{self.customer.pk}/financial-adjustments/",
            self._discount_payload(amount="1.00"),
            format="json",
        )
        self.assertEqual(credit.status_code, 400, credit.content)

    def test_reverse_discount_restores_customer_balance(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            f"/api/customers/{self.customer.pk}/financial-adjustments/",
            self._discount_payload(),
            format="json",
        )
        adjustment_id = response.json()["id"]

        reverse = self.client.post(
            f"/api/customer-financial-adjustments/{adjustment_id}/reverse/",
            {"reason": "Entered in error"},
            format="json",
        )

        self.assertEqual(reverse.status_code, 200, reverse.content)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.balance, Decimal("1000.00"))
        adjustment = CustomerFinancialAdjustment.objects.get(pk=adjustment_id)
        self.assertEqual(adjustment.status, "reversed")

    def test_double_reversal_is_blocked(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            f"/api/customers/{self.customer.pk}/financial-adjustments/",
            self._discount_payload(),
            format="json",
        )
        adjustment_id = response.json()["id"]
        self.client.post(
            f"/api/customer-financial-adjustments/{adjustment_id}/reverse/",
            {"reason": "Entered in error"},
            format="json",
        )

        second = self.client.post(
            f"/api/customer-financial-adjustments/{adjustment_id}/reverse/",
            {"reason": "Again"},
            format="json",
        )

        self.assertEqual(second.status_code, 400, second.content)

    def test_non_authorized_user_cannot_apply_direct_discount(self):
        self.client.force_authenticate(self.employee)
        response = self.client.post(
            f"/api/customers/{self.customer.pk}/financial-adjustments/",
            self._discount_payload(),
            format="json",
        )

        self.assertEqual(response.status_code, 403, response.content)


class CustomerCloseAccountTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="close-admin", password="pass", role=User.Roles.ADMIN)
        self.manager = User.objects.create_user(username="close-manager", password="pass", role=User.Roles.MANAGER)
        self.employee = User.objects.create_user(username="close-employee", password="pass", role=User.Roles.EMPLOYEE)
        self.customer = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Closed Co",
            company_name="Closed Co",
            balance=Decimal("500.00"),
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
            balance=Decimal("500.00"),
        )
        self.client = APIClient()

    def _close(self):
        self.client.force_authenticate(self.manager)
        return self.client.post(
            f"/api/customers/{self.customer.pk}/close-account/",
            {"reason": "Inactive customer"},
            format="json",
        )

    def _procedure_payload(self):
        return {
            "customer": str(self.customer.pk),
            "category": "Visa Renewal",
            "description": "Test procedure",
            "cost": "0.00",
            "selling_price": "100.00",
            "paid": "0.00",
            "cash_in": "0.00",
            "cash_out_type": None,
            "cash_in_type": None,
            "customer_card_mode": False,
            "status": "submitted",
            "assigned_employee": None,
            "date": date.today().isoformat(),
        }

    def _payment_payload(self):
        return {
            "amount": "100.00",
            "date": date.today().isoformat(),
            "type": "cash",
            "customer": str(self.customer.pk),
            "bank_card": self.card.pk,
            "notes": "Receipt",
        }

    def test_close_active_customer(self):
        response = self._close()

        self.assertEqual(response.status_code, 200, response.content)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.account_status, Customer.AccountStatus.CLOSED)
        self.assertEqual(self.customer.closure_reason, "Inactive customer")

    def test_new_procedure_blocked_for_closed_customer(self):
        self._close()
        self.client.force_authenticate(self.admin)

        response = self.client.post("/api/procedures/", self._procedure_payload(), format="json")

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(Procedure.objects.count(), 0)

    def test_new_payment_blocked_for_closed_customer(self):
        self._close()
        self.client.force_authenticate(self.admin)

        response = self.client.post("/api/payments/", self._payment_payload(), format="json")

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(Payment.objects.count(), 0)

    def test_direct_discount_blocked_for_closed_customer(self):
        self._close()
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            f"/api/customers/{self.customer.pk}/financial-adjustments/",
            {
                "adjustment_type": "discount",
                "amount": "100.00",
                "date": date.today().isoformat(),
                "reason": "Goodwill",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)

    def test_history_profile_and_statement_remain_visible_for_closed_customer(self):
        self._close()
        self.client.force_authenticate(self.admin)

        list_response = self.client.get("/api/customers/")
        detail_response = self.client.get(f"/api/customers/{self.customer.pk}/")
        summary_response = self.client.get(f"/api/customers/{self.customer.pk}/financial-summary/")

        self.assertEqual(list_response.status_code, 200, list_response.content)
        self.assertEqual(detail_response.status_code, 200, detail_response.content)
        self.assertEqual(summary_response.status_code, 200, summary_response.content)
        self.assertEqual(summary_response.json()["customer"]["account_status"], "closed")

    def test_reopen_customer(self):
        self._close()
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            f"/api/customers/{self.customer.pk}/reopen-account/",
            {"reason": "Customer returned"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.account_status, Customer.AccountStatus.ACTIVE)

    def test_new_procedure_and_payment_work_after_reopen(self):
        self._close()
        self.client.force_authenticate(self.admin)
        self.client.post(
            f"/api/customers/{self.customer.pk}/reopen-account/",
            {"reason": "Customer returned"},
            format="json",
        )

        procedure = self.client.post("/api/procedures/", self._procedure_payload(), format="json")
        payment = self.client.post("/api/payments/", self._payment_payload(), format="json")

        self.assertEqual(procedure.status_code, 201, procedure.content)
        self.assertEqual(payment.status_code, 201, payment.content)

    def test_backend_blocks_closed_account_even_if_frontend_is_bypassed(self):
        self._close()
        self.client.force_authenticate(self.employee)

        response = self.client.post("/api/procedures/", self._procedure_payload(), format="json")

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("closed", str(response.content).lower())
