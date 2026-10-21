from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import EmployeeProfile
from accounts.services.pay_salary import compute_salary_payment, execute_salary_payment, salary_settlement_status
from banking.models import BankCard
from expenses.models import Expense
from financial_control.models import EmployeeAdvance
from financial_control.services import employee_advances as advances_svc

User = get_user_model()


class PaySalaryTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="admin1", password="pass", role=User.Roles.ADMIN)
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
        self.client.force_authenticate(user=self.admin)

    def _pay_url(self):
        return f"/api/employees/{self.profile.id}/pay-salary/"

    def _base_payload(self, **overrides):
        payload = {
            "period": self.period,
            "paid_by": str(self.card.id),
            "date": timezone.localdate().isoformat(),
            "payment_mode": "full",
        }
        payload.update(overrides)
        return payload

    def test_full_salary_no_deductions(self):
        expense, result = execute_salary_payment(
            profile=self.profile,
            period_key=self.period,
            paid_by_id=self.card.id,
            payment_mode="full",
            created_by=self.admin,
        )
        self.assertEqual(expense.amount, Decimal("5000.00"))
        self.assertEqual(result["paid_amount"], "5000.00")
        self.card.refresh_from_db()
        self.assertEqual(self.card.balance, Decimal("95000.00"))
        status = salary_settlement_status(self.employee_user, self.profile, self.period)
        self.assertEqual(status["salary_status"], "paid")

    def test_full_salary_with_manual_deduction(self):
        expense, result = execute_salary_payment(
            profile=self.profile,
            period_key=self.period,
            paid_by_id=self.card.id,
            payment_mode="full",
            manual_deduction_amount=200,
            manual_deduction_reason="Absence",
            created_by=self.admin,
        )
        self.assertEqual(expense.amount, Decimal("4800.00"))
        self.assertEqual(expense.salary_manual_deduction, Decimal("200.00"))
        self.assertEqual(result["remaining_salary_due"], "0.00")

    def test_partial_salary_no_deductions(self):
        expense, result = execute_salary_payment(
            profile=self.profile,
            period_key=self.period,
            paid_by_id=self.card.id,
            payment_mode="partial",
            paid_amount_input=2000,
            created_by=self.admin,
        )
        self.assertEqual(expense.amount, Decimal("2000.00"))
        self.assertEqual(result["remaining_salary_due"], "3000.00")
        status = salary_settlement_status(self.employee_user, self.profile, self.period)
        self.assertEqual(status["salary_status"], "partial")
        self.assertEqual(status["salary_remaining_due"], 3000.0)

    def test_partial_salary_with_manual_deduction(self):
        expense, _ = execute_salary_payment(
            profile=self.profile,
            period_key=self.period,
            paid_by_id=self.card.id,
            payment_mode="partial",
            paid_amount_input=2000,
            manual_deduction_amount=200,
            manual_deduction_reason="Penalty",
            created_by=self.admin,
        )
        self.assertEqual(expense.amount, Decimal("2000.00"))
        self.assertEqual(expense.salary_manual_deduction, Decimal("200.00"))
        status = salary_settlement_status(self.employee_user, self.profile, self.period)
        self.assertEqual(status["salary_remaining_due"], 2800.0)

    def test_full_salary_with_outstanding_advance(self):
        advances_svc.give_advance(
            employee_user=self.employee_user,
            amount=1000,
            paid_by_id=self.card.id,
            created_by=self.admin,
        )
        expense, result = execute_salary_payment(
            profile=self.profile,
            period_key=self.period,
            paid_by_id=self.card.id,
            payment_mode="full",
            created_by=self.admin,
        )
        self.assertEqual(expense.amount, Decimal("4000.00"))
        self.assertEqual(expense.salary_advance_deduction, Decimal("1000.00"))
        self.assertEqual(result["advance_deduction"], "1000.00")
        self.assertEqual(
            EmployeeAdvance.objects.filter(employee=self.employee_user, status="settled").count(),
            1,
        )

    def test_partial_salary_with_outstanding_advance(self):
        advances_svc.give_advance(
            employee_user=self.employee_user,
            amount=1000,
            paid_by_id=self.card.id,
            created_by=self.admin,
        )
        expense, result = execute_salary_payment(
            profile=self.profile,
            period_key=self.period,
            paid_by_id=self.card.id,
            payment_mode="partial",
            paid_amount_input=2000,
            created_by=self.admin,
        )
        self.assertEqual(expense.amount, Decimal("2000.00"))
        self.assertEqual(expense.salary_advance_deduction, Decimal("1000.00"))
        self.assertEqual(result["remaining_salary_due"], "2000.00")

    def test_duplicate_full_payment_blocked(self):
        execute_salary_payment(
            profile=self.profile,
            period_key=self.period,
            paid_by_id=self.card.id,
            payment_mode="full",
            created_by=self.admin,
        )
        response = self.client.post(self._pay_url(), self._base_payload(), format="json")
        self.assertEqual(response.status_code, 409)

    def test_multiple_partial_payments_until_paid(self):
        self.client.post(
            self._pay_url(),
            self._base_payload(payment_mode="partial", paid_amount=2000),
            format="json",
        )
        self.client.post(
            self._pay_url(),
            self._base_payload(payment_mode="partial", paid_amount=3000),
            format="json",
        )
        status = salary_settlement_status(self.employee_user, self.profile, self.period)
        self.assertEqual(status["salary_status"], "paid")
        self.assertEqual(
            Expense.objects.filter(
                assigned_employee=self.employee_user,
                payroll_type=Expense.PayrollType.SALARY,
            ).count(),
            2,
        )

    def test_payment_method_debited_only_by_paid_amount(self):
        balance_before = self.card.balance
        execute_salary_payment(
            profile=self.profile,
            period_key=self.period,
            paid_by_id=self.card.id,
            payment_mode="partial",
            paid_amount_input=1500,
            created_by=self.admin,
        )
        self.card.refresh_from_db()
        self.assertEqual(self.card.balance, balance_before - Decimal("1500.00"))

    def test_expense_amount_equals_paid_amount(self):
        expense, _ = execute_salary_payment(
            profile=self.profile,
            period_key=self.period,
            paid_by_id=self.card.id,
            payment_mode="partial",
            paid_amount_input=1234.56,
            created_by=self.admin,
        )
        self.assertEqual(expense.amount, Decimal("1234.56"))

    def test_remaining_salary_due_calculated_correctly(self):
        calc = compute_salary_payment(
            profile=self.profile,
            period_key=self.period,
            payment_mode="partial",
            paid_amount_input=2000,
            manual_deduction_amount=100,
        )
        self.assertEqual(calc["paid_amount"], Decimal("2000.00"))
        self.assertEqual(calc["remaining_salary_due"], Decimal("2900.00"))
