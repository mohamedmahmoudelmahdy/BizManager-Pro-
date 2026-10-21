"""Customer payment refunds — balance convention, partials, transfers, reporting."""

from django.db.models import Sum
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from threading import Barrier

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from banking.models import BankCard
from customers.models import Customer
from payments.models import Payment, PaymentRefund
from payments.services.collections import collection_breakdown, net_collected_sum
from payments.services.refunds import balance_display, debt_status_for_balance, refund_payment_atomic
from procedures.models import Procedure
from procedures.services.profitability import collected_revenue_sum

User = get_user_model()


class BalanceSignConventionTests(TestCase):
    def test_sign_labels(self):
        self.assertEqual(debt_status_for_balance(Decimal("-500")), "credit")
        self.assertEqual(debt_status_for_balance(Decimal("0")), "clear")
        self.assertEqual(debt_status_for_balance(Decimal("500")), "in_debt")

        credit = balance_display(Decimal("-500.00"))
        self.assertEqual(credit["absolute_amount"], "500.00")
        self.assertEqual(credit["label"], "credit")
        self.assertEqual(credit["debt_status_display"], "credit")

        debt = balance_display(Decimal("500.00"))
        self.assertEqual(debt["absolute_amount"], "500.00")
        self.assertEqual(debt["label"], "debt")
        self.assertEqual(debt["debt_status_display"], "in_debt")

        settled = balance_display(Decimal("0.00"))
        self.assertEqual(settled["label"], "settled")


class PaymentRefundServiceTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="refund-admin", password="pass", role=User.Roles.ADMIN
        )
        self.employee = User.objects.create_user(
            username="refund-emp", password="pass", role=User.Roles.EMPLOYEE
        )
        self.visa = BankCard.objects.create(
            bank_name="Office Visa",
            cardholder_name="Office",
            card_type="Visa",
            card_number="1111",
            last4="1111",
            expiry_month="12",
            expiry_year="2030",
            method_type=BankCard.MethodType.BANK,
            balance=Decimal("20000.00"),
        )
        self.cash = BankCard.objects.create(
            bank_name="Cash Box",
            cardholder_name="Office",
            card_type="Cash",
            card_number="2222",
            last4="2222",
            expiry_month="12",
            expiry_year="2030",
            method_type=BankCard.MethodType.CASH,
            balance=Decimal("10000.00"),
        )
        # Khalda example: charges 13990, payments 15970 → balance -1980 credit
        self.customer = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="خالده الصادق عبدالكريم",
            phone="0505555001",
            balance=Decimal("-1980.00"),
        )
        self.procedure = Procedure.objects.create(
            customer=self.customer,
            category="تعديل وضع",
            description="Khalda procedure",
            cost=Decimal("1000.00"),
            selling_price=Decimal("13990.00"),
            paid=Decimal("15970.00"),
            status=Procedure.Status.DONE,
            date=date(2026, 8, 1),
        )
        self.payment = Payment.objects.create(
            customer=self.customer,
            procedure=self.procedure,
            amount=Decimal("2480.00"),
            date=date(2026, 8, 5),
            type=Payment.PaymentType.POS,
            bank_card=self.visa,
            recorded_by=self.admin,
            notes="Partial of 15970",
        )
        # Remaining historical payments for totals (not needed as rows for refund target)
        Payment.objects.create(
            customer=self.customer,
            amount=Decimal("13490.00"),
            date=date(2026, 8, 2),
            type=Payment.PaymentType.CASH,
            bank_card=self.cash,
            recorded_by=self.admin,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_khalda_credit_to_debt_after_refund(self):
        """charges 13990 − payments 15970 + refund 2480 = +500 debt."""
        self.assertEqual(self.customer.balance, Decimal("-1980.00"))
        before = balance_display(self.customer.balance)
        self.assertEqual(before["label"], "credit")
        self.assertEqual(before["absolute_amount"], "1980.00")

        result = refund_payment_atomic(
            payment_id=self.payment.pk,
            amount=Decimal("2480.00"),
            payment_method_id=self.cash.pk,  # different method than Office Visa
            date=date(2026, 8, 10),
            reason="Customer refund",
            notes="اختبار",
            created_by=self.admin,
        )

        self.customer.refresh_from_db()
        self.payment.refresh_from_db()
        self.cash.refresh_from_db()
        self.procedure.refresh_from_db()

        self.assertEqual(self.customer.balance, Decimal("500.00"))
        after = balance_display(self.customer.balance)
        self.assertEqual(after["label"], "debt")
        self.assertEqual(after["absolute_amount"], "500.00")
        self.assertEqual(result["balance_after"]["label"], "debt")

        # Original payment immutable
        self.assertEqual(self.payment.amount, Decimal("2480.00"))
        self.assertEqual(Payment.objects.filter(pk=self.payment.pk).count(), 1)

        refund = PaymentRefund.objects.get()
        self.assertEqual(refund.payment_id, self.payment.pk)
        self.assertEqual(refund.amount, Decimal("2480.00"))
        self.assertEqual(refund.payment_method_id, self.cash.pk)
        self.assertEqual(refund.created_by_id, self.admin.pk)
        self.assertEqual(refund.reason, "Customer refund")
        self.assertEqual(refund.notes, "اختبار")

        # Cash out from refund method only (no Expense)
        self.assertEqual(self.cash.balance, Decimal("7520.00"))
        self.assertEqual(self.visa.balance, Decimal("20000.00"))

        # Linked procedure paid reduced
        self.assertEqual(self.procedure.paid, Decimal("13490.00"))

        summary = result["customer_financial_summary"]
        self.assertEqual(summary["totals"]["total_procedure_charges"], "13990.00")
        self.assertEqual(summary["totals"]["total_payments"], "15970.00")
        self.assertEqual(summary["totals"]["total_refunds"], "2480.00")
        self.assertEqual(summary["totals"]["net_collected"], "13490.00")
        self.assertEqual(summary["totals"]["recorded_balance"], "500.00")
        self.assertFalse(summary["totals"]["balance_mismatch"])

        kinds = [row["kind"] for row in summary["statement"]]
        self.assertIn("payment", kinds)
        self.assertIn("refund", kinds)
        refund_row = next(r for r in summary["statement"] if r["kind"] == "refund")
        self.assertEqual(refund_row["debit"], "2480.00")
        self.assertEqual(refund_row["credit"], "0")

    def test_partial_and_multiple_refunds(self):
        refund_payment_atomic(
            payment_id=self.payment.pk,
            amount="1000.00",
            payment_method_id=self.cash.pk,
            date=date(2026, 8, 10),
            reason="Partial 1",
            created_by=self.admin,
        )
        refund_payment_atomic(
            payment_id=self.payment.pk,
            amount="1000.00",
            payment_method_id=self.visa.pk,
            date=date(2026, 8, 11),
            reason="Partial 2",
            created_by=self.admin,
        )
        refund_payment_atomic(
            payment_id=self.payment.pk,
            amount="480.00",
            payment_method_id=self.cash.pk,
            date=date(2026, 8, 12),
            reason="Partial 3",
            created_by=self.admin,
        )
        self.assertEqual(PaymentRefund.objects.filter(payment=self.payment).count(), 3)
        with self.assertRaises(Exception):
            refund_payment_atomic(
                payment_id=self.payment.pk,
                amount="0.01",
                payment_method_id=self.cash.pk,
                date=date(2026, 8, 13),
                reason="Over",
                created_by=self.admin,
            )

    def test_rejects_zero_and_negative(self):
        from rest_framework.exceptions import ValidationError

        with self.assertRaises(ValidationError) as ctx:
            refund_payment_atomic(
                payment_id=self.payment.pk,
                amount="0",
                payment_method_id=self.cash.pk,
                date=date(2026, 8, 10),
                reason="zero",
                created_by=self.admin,
            )
        self.assertEqual(ctx.exception.detail.get("code"), "invalid_refund_amount")

        with self.assertRaises(ValidationError) as ctx2:
            refund_payment_atomic(
                payment_id=self.payment.pk,
                amount="-10",
                payment_method_id=self.cash.pk,
                date=date(2026, 8, 10),
                reason="neg",
                created_by=self.admin,
            )
        self.assertEqual(ctx2.exception.detail.get("code"), "invalid_refund_amount")

    def test_unauthorized_employee_rejected(self):
        from rest_framework.exceptions import PermissionDenied

        with self.assertRaises(PermissionDenied):
            refund_payment_atomic(
                payment_id=self.payment.pk,
                amount="10.00",
                payment_method_id=self.cash.pk,
                date=date(2026, 8, 10),
                reason="nope",
                created_by=self.employee,
            )

    def test_api_refund_endpoint(self):
        res = self.client.post(
            f"/api/payments/{self.payment.pk}/refund/",
            {
                "amount": "2480.00",
                "payment_method": self.cash.pk,
                "date": "2026-08-10",
                "reason": "API refund",
                "notes": "",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertEqual(body["refunded_amount"], "2480.00")
        self.assertEqual(body["refundable_amount"], "0.00")
        self.assertEqual(body["balance_after"]["label"], "debt")
        self.assertEqual(body["customer_financial_summary"]["customer"]["balance"], "500.00")

    def test_employee_api_forbidden(self):
        self.client.force_authenticate(self.employee)
        res = self.client.post(
            f"/api/payments/{self.payment.pk}/refund/",
            {
                "amount": "10.00",
                "payment_method": self.cash.pk,
                "date": "2026-08-10",
                "reason": "no",
            },
            format="json",
        )
        self.assertIn(res.status_code, (403, 400))

    def test_unlinked_payment_refund(self):
        pay = Payment.objects.create(
            customer=self.customer,
            amount=Decimal("100.00"),
            date=date(2026, 8, 6),
            type=Payment.PaymentType.CASH,
            bank_card=self.cash,
            recorded_by=self.admin,
        )
        # Adjust balance as if payment effects were applied (+credit)
        self.customer.balance = Decimal("-2080.00")
        self.customer.save(update_fields=["balance"])
        self.cash.balance = Decimal("10100.00")
        self.cash.save(update_fields=["balance"])

        refund_payment_atomic(
            payment_id=pay.pk,
            amount="40.00",
            payment_method_id=self.visa.pk,
            date=date(2026, 8, 10),
            reason="Unlinked refund",
            created_by=self.admin,
        )
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.balance, Decimal("-2040.00"))
        self.procedure.refresh_from_db()
        self.assertEqual(self.procedure.paid, Decimal("15970.00"))

    def test_transfer_then_refund(self):
        target = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Target",
            phone="0505555002",
            balance=Decimal("0.00"),
        )
        # Simulate ownership move like transfer service would for balances:
        # source loses payment credit effect, target gains it.
        self.customer.balance = Decimal("500.00")  # -1980 + 2480
        self.customer.save(update_fields=["balance"])
        self.payment.customer = target
        self.payment.procedure = None
        self.payment.save(update_fields=["customer", "procedure"])
        target.balance = Decimal("-2480.00")
        target.save(update_fields=["balance"])

        refund_payment_atomic(
            payment_id=self.payment.pk,
            amount="2480.00",
            payment_method_id=self.cash.pk,
            date=date(2026, 8, 10),
            reason="After transfer",
            created_by=self.admin,
        )
        target.refresh_from_db()
        self.customer.refresh_from_db()
        self.assertEqual(target.balance, Decimal("0.00"))
        self.assertEqual(self.customer.balance, Decimal("500.00"))
        refund = PaymentRefund.objects.get(payment=self.payment)
        self.assertEqual(refund.customer_id, target.pk)

    def test_cannot_edit_or_delete_payment_with_refund(self):
        refund_payment_atomic(
            payment_id=self.payment.pk,
            amount="10.00",
            payment_method_id=self.cash.pk,
            date=date(2026, 8, 10),
            reason="lock",
            created_by=self.admin,
        )
        res = self.client.patch(
            f"/api/payments/{self.payment.pk}/",
            {"amount": "1.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        res2 = self.client.delete(f"/api/payments/{self.payment.pk}/")
        self.assertEqual(res2.status_code, 400)
        self.assertTrue(Payment.objects.filter(pk=self.payment.pk).exists())

    def test_collected_revenue_nets_refunds(self):
        refund_payment_atomic(
            payment_id=self.payment.pk,
            amount="2480.00",
            payment_method_id=self.cash.pk,
            date=date(2026, 8, 10),
            reason="net",
            created_by=self.admin,
        )
        breakdown = collection_breakdown([self.customer.pk])
        self.assertEqual(breakdown["gross_collected"], Decimal("15970.00"))
        self.assertEqual(breakdown["refunds"], Decimal("2480.00"))
        self.assertEqual(breakdown["net_collected"], Decimal("13490.00"))
        self.assertEqual(collected_revenue_sum([self.customer.pk]), Decimal("13490.00"))
        self.assertEqual(net_collected_sum([self.customer.pk]), Decimal("13490.00"))

    def test_financial_summary_endpoint_includes_refunds(self):
        refund_payment_atomic(
            payment_id=self.payment.pk,
            amount="2480.00",
            payment_method_id=self.cash.pk,
            date=date(2026, 8, 10),
            reason="summary",
            created_by=self.admin,
        )
        res = self.client.get(f"/api/customers/{self.customer.pk}/financial-summary/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["totals"]["total_refunds"], "2480.00")
        self.assertEqual(body["customer"]["debt_status_display"], "in_debt")
        self.assertTrue(any(r["kind"] == "refund" for r in body["statement"]))


class ConcurrentRefundTests(TransactionTestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="refund-conc-admin", password="pass", role=User.Roles.ADMIN
        )
        self.card = BankCard.objects.create(
            bank_name="Cash",
            cardholder_name="Office",
            card_type="Cash",
            card_number="3333",
            last4="3333",
            expiry_month="12",
            expiry_year="2030",
            method_type=BankCard.MethodType.CASH,
            balance=Decimal("5000.00"),
        )
        self.customer = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Concurrent Cust",
            phone="0505555099",
            balance=Decimal("-2480.00"),
        )
        self.payment = Payment.objects.create(
            customer=self.customer,
            amount=Decimal("2480.00"),
            date=date(2026, 8, 5),
            type=Payment.PaymentType.CASH,
            bank_card=self.card,
            recorded_by=self.admin,
        )

    def test_concurrent_over_refund_prevented(self):
        barrier = Barrier(2)
        results = []

        def attempt(amount: str):
            connection.close()
            barrier.wait()
            try:
                refund_payment_atomic(
                    payment_id=self.payment.pk,
                    amount=amount,
                    payment_method_id=self.card.pk,
                    date=date(2026, 8, 10),
                    reason=f"conc {amount}",
                    created_by=self.admin,
                )
                results.append("ok")
            except Exception:
                results.append("fail")

        with ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(attempt, "2000.00")
            f2 = pool.submit(attempt, "1000.00")
            f1.result()
            f2.result()

        self.assertEqual(results.count("ok"), 1)
        self.assertEqual(results.count("fail"), 1)
        total = PaymentRefund.objects.filter(payment=self.payment).aggregate(t=Sum("amount"))["t"]
        self.assertLessEqual(Decimal(str(total or 0)), Decimal("2480.00"))
        self.assertGreater(Decimal(str(total or 0)), Decimal("0"))
