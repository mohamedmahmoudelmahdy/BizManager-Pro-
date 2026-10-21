import csv
import io
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import EmployeeProfile
from banking.models import BankCard
from customers.models import Customer
from procedures.models import Procedure

User = get_user_model()


class ProcedureExportTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="adminexp", password="pass", role=User.Roles.ADMIN)
        self.manager = User.objects.create_user(username="mgrexp", password="pass", role=User.Roles.MANAGER)
        self.employee_user = User.objects.create_user(
            username="empexp", password="pass", role=User.Roles.EMPLOYEE
        )
        self.employee_profile = EmployeeProfile.objects.create(
            user=self.employee_user,
            full_name="موظف عربي",
        )
        self.other_employee = User.objects.create_user(
            username="emp2", password="pass", role=User.Roles.EMPLOYEE
        )
        EmployeeProfile.objects.create(user=self.other_employee, full_name="Other Employee")

        self.customer = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="شركة الاختبار",
            company_name="شركة الاختبار",
        )
        self.card = BankCard.objects.create(
            bank_name="Main Cash",
            cardholder_name="Office",
            card_type="Cash",
            card_number="0001",
            last4="0001",
            expiry_month="12",
            expiry_year="2030",
            balance=Decimal("10000.00"),
        )
        self.client = APIClient()

        Procedure.objects.create(
            customer=self.customer,
            category="إقامة وهوية",
            description="وصف عربي",
            cost=Decimal("100.00"),
            selling_price=Decimal("250.00"),
            paid=Decimal("50.00"),
            cash_out_type=self.card,
            cash_in_type=self.card,
            status=Procedure.Status.SUBMITTED,
            assigned_employee=self.employee_user,
            date=date(2026, 6, 7),
        )
        Procedure.objects.create(
            customer=self.customer,
            category="Typing",
            description="English procedure",
            cost=Decimal("20.00"),
            selling_price=Decimal("80.00"),
            paid=Decimal("0.00"),
            status=Procedure.Status.DONE,
            assigned_employee=self.other_employee,
            date=date(2026, 6, 8),
        )
        Procedure.objects.create(
            customer=self.customer,
            category="Old",
            description="Outside range",
            cost=Decimal("10.00"),
            selling_price=Decimal("30.00"),
            paid=Decimal("0.00"),
            status=Procedure.Status.REJECTED,
            assigned_employee=self.employee_user,
            date=date(2026, 1, 15),
        )

    def _export_rows(self, query: str, user=None):
        self.client.force_authenticate(user=user or self.admin)
        response = self.client.get(f"/api/procedures/export/{query}")
        self.assertEqual(response.status_code, 200)
        text = response.content.decode("utf-8-sig")
        reader = csv.reader(io.StringIO(text))
        return list(reader)

    def test_employee_cannot_export(self):
        self.client.force_authenticate(user=self.employee_user)
        response = self.client.get("/api/procedures/export/?date=2026-06-07")
        self.assertEqual(response.status_code, 403)

    def test_export_selected_date_only(self):
        rows = self._export_rows("?date=2026-06-07")
        self.assertEqual(len(rows), 2)  # header + 1 row
        self.assertEqual(rows[1][2], "إقامة وهوية")
        self.assertEqual(rows[1][1], "2026-06-07")

    def test_export_by_employee(self):
        rows = self._export_rows(f"?assigned_employee={self.employee_user.id}")
        data_rows = rows[1:]
        self.assertEqual(len(data_rows), 2)
        self.assertTrue(all(row[5] in ("موظف عربي",) for row in data_rows))

    def test_export_by_status(self):
        rows = self._export_rows("?status=done")
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1][6], "Completed")

    def test_export_date_range(self):
        rows = self._export_rows("?date_from=2026-06-01&date_to=2026-06-30")
        self.assertEqual(len(rows), 3)

    def test_export_last_months(self):
        rows = self._export_rows("?months=3")
        self.assertGreaterEqual(len(rows), 2)

    def test_arabic_opens_with_utf8_bom(self):
        self.client.force_authenticate(user=self.manager)
        response = self.client.get("/api/procedures/export/?date=2026-06-07")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"\xef\xbb\xbf"))
        text = response.content.decode("utf-8-sig")
        self.assertIn("شركة الاختبار", text)
        self.assertIn("إقامة وهوية", text)
