"""Hybrid Model D — procedure profitability + separate customer collections."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from banking.models import BankCard
from customers.models import Customer
from dashboard.services.collected_profitability import (
    build_collected_profitability,
    procedure_costs_incurred,
    procedure_revenue,
)
from dashboard.services.expense_reporting import operating_expenses_total
from expenses.models import Expense
from payments.models import Payment
from payments.services.payment_effects import apply_payment_effects
from payments.services.refunds import refund_payment_atomic
from procedures.models import Procedure
from procedures.services.create_with_accounting import create_procedure_with_accounting

User = get_user_model()


class HybridProfitabilityTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="hyb_admin", password="pass", role=User.Roles.ADMIN
        )
        self.customer = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Hybrid Cust",
            balance=Decimal("0.00"),
        )
        self.cash = BankCard.objects.create(
            bank_name="Cash",
            cardholder_name="Office",
            card_type="Cash",
            card_number="1111",
            last4="1111",
            expiry_month="12",
            expiry_year="2030",
            method_type=BankCard.MethodType.CASH,
            balance=Decimal("100000.00"),
        )
        self.out = BankCard.objects.create(
            bank_name="Out",
            cardholder_name="Office",
            card_type="Cash",
            card_number="2222",
            last4="2222",
            expiry_month="12",
            expiry_year="2030",
            method_type=BankCard.MethodType.CASH,
            balance=Decimal("100000.00"),
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _pay(self, amount, pdate, *, procedure=None):
        payment = Payment.objects.create(
            amount=Decimal(str(amount)),
            date=pdate,
            type=Payment.PaymentType.CASH,
            customer=self.customer,
            procedure=procedure,
            bank_card=self.cash,
            recorded_by=self.admin,
        )
        apply_payment_effects(payment)
        return payment

    def test_advance_august_then_procedure_september(self):
        self.assertEqual(self.customer.balance, Decimal("0.00"))
        self._pay("5000.00", date(2026, 8, 10), procedure=None)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.balance, Decimal("-5000.00"))

        aug = build_collected_profitability("2026-08")
        self.assertEqual(aug["profitability"]["procedure_revenue"], "0.00")
        self.assertEqual(aug["profitability"]["procedure_costs_incurred"], "0.00")
        self.assertEqual(aug["profitability"]["operating_profit"], "0.00")
        self.assertIsNone(aug["profitability"]["profit_margin"])
        self.assertEqual(aug["collections"]["net_customer_collections"], "5000.00")
        self.assertEqual(aug["collections"]["customer_level_collections"], "5000.00")

        proc = create_procedure_with_accounting(
            user=self.admin,
            validated_data={
                "customer": self.customer,
                "category": "Visa",
                "cost": Decimal("4500.00"),
                "selling_price": Decimal("5000.00"),
                "paid": Decimal("0.00"),
                "cash_out_type": self.out,
                "cash_in_type": None,
                "status": Procedure.Status.SUBMITTED,
                "date": date(2026, 9, 5),
            },
        )
        self.customer.refresh_from_db()
        proc.refresh_from_db()
        self.assertEqual(self.customer.balance, Decimal("0.00"))
        self.assertEqual(proc.paid, Decimal("0.00"))

        sep = build_collected_profitability("2026-09")
        self.assertEqual(sep["profitability"]["procedure_revenue"], "5000.00")
        self.assertEqual(sep["profitability"]["procedure_costs_incurred"], "4500.00")
        self.assertEqual(sep["profitability"]["operating_profit"], "500.00")
        self.assertEqual(sep["profitability"]["profit_margin"], "10.00")
        self.assertEqual(sep["collections"]["net_customer_collections"], "0.00")

    def test_customer_level_payment_against_debt_not_credit(self):
        create_procedure_with_accounting(
            user=self.admin,
            validated_data={
                "customer": self.customer,
                "category": "A",
                "cost": Decimal("0.00"),
                "selling_price": Decimal("5000.00"),
                "paid": Decimal("0.00"),
                "cash_out_type": None,
                "status": Procedure.Status.SUBMITTED,
                "date": date(2026, 8, 1),
            },
        )
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.balance, Decimal("5000.00"))

        self._pay("3000.00", date(2026, 8, 15), procedure=None)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.balance, Decimal("2000.00"))  # still debt

        body = build_collected_profitability("2026-08")
        self.assertEqual(body["collections"]["customer_level_collections"], "3000.00")
        self.assertEqual(body["profitability"]["procedure_revenue"], "5000.00")
        # Profitability independent of link
        self.assertEqual(body["profitability"]["operating_profit"], "5000.00")

    def test_overpayment_creates_credit_from_balance_not_full_payment(self):
        create_procedure_with_accounting(
            user=self.admin,
            validated_data={
                "customer": self.customer,
                "category": "B",
                "cost": Decimal("0.00"),
                "selling_price": Decimal("2000.00"),
                "paid": Decimal("0.00"),
                "cash_out_type": None,
                "status": Procedure.Status.SUBMITTED,
                "date": date(2026, 8, 1),
            },
        )
        self._pay("5000.00", date(2026, 8, 20), procedure=None)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.balance, Decimal("-3000.00"))
        # Collections still report full 5000 cash; true credit is balance < 0 only
        body = build_collected_profitability("2026-08")
        self.assertEqual(body["collections"]["customer_level_collections"], "5000.00")
        self.assertEqual(body["collections"]["net_customer_collections"], "5000.00")

    def test_selling_and_cost_by_procedure_date(self):
        create_procedure_with_accounting(
            user=self.admin,
            validated_data={
                "customer": self.customer,
                "category": "Visa",
                "cost": Decimal("6000.00"),
                "selling_price": Decimal("10000.00"),
                "paid": Decimal("0.00"),
                "cash_out_type": self.out,
                "status": Procedure.Status.DONE,
                "date": date(2026, 8, 20),
            },
        )
        self.assertEqual(procedure_revenue(date(2026, 8, 1), date(2026, 8, 31)), Decimal("10000.00"))
        self.assertEqual(procedure_costs_incurred(date(2026, 8, 1), date(2026, 8, 31)), Decimal("6000.00"))
        self.assertEqual(procedure_revenue(date(2026, 9, 1), date(2026, 9, 30)), Decimal("0.00"))

    def test_unpaid_procedure_still_contributes_revenue_and_cost(self):
        create_procedure_with_accounting(
            user=self.admin,
            validated_data={
                "customer": self.customer,
                "category": "Visa",
                "cost": Decimal("4500.00"),
                "selling_price": Decimal("5000.00"),
                "paid": Decimal("0.00"),
                "cash_out_type": self.out,
                "status": Procedure.Status.SUBMITTED,
                "date": date(2026, 8, 1),
            },
        )
        self.assertEqual(Payment.objects.count(), 0)
        body = build_collected_profitability("2026-08")
        self.assertEqual(body["procedure_revenue"], "5000.00")
        self.assertEqual(body["procedure_costs_incurred"], "4500.00")
        self.assertEqual(body["operating_profit"], "500.00")
        self.assertEqual(body["net_collected"], "0.00")

    def test_payment_after_procedure_does_not_move_revenue(self):
        create_procedure_with_accounting(
            user=self.admin,
            validated_data={
                "customer": self.customer,
                "category": "Visa",
                "cost": Decimal("100.00"),
                "selling_price": Decimal("1000.00"),
                "paid": Decimal("0.00"),
                "cash_out_type": self.out,
                "status": Procedure.Status.SUBMITTED,
                "date": date(2026, 8, 1),
            },
        )
        self._pay("1000.00", date(2026, 9, 10), procedure=None)
        aug = build_collected_profitability("2026-08")
        sep = build_collected_profitability("2026-09")
        self.assertEqual(aug["procedure_revenue"], "1000.00")
        self.assertEqual(aug["net_collected"], "0.00")
        self.assertEqual(sep["procedure_revenue"], "0.00")
        self.assertEqual(sep["net_collected"], "1000.00")

    def test_linked_vs_customer_level_collections(self):
        proc = create_procedure_with_accounting(
            user=self.admin,
            validated_data={
                "customer": self.customer,
                "category": "Visa",
                "cost": Decimal("0.00"),
                "selling_price": Decimal("100.00"),
                "paid": Decimal("0.00"),
                "cash_out_type": None,
                "status": Procedure.Status.SUBMITTED,
                "date": date(2026, 8, 1),
            },
        )
        self._pay("40.00", date(2026, 8, 5), procedure=proc)
        self._pay("60.00", date(2026, 8, 6), procedure=None)
        body = build_collected_profitability("2026-08")
        self.assertEqual(body["collections"]["procedure_linked_collections"], "40.00")
        self.assertEqual(body["collections"]["customer_level_collections"], "60.00")
        self.assertEqual(body["collections"]["net_customer_collections"], "100.00")

    def test_refund_affects_collections_not_procedure_revenue(self):
        proc = create_procedure_with_accounting(
            user=self.admin,
            validated_data={
                "customer": self.customer,
                "category": "Visa",
                "cost": Decimal("100.00"),
                "selling_price": Decimal("1000.00"),
                "paid": Decimal("0.00"),
                "cash_out_type": self.out,
                "status": Procedure.Status.SUBMITTED,
                "date": date(2026, 8, 1),
            },
        )
        pay = self._pay("1000.00", date(2026, 8, 10), procedure=proc)
        refund_payment_atomic(
            payment_id=pay.pk,
            amount="200.00",
            payment_method_id=self.cash.pk,
            date=date(2026, 9, 5),
            reason="Partial",
            created_by=self.admin,
        )
        aug = build_collected_profitability("2026-08")
        sep = build_collected_profitability("2026-09")
        self.assertEqual(aug["procedure_revenue"], "1000.00")
        self.assertEqual(aug["procedure_costs_incurred"], "100.00")
        self.assertEqual(aug["net_collected"], "1000.00")
        self.assertEqual(sep["procedure_revenue"], "0.00")
        self.assertEqual(sep["collections"]["refunds"], "200.00")
        self.assertEqual(sep["collections"]["net_customer_collections"], "-200.00")

    def test_payroll_and_reversed_payroll(self):
        Expense.objects.create(
            category=Expense.Category.OFFICE,
            date=date(2026, 8, 10),
            amount=Decimal("100.00"),
            paid_by=self.cash,
        )
        Expense.objects.create(
            category=Expense.Category.SALARIES,
            date=date(2026, 9, 14),
            amount=Decimal("1000.00"),
            paid_by=self.cash,
            assigned_employee=self.admin,
            payroll_type=Expense.PayrollType.SALARY,
            payroll_period=date(2026, 8, 1),
        )
        Expense.objects.create(
            category=Expense.Category.SALARIES,
            date=date(2026, 9, 14),
            amount=Decimal("500.00"),
            paid_by=self.cash,
            assigned_employee=self.admin,
            payroll_type=Expense.PayrollType.SALARY,
            payroll_period=date(2026, 8, 1),
            payroll_status=Expense.PayrollStatus.REVERSED,
        )
        self.assertEqual(operating_expenses_total(date(2026, 8, 1), date(2026, 8, 31)), Decimal("1100.00"))
        self.assertEqual(operating_expenses_total(date(2026, 9, 1), date(2026, 9, 30)), Decimal("0.00"))

    def test_negative_operating_profit_and_zero_revenue_margin(self):
        create_procedure_with_accounting(
            user=self.admin,
            validated_data={
                "customer": self.customer,
                "category": "Loss",
                "cost": Decimal("800.00"),
                "selling_price": Decimal("100.00"),
                "paid": Decimal("0.00"),
                "cash_out_type": self.out,
                "status": Procedure.Status.SUBMITTED,
                "date": date(2026, 8, 1),
            },
        )
        body = build_collected_profitability("2026-08")
        self.assertEqual(body["operating_profit"], "-700.00")
        self.assertEqual(body["profit_margin"], "-700.00")

        empty = build_collected_profitability("2026-10")
        self.assertEqual(empty["procedure_revenue"], "0.00")
        self.assertIsNone(empty["profit_margin"])

    def test_invariants_and_api_read_only(self):
        create_procedure_with_accounting(
            user=self.admin,
            validated_data={
                "customer": self.customer,
                "category": "Visa",
                "cost": Decimal("400.00"),
                "selling_price": Decimal("1000.00"),
                "paid": Decimal("0.00"),
                "cash_out_type": self.out,
                "status": Procedure.Status.SUBMITTED,
                "date": date(2026, 8, 1),
            },
        )
        self._pay("250.00", date(2026, 8, 5), procedure=None)
        Expense.objects.create(
            category=Expense.Category.MISC,
            date=date(2026, 8, 20),
            amount=Decimal("50.00"),
            paid_by=self.cash,
        )
        pay_count = Payment.objects.count()
        cust_bal = Customer.objects.get(pk=self.customer.pk).balance

        body = build_collected_profitability("2026-08")
        rev = Decimal(body["profitability"]["procedure_revenue"])
        cost = Decimal(body["profitability"]["procedure_costs_incurred"])
        opex = Decimal(body["profitability"]["operating_expenses"])
        profit = Decimal(body["profitability"]["operating_profit"])
        self.assertEqual(rev - cost - opex, profit)

        gross = Decimal(body["collections"]["gross_customer_collections"])
        refunds = Decimal(body["collections"]["refunds"])
        net = Decimal(body["collections"]["net_customer_collections"])
        self.assertEqual(gross - refunds, net)
        linked = Decimal(body["collections"]["procedure_linked_collections"])
        cust_lvl = Decimal(body["collections"]["customer_level_collections"])
        self.assertEqual(linked + cust_lvl, net)

        dist = sum(Decimal(r["total"]) for r in body["expense_distribution"])
        self.assertEqual(dist, opex)
        cat_rev = sum(Decimal(r["total"]) for r in body["procedure_revenue_by_category"])
        self.assertEqual(cat_rev, rev)

        # Collections != procedure revenue is legitimate
        self.assertNotEqual(net, rev)

        res = self.client.get("/api/reports/collected-profitability/?month=2026-08")
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()
        self.assertEqual(data["profitability"]["operating_profit"], body["operating_profit"])
        self.assertEqual(data["collections"]["net_customer_collections"], body["net_collected"])
        self.assertEqual(Payment.objects.count(), pay_count)
        self.assertEqual(Customer.objects.get(pk=self.customer.pk).balance, cust_bal)

    def test_api_requires_auth(self):
        self.client.force_authenticate(None)
        res = self.client.get("/api/reports/collected-profitability/?month=2026-08")
        self.assertIn(res.status_code, (401, 403))
