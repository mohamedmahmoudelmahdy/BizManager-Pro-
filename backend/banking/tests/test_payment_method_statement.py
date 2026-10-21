from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from banking.models import BankCard
from banking.services.payment_method_statement import build_payment_method_statement
from customers.models import Customer
from expenses.models import Expense
from payments.models import Payment
from procedures.models import Procedure

User = get_user_model()


class PaymentMethodStatementTests(TestCase):
    def setUp(self):
        self.card = BankCard.objects.create(
            bank_name="Test Cash",
            cardholder_name="Office",
            card_number="1234567890123456",
            expiry_month="12",
            expiry_year="2030",
            method_type="cash",
            balance=Decimal("1000.00"),
        )
        self.customer = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Ahmed",
            phone="0500000000",
        )

    def test_procedure_cash_out_uses_cost_not_selling_price(self):
        Procedure.objects.create(
            customer=self.customer,
            category="Visa",
            cost=Decimal("300.00"),
            selling_price=Decimal("1000.00"),
            cash_out_type=self.card,
            paid=Decimal("0"),
            date=date(2025, 6, 1),
        )
        result = build_payment_method_statement(self.card)
        cash_out_rows = [r for r in result["rows"] if r["source_type"] == "procedure_cash_out"]
        self.assertEqual(len(cash_out_rows), 1)
        self.assertEqual(cash_out_rows[0]["money_out"], "300.00")
        self.assertEqual(result["totals"]["money_out"], "300.00")

    def test_customer_payment_money_in(self):
        Payment.objects.create(
            amount=Decimal("500.00"),
            date=date(2025, 6, 2),
            type="cash",
            customer=self.customer,
            bank_card=self.card,
        )
        result = build_payment_method_statement(self.card)
        pay_rows = [r for r in result["rows"] if r["source_type"] == "customer_payment"]
        self.assertEqual(len(pay_rows), 1)
        self.assertEqual(pay_rows[0]["money_in"], "500.00")

    def test_expense_money_out(self):
        Expense.objects.create(
            category=Expense.Category.OFFICE,
            date=date(2025, 6, 3),
            amount=Decimal("200.00"),
            paid_by=self.card,
            notes="Office supplies",
        )
        result = build_payment_method_statement(self.card)
        exp_rows = [r for r in result["rows"] if r["source_type"] == "expense"]
        self.assertEqual(len(exp_rows), 1)
        self.assertEqual(exp_rows[0]["money_out"], "200.00")
