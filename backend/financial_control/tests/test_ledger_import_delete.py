from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from financial_control.models import (
    FinancialImportJob,
    FinancialImportRow,
    LedgerAccount,
    LedgerEntry,
)
from financial_control.services.ledger_import_delete import (
    can_delete_imported_ledger_account,
    delete_imported_ledger_account,
)

User = get_user_model()


class LedgerImportDeleteTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin1", password="pass", role=User.Roles.ADMIN
        )
        self.manager = User.objects.create_user(
            username="mgr1", password="pass", role=User.Roles.MANAGER
        )
        self.client = APIClient()

    def _import_job(self):
        return FinancialImportJob.objects.create(
            file=SimpleUploadedFile("test.xlsx", b"test"),
            original_filename="test.xlsx",
            status=FinancialImportJob.Status.COMPLETED,
            created_by=self.admin,
        )

    def _import_account(self, name="Imported Sheet", *, mark_row=True):
        account = LedgerAccount.objects.create(
            name=name,
            account_type=LedgerAccount.AccountType.OTHER,
            created_by=self.admin,
        )
        if mark_row:
            job = self._import_job()
            FinancialImportRow.objects.create(
                job=job,
                sheet_name=name,
                row_number=1,
                detected_type=FinancialImportRow.DetectedType.LEDGER_ACCOUNT,
                status=FinancialImportRow.RowStatus.IMPORTED,
                linked_object_type="ledger_account",
                linked_object_id=str(account.id),
            )
        return account

    def _import_entry(self, account, *, status=LedgerEntry.Status.DRAFT):
        job = self._import_job()
        entry = LedgerEntry.objects.create(
            ledger_account=account,
            date=timezone.localdate(),
            description="Imported row",
            entry_type=LedgerEntry.EntryType.DEBIT,
            amount=Decimal("100.00"),
            status=status,
            source_type=LedgerEntry.SourceType.IMPORT,
            source_id=str(job.id),
            created_by=self.admin,
        )
        FinancialImportRow.objects.create(
            job=job,
            sheet_name="Sheet1",
            row_number=2,
            detected_type=FinancialImportRow.DetectedType.LEDGER_ENTRY,
            status=FinancialImportRow.RowStatus.IMPORTED,
            linked_object_type="ledger_entry",
            linked_object_id=str(entry.id),
            linked_ledger_entry=entry,
        )
        return entry

    def test_import_only_draft_entries_delete_succeeds(self):
        account = self._import_account()
        self._import_entry(account)
        allowed, reason, stats = can_delete_imported_ledger_account(account)
        self.assertTrue(allowed, reason)
        self.assertEqual(stats["import_draft_entry_count"], 1)

        result = delete_imported_ledger_account(account)
        self.assertEqual(result["deleted_account_count"], 1)
        self.assertEqual(result["deleted_entry_count"], 1)
        self.assertFalse(LedgerAccount.objects.filter(id=account.id).exists())
        self.assertEqual(LedgerEntry.objects.filter(ledger_account_id=account.id).count(), 0)

    def test_posted_entry_blocks_delete(self):
        account = self._import_account()
        self._import_entry(account, status=LedgerEntry.Status.POSTED)
        allowed, reason, _ = can_delete_imported_ledger_account(account)
        self.assertFalse(allowed)
        self.assertIn("posted", reason.lower())

    def test_reconciled_entry_blocks_delete(self):
        account = self._import_account()
        self._import_entry(account, status=LedgerEntry.Status.RECONCILED)
        allowed, reason, _ = can_delete_imported_ledger_account(account)
        self.assertFalse(allowed)
        self.assertIn("reconciled", reason.lower())

    def test_manual_entry_blocks_delete(self):
        account = self._import_account()
        LedgerEntry.objects.create(
            ledger_account=account,
            date=timezone.localdate(),
            description="Manual adjustment",
            entry_type=LedgerEntry.EntryType.DEBIT,
            amount=Decimal("50.00"),
            status=LedgerEntry.Status.DRAFT,
            source_type=LedgerEntry.SourceType.MANUAL,
            created_by=self.admin,
        )
        allowed, reason, _ = can_delete_imported_ledger_account(account)
        self.assertFalse(allowed)
        self.assertIn("operational", reason.lower())

    def test_employee_ledger_with_payroll_blocks_delete(self):
        employee = User.objects.create_user(
            username="emp1", password="pass", role=User.Roles.EMPLOYEE
        )
        account = LedgerAccount.objects.create(
            name="Employee Ledger",
            account_type=LedgerAccount.AccountType.EMPLOYEE,
            linked_employee=employee,
            created_by=self.admin,
        )
        LedgerEntry.objects.create(
            ledger_account=account,
            date=timezone.localdate(),
            description="Advance deduction",
            entry_type=LedgerEntry.EntryType.DEBIT,
            amount=Decimal("200.00"),
            status=LedgerEntry.Status.POSTED,
            source_type=LedgerEntry.SourceType.PAYROLL,
            related_employee=employee,
            created_by=self.admin,
        )
        allowed, reason, _ = can_delete_imported_ledger_account(account)
        self.assertFalse(allowed)

    def test_manual_account_blocks_delete(self):
        account = LedgerAccount.objects.create(
            name="Manual Account",
            account_type=LedgerAccount.AccountType.INTERNAL,
            created_by=self.admin,
        )
        allowed, reason, _ = can_delete_imported_ledger_account(account)
        self.assertFalse(allowed)
        self.assertIn("not import-only", reason.lower())

    def test_non_admin_gets_403(self):
        account = self._import_account()
        self._import_entry(account)
        self.client.force_authenticate(user=self.manager)
        url = f"/api/ledger-accounts/{account.id}/delete-imported/"
        response = self.client.post(url, {}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertTrue(LedgerAccount.objects.filter(id=account.id).exists())

    def test_admin_api_delete_succeeds(self):
        account = self._import_account()
        self._import_entry(account)
        self.client.force_authenticate(user=self.admin)
        url = f"/api/ledger-accounts/{account.id}/delete-imported/"
        response = self.client.post(url, {}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deleted_entry_count"], 1)
        self.assertFalse(LedgerAccount.objects.filter(id=account.id).exists())
