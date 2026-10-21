"""Tests for employee advance direct repayment."""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import EmployeeProfile
from banking.models import BankCard
from banking.services.payment_method_statement import build_payment_method_statement
from financial_control.models import EmployeeAdvance, EmployeeAdvanceRepayment, LedgerEntry
from financial_control.services import employee_advances as advances_svc

User = get_user_model()


class AdvanceRepaymentTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="admin1", password="pass", role=User.Roles.ADMIN)
        self.employee_user = User.objects.create_user(
            username="emp1", password="pass", role=User.Roles.EMPLOYEE
        )
        EmployeeProfile.objects.create(
            user=self.employee_user,
            full_name="Test Employee",
            salary=Decimal("5000.00"),
        )
        self.card = BankCard.objects.create(
            bank_name="Main Cash",
            cardholder_name="Office",
            card_type="Cash",
            card_number="0001",
            last4="0001",
            expiry_month="12",
            expiry_year="2030",
            balance=Decimal("100000.00"),
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def _give_advance(self, amount):
        return advances_svc.give_advance(
            employee_user=self.employee_user,
            amount=amount,
            paid_by_id=self.card.id,
            created_by=self.admin,
        )

    def test_repayment_increases_cash_and_reduces_outstanding(self):
        self._give_advance(7265)
        self.card.refresh_from_db()
        balance_before = self.card.balance

        result = advances_svc.record_advance_repayment(
            employee_user=self.employee_user,
            amount=2000,
            payment_method_id=self.card.id,
            created_by=self.admin,
            notes="Cash repayment",
        )
        self.card.refresh_from_db()
        advance = EmployeeAdvance.objects.get(employee=self.employee_user)
        self.assertEqual(self.card.balance, balance_before + Decimal("2000.00"))
        self.assertEqual(advance.outstanding_balance, Decimal("5265.00"))
        self.assertEqual(len(result["repayments"]), 1)
        self.assertEqual(result["repayments"][0].amount, Decimal("2000.00"))

    def test_fifo_repayment_across_multiple_advances(self):
        self._give_advance(1000)
        advances_svc.give_advance(
            employee_user=self.employee_user,
            amount=500,
            paid_by_id=self.card.id,
            created_by=self.admin,
            date=timezone.localdate(),
        )
        result = advances_svc.record_advance_repayment(
            employee_user=self.employee_user,
            amount=1200,
            payment_method_id=self.card.id,
            created_by=self.admin,
        )
        advances = list(
            EmployeeAdvance.objects.filter(employee=self.employee_user).order_by("date", "created_at")
        )
        self.assertEqual(advances[0].status, EmployeeAdvance.Status.SETTLED)
        self.assertEqual(advances[0].outstanding_balance, Decimal("0.00"))
        self.assertEqual(advances[1].outstanding_balance, Decimal("300.00"))
        self.assertEqual(len(result["repayments"]), 2)

    def test_overpayment_blocked(self):
        self._give_advance(1000)
        with self.assertRaises(ValueError):
            advances_svc.record_advance_repayment(
                employee_user=self.employee_user,
                amount=1500,
                payment_method_id=self.card.id,
                created_by=self.admin,
            )

    def test_ledger_credit_created(self):
        self._give_advance(1000)
        result = advances_svc.record_advance_repayment(
            employee_user=self.employee_user,
            amount=500,
            payment_method_id=self.card.id,
            created_by=self.admin,
        )
        entry = result["ledger_entry"]
        self.assertEqual(entry.entry_type, LedgerEntry.EntryType.CREDIT)
        self.assertEqual(entry.amount, Decimal("500.00"))
        self.assertEqual(entry.source_type, LedgerEntry.SourceType.PAYROLL)

    def test_statement_shows_money_in(self):
        self._give_advance(1000)
        advances_svc.record_advance_repayment(
            employee_user=self.employee_user,
            amount=200,
            payment_method_id=self.card.id,
            created_by=self.admin,
        )
        statement = build_payment_method_statement(self.card)
        repay_rows = [r for r in statement["rows"] if r["source_type"] == "advance_repayment"]
        self.assertEqual(len(repay_rows), 1)
        self.assertEqual(repay_rows[0]["money_in"], "200.00")

    def test_api_repayment(self):
        self._give_advance(1000)
        response = self.client.post(
            "/api/employee-advances/repayments/",
            {
                "employee": self.employee_user.id,
                "amount": "300",
                "payment_method": str(self.card.id),
                "date": timezone.localdate().isoformat(),
                "notes": "Partial payback",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(EmployeeAdvanceRepayment.objects.count(), 1)
