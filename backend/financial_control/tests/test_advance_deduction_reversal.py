"""Tests for salary advance deduction reversal and generic ledger blocking."""
from decimal import Decimal
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import EmployeeProfile
from accounts.services.pay_salary import execute_salary_payment, salary_settlement_status
from banking.models import BankCard
from financial_control.models import EmployeeAdvance, EmployeeAdvanceDeduction, LedgerAccount, LedgerEntry
from financial_control.services import employee_advances as advances_svc
from financial_control.services import ledger as ledger_svc

User = get_user_model()


class AdvanceDeductionReversalTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="admin1", password="pass", role=User.Roles.ADMIN)
        self.employee_user = User.objects.create_user(
            username="noor", password="pass", role=User.Roles.EMPLOYEE
        )
        self.profile = EmployeeProfile.objects.create(
            user=self.employee_user,
            full_name="Noor Employee",
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

    def _pay_with_advance(self, advance_amount=Decimal("2999.26")):
        advances_svc.give_advance(
            employee_user=self.employee_user,
            amount=advance_amount,
            paid_by_id=self.card.id,
            created_by=self.admin,
        )
        expense, _ = execute_salary_payment(
            profile=self.profile,
            period_key=self.period,
            paid_by_id=self.card.id,
            payment_mode="full",
            created_by=self.admin,
        )
        deduction = EmployeeAdvanceDeduction.objects.get(
            employee=self.employee_user, status=EmployeeAdvanceDeduction.Status.ACTIVE
        )
        advance = deduction.advance
        account = advance.linked_ledger_account
        return expense, deduction, advance, account

    def test_reverse_advance_deduction_restores_all_layers(self):
        expense, deduction, advance, account = self._pay_with_advance()
        amount = Decimal(str(deduction.amount))
        ledger_before = Decimal(str(account.current_balance))
        self.card.refresh_from_db()
        bank_before_reverse = self.card.balance

        result = advances_svc.reverse_advance_deduction(
            deduction, self.admin, reason="Correction"
        )

        advance.refresh_from_db()
        expense.refresh_from_db()
        account.refresh_from_db()
        self.card.refresh_from_db()

        self.assertEqual(advance.outstanding_balance, amount)
        self.assertEqual(advance.status, EmployeeAdvance.Status.ACTIVE)
        self.assertEqual(result["deduction"].status, EmployeeAdvanceDeduction.Status.REVERSED)
        self.assertEqual(expense.salary_advance_deduction, Decimal("0.00"))
        self.assertEqual(expense.salary_remaining_due, amount)
        settlement = salary_settlement_status(self.employee_user, self.profile, self.period)
        self.assertIn(settlement["salary_status"], ("partial", "pending"))
        self.assertGreater(settlement["salary_remaining_due"], 0)
        # Reversing the salary CREDIT deduction posts a DEBIT reversal (balance decreases).
        self.assertEqual(account.current_balance, ledger_before - amount)
        self.assertEqual(self.card.balance, bank_before_reverse)

    def test_reverse_same_deduction_twice_blocked(self):
        _, deduction, _, _ = self._pay_with_advance()
        advances_svc.reverse_advance_deduction(deduction, self.admin, reason="First")
        with self.assertRaises(ValueError):
            advances_svc.reverse_advance_deduction(deduction, self.admin, reason="Second")

    def test_generic_ledger_reverse_blocked_for_advance_deduction(self):
        _, deduction, _, _ = self._pay_with_advance()
        entry_id = deduction.linked_ledger_entry_id
        response = self.client.post(f"/api/ledger-entries/{entry_id}/reverse/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Employee Financials", response.data["detail"])

    def test_generic_ledger_reverse_still_works_for_manual_entry(self):
        account = LedgerAccount.objects.create(
            name="Manual Test",
            account_type=LedgerAccount.AccountType.INTERNAL,
            status=LedgerAccount.Status.ACTIVE,
            created_by=self.admin,
        )
        entry = LedgerEntry.objects.create(
            ledger_account=account,
            date="2026-06-01",
            description="Manual adjustment",
            entry_type=LedgerEntry.EntryType.DEBIT,
            amount=Decimal("50.00"),
            status=LedgerEntry.Status.DRAFT,
            source_type=LedgerEntry.SourceType.MANUAL,
            created_by=self.admin,
        )
        ledger_svc.post_ledger_entry(entry)
        response = self.client.post(f"/api/ledger-entries/{entry.id}/reverse/", {}, format="json")
        self.assertEqual(response.status_code, 200)
        entry.refresh_from_db()
        self.assertEqual(entry.status, LedgerEntry.Status.REVERSED)

    def test_repair_dry_run_detects_inconsistency(self):
        expense, deduction, advance, _ = self._pay_with_advance()
        ledger_entry = deduction.linked_ledger_entry
        ledger_svc.reverse_ledger_entry(ledger_entry, self.admin, reason="Generic mistake")

        advance.refresh_from_db()
        expense.refresh_from_db()
        self.assertEqual(advance.outstanding_balance, Decimal("0.00"))
        self.assertEqual(advance.status, EmployeeAdvance.Status.SETTLED)
        self.assertGreater(expense.salary_advance_deduction, 0)

        out = StringIO()
        call_command("repair_reversed_advance_deductions", "--dry-run", stdout=out)
        output = out.getvalue()
        self.assertIn("Noor", output)
        self.assertIn("Expected repair", output)

    def test_repair_apply_fixes_without_duplicate_ledger_reversal(self):
        expense, deduction, advance, account = self._pay_with_advance()
        amount = Decimal(str(deduction.amount))
        ledger_entry = deduction.linked_ledger_entry
        ledger_svc.reverse_ledger_entry(ledger_entry, self.admin, reason="Generic mistake")
        reversal_count_before = LedgerEntry.objects.filter(reversal_of=ledger_entry).count()

        call_command("repair_reversed_advance_deductions", "--apply")

        deduction.refresh_from_db()
        advance.refresh_from_db()
        expense.refresh_from_db()
        self.assertEqual(deduction.status, EmployeeAdvanceDeduction.Status.REVERSED)
        self.assertEqual(advance.outstanding_balance, amount)
        self.assertEqual(advance.status, EmployeeAdvance.Status.ACTIVE)
        self.assertEqual(expense.salary_advance_deduction, Decimal("0.00"))
        self.assertEqual(
            LedgerEntry.objects.filter(reversal_of=ledger_entry).count(),
            reversal_count_before,
        )

    def test_api_reverse_deduction_endpoint(self):
        _, deduction, _, _ = self._pay_with_advance()
        response = self.client.post(
            f"/api/employee-advances/deductions/{deduction.id}/reverse/",
            {"reason": "Payroll correction"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deduction"]["status"], "reversed")
        self.assertIn("salary_settlement", response.data)
