"""Tests for salary payment reversal."""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import EmployeeProfile
from accounts.services.pay_salary import execute_salary_payment, reverse_salary_payment, salary_settlement_status
from banking.models import BankCard
from expenses.models import Expense
from financial_control.models import EmployeeAdvance, EmployeeAdvanceDeduction
from financial_control.services import employee_advances as advances_svc

User = get_user_model()


class ReverseSalaryPaymentTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="admin1", password="pass", role=User.Roles.ADMIN)
        self.manager = User.objects.create_user(username="mgr1", password="pass", role=User.Roles.MANAGER)
        self.employee_user = User.objects.create_user(
            username="emp1", password="pass", role=User.Roles.EMPLOYEE
        )
        self.profile = EmployeeProfile.objects.create(
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
        self.period = "2026-06"
        self.client = APIClient()

    def _pay(self, **kwargs):
        return execute_salary_payment(
            profile=self.profile,
            period_key=self.period,
            paid_by_id=self.card.id,
            created_by=self.admin,
            **kwargs,
        )

    def test_full_salary_reverse_restores_bank_and_pending(self):
        expense, _ = self._pay(payment_mode="full")
        bank_after_pay = Decimal("95000.00")
        self.card.refresh_from_db()
        self.assertEqual(self.card.balance, bank_after_pay)

        reversed_expense, settlement = reverse_salary_payment(
            expense, self.profile, self.admin, reason="Wrong period"
        )
        self.card.refresh_from_db()
        self.assertEqual(reversed_expense.payroll_status, Expense.PayrollStatus.REVERSED)
        self.assertEqual(self.card.balance, Decimal("100000.00"))
        self.assertEqual(settlement["salary_status"], "pending")
        self.assertFalse(settlement["salary_paid"])

    def test_partial_salary_reverse_recalculates_remaining(self):
        expense, _ = self._pay(payment_mode="partial", paid_amount_input=2000)
        reverse_salary_payment(expense, self.profile, self.admin, reason="Correction")
        status = salary_settlement_status(self.employee_user, self.profile, self.period)
        self.assertEqual(status["salary_status"], "pending")
        self.assertEqual(status["salary_remaining_due"], 5000.0)

    def test_salary_with_advance_deduction_reverse_reopens_advance(self):
        advances_svc.give_advance(
            employee_user=self.employee_user,
            amount=1000,
            paid_by_id=self.card.id,
            created_by=self.admin,
        )
        expense, _ = self._pay(payment_mode="full")
        self.assertEqual(
            EmployeeAdvance.objects.filter(employee=self.employee_user, status="settled").count(),
            1,
        )
        reverse_salary_payment(expense, self.profile, self.admin, reason="Wrong month")
        advance = EmployeeAdvance.objects.get(employee=self.employee_user)
        self.assertEqual(advance.status, EmployeeAdvance.Status.ACTIVE)
        self.assertEqual(advance.outstanding_balance, Decimal("1000.00"))
        self.assertFalse(
            EmployeeAdvanceDeduction.objects.filter(
                linked_salary_expense=expense, status="active"
            ).exists()
        )

    def test_salary_with_manual_deduction_reverse(self):
        expense, _ = self._pay(
            payment_mode="full",
            manual_deduction_amount=200,
            manual_deduction_reason="Absence",
        )
        reverse_salary_payment(expense, self.profile, self.admin, reason="Fix")
        status = salary_settlement_status(self.employee_user, self.profile, self.period)
        self.assertEqual(status["salary_status"], "pending")

    def test_double_reverse_blocked(self):
        expense, _ = self._pay(payment_mode="full")
        reverse_salary_payment(expense, self.profile, self.admin, reason="Once")
        with self.assertRaises(ValueError):
            reverse_salary_payment(expense, self.profile, self.admin, reason="Twice")

    def test_api_non_admin_blocked(self):
        expense, _ = self._pay(payment_mode="full")
        self.client.force_authenticate(user=self.manager)
        response = self.client.post(
            f"/api/employees/{self.profile.id}/salary-payments/{expense.id}/reverse/",
            {"reason": "Test"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_api_admin_reverse(self):
        expense, _ = self._pay(payment_mode="full")
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(
            f"/api/employees/{self.profile.id}/salary-payments/{expense.id}/reverse/",
            {"reason": "Wrong period"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["payroll_status"], "reversed")
