import io
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from openpyxl import Workbook
from rest_framework.test import APIClient

from banking.models import BankCard, BankStatementComparisonJob
from banking.services.bank_statement_parse import parse_bank_statement_file
from banking.services.statement_comparison import (
    DESC_DATE_MATCH_REASON,
    create_statement_comparison_job,
    extract_transaction_date_hints,
)
from customers.models import Customer
from expenses.models import Expense
from payments.models import Payment
from procedures.models import Procedure

User = get_user_model()


def _csv_bytes(content: str) -> bytes:
    return content.encode("utf-8-sig")


def _xlsx_bytes(rows: list[list]) -> bytes:
    wb = Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class BankStatementParseTests(TestCase):
    def test_parse_csv_debit_credit(self):
        content = _csv_bytes(
            "Date,Description,Debit,Credit,Balance\n"
            "2025-06-01,Office rent,200.00,,9800.00\n"
            "2025-06-02,Customer deposit,,500.00,10300.00\n"
        )
        result = parse_bank_statement_file(io.BytesIO(content), "statement.csv")
        self.assertEqual(len(result.rows), 2)
        self.assertEqual(result.rows[0].money_out, Decimal("200.00"))
        self.assertEqual(result.rows[1].money_in, Decimal("500.00"))
        self.assertIn("date", result.detected_columns)

    def test_parse_xlsx_debit_credit(self):
        content = _xlsx_bytes(
            [
                ["Date", "Description", "Debit Amount", "Credit Amount"],
                ["2025-06-03", "Supplies", "50.00", ""],
                ["2025-06-04", "Payment in", "", "120.00"],
            ]
        )
        result = parse_bank_statement_file(io.BytesIO(content), "statement.xlsx")
        self.assertEqual(len(result.rows), 2)
        self.assertEqual(result.format_detected, "xlsx")

    def test_arabic_description_preserved(self):
        content = _csv_bytes(
            "Date,Description,Debit,Credit\n"
            "2025-06-05,دفع رسوم الخدمة,75.50,\n"
        )
        result = parse_bank_statement_file(io.BytesIO(content), "arabic.csv")
        self.assertEqual(result.rows[0].description, "دفع رسوم الخدمة")

    def test_invalid_file_raises(self):
        with self.assertRaises(ValueError):
            parse_bank_statement_file(io.BytesIO(b"not a spreadsheet"), "notes.txt")


class TransactionDateHintTests(TestCase):
    def test_extract_pur_dd_mm_hint(self):
        hints = extract_transaction_date_hints(
            "PUR 05/05 ICP Abu Dhabi 2703",
            date(2026, 5, 7),
        )
        self.assertEqual(hints, [date(2026, 5, 5)])

    def test_extract_pos_and_card_hints(self):
        self.assertEqual(
            extract_transaction_date_hints("POS 12/03 Merchant", date(2026, 3, 15)),
            [date(2026, 3, 12)],
        )
        self.assertEqual(
            extract_transaction_date_hints("CARD 07-04 Payment", date(2026, 4, 10)),
            [date(2026, 4, 7)],
        )

    def test_standalone_unambiguous_mm_dd(self):
        self.assertEqual(
            extract_transaction_date_hints("Payment on 05/13 ref 99", date(2026, 5, 15)),
            [date(2026, 5, 13)],
        )


class StatementComparisonTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admincmp",
            password="pass",
            role="admin",
        )
        self.employee = User.objects.create_user(
            username="empcmp",
            password="pass",
            role="employee",
        )
        self.card = BankCard.objects.create(
            bank_name="Compare Bank",
            cardholder_name="Office",
            card_number="1234567890123456",
            expiry_month="12",
            expiry_year="2030",
            method_type="bank",
            balance=Decimal("5000.00"),
        )
        self.customer = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Sara",
            phone="0500000001",
        )
        self.client = APIClient()

    def _upload_csv(self, content: str, user=None):
        self.client.force_authenticate(user=user or self.admin)
        file_obj = SimpleUploadedFile("bank.csv", _csv_bytes(content), content_type="text/csv")
        return self.client.post(
            f"/api/bank-cards/{self.card.pk}/statement-comparison/jobs/",
            {"file": file_obj},
            format="multipart",
        )

    def test_exact_match(self):
        Payment.objects.create(
            amount=Decimal("500.00"),
            date=date(2025, 6, 2),
            type="cash",
            customer=self.customer,
            bank_card=self.card,
        )
        Expense.objects.create(
            category=Expense.Category.OFFICE,
            date=date(2025, 6, 1),
            amount=Decimal("200.00"),
            paid_by=self.card,
            notes="Office rent",
        )
        res = self._upload_csv(
            "Date,Description,Debit,Credit,Balance\n"
            "2025-06-01,Office rent,200.00,,4800.00\n"
            "2025-06-02,Customer deposit,,500.00,5300.00\n"
        )
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()
        self.assertEqual(data["summary"]["matched_count"], 2)
        self.assertEqual(data["summary"]["bank_only_count"], 0)
        self.assertEqual(data["summary"]["system_only_count"], 0)

    def test_matched_by_description_date_hint_pur(self):
        Procedure.objects.create(
            customer=self.customer,
            category="تعديل بيانات جوازات",
            cost=Decimal("51.77"),
            selling_price=Decimal("100.00"),
            cash_out_type=self.card,
            paid=Decimal("0"),
            date=date(2026, 5, 5),
        )
        res = self._upload_csv(
            "Date,Description,Debit,Credit\n"
            "2026-05-07,PUR 05/05 ICP Abu Dhabi 2703,51.77,\n"
        )
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()
        self.assertEqual(data["summary"]["matched_count"], 1)
        self.assertEqual(data["summary"]["possible_match_count"], 0)
        self.assertEqual(len(data["exact_matches"]), 1)
        self.assertEqual(data["exact_matches"][0]["reason"], DESC_DATE_MATCH_REASON)

    def test_matched_single_candidate_within_three_days(self):
        Payment.objects.create(
            amount=Decimal("300.00"),
            date=date(2025, 6, 5),
            type="cash",
            customer=self.customer,
            bank_card=self.card,
        )
        res = self._upload_csv(
            "Date,Description,Debit,Credit\n"
            "2025-06-07,Customer deposit,,300.00\n"
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["summary"]["matched_count"], 1)
        self.assertEqual(data["summary"]["possible_match_count"], 0)
        self.assertEqual(len(data["exact_matches"]), 1)

    def test_possible_when_multiple_candidates_same_amount(self):
        Expense.objects.create(
            category=Expense.Category.OFFICE,
            date=date(2025, 6, 4),
            amount=Decimal("80.00"),
            paid_by=self.card,
            notes="First candidate",
        )
        Expense.objects.create(
            category=Expense.Category.OFFICE,
            date=date(2025, 6, 6),
            amount=Decimal("80.00"),
            paid_by=self.card,
            notes="Second candidate",
        )
        res = self._upload_csv(
            "Date,Description,Debit,Credit\n"
            "2025-06-07,Generic debit,80.00,\n"
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["summary"]["matched_count"], 0)
        self.assertEqual(data["summary"]["possible_match_count"], 1)
        self.assertIn("Multiple system candidates", data["possible_matches"][0]["reason"])

    def test_different_amount_not_auto_matched(self):
        Expense.objects.create(
            category=Expense.Category.OFFICE,
            date=date(2025, 6, 5),
            amount=Decimal("51.77"),
            paid_by=self.card,
            notes="System expense",
        )
        res = self._upload_csv(
            "Date,Description,Debit,Credit\n"
            "2025-06-07,PUR 05/05 ICP Abu Dhabi 2703,60.00,\n"
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["summary"]["matched_count"], 0)
        self.assertEqual(data["summary"]["bank_only_count"], 1)
        self.assertGreaterEqual(data["summary"]["system_only_count"], 1)

    def test_bank_only_transaction(self):
        res = self._upload_csv(
            "Date,Description,Debit,Credit\n"
            "2025-06-10,Bank fee,15.00,\n"
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["summary"]["bank_only_count"], 1)
        self.assertEqual(len(data["bank_only"]), 1)

    def test_system_only_transaction(self):
        Expense.objects.create(
            category=Expense.Category.OFFICE,
            date=date(2025, 6, 8),
            amount=Decimal("99.00"),
            paid_by=self.card,
            notes="Not on bank file",
        )
        res = self._upload_csv(
            "Date,Description,Debit,Credit\n"
            "2025-06-09,Unrelated credit,,10.00\n"
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertGreaterEqual(data["summary"]["system_only_count"], 1)

    def test_no_balance_mutation(self):
        balance_before = self.card.balance
        create_statement_comparison_job(
            self.card,
            io.BytesIO(
                _csv_bytes("Date,Description,Debit,Credit\n2025-06-01,Fee,5.00,\n")
            ),
            "fee.csv",
            self.admin,
        )
        self.card.refresh_from_db()
        self.assertEqual(self.card.balance, balance_before)

    def test_employee_forbidden(self):
        res = self._upload_csv(
            "Date,Description,Debit,Credit\n2025-06-01,Fee,5.00,\n",
            user=self.employee,
        )
        self.assertEqual(res.status_code, 403)

    def test_get_and_delete_job(self):
        job = create_statement_comparison_job(
            self.card,
            io.BytesIO(_csv_bytes("Date,Description,Debit,Credit\n2025-06-01,Fee,5.00,\n")),
            "fee.csv",
            self.admin,
        )
        self.client.force_authenticate(self.admin)
        get_res = self.client.get(
            f"/api/bank-cards/{self.card.pk}/statement-comparison/jobs/{job.pk}/"
        )
        self.assertEqual(get_res.status_code, 200)
        del_res = self.client.delete(
            f"/api/bank-cards/{self.card.pk}/statement-comparison/jobs/{job.pk}/"
        )
        self.assertEqual(del_res.status_code, 204)
        self.assertFalse(BankStatementComparisonJob.objects.filter(pk=job.pk).exists())

    def test_xlsx_upload_via_api(self):
        content = _xlsx_bytes(
            [
                ["Date", "Description", "Debit", "Credit"],
                ["2025-06-11", "Charge", "25.00", ""],
            ]
        )
        self.client.force_authenticate(self.admin)
        file_obj = SimpleUploadedFile(
            "bank.xlsx",
            content,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        res = self.client.post(
            f"/api/bank-cards/{self.card.pk}/statement-comparison/jobs/",
            {"file": file_obj},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["summary"]["bank_only_count"], 1)
