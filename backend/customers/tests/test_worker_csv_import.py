import io
from datetime import date
from pathlib import Path

from django.test import TestCase

from customers.models import CompanyEmployee, Customer
from customers.services.worker_csv_import import import_worker_csv, preview_worker_csv_import

ICP_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "Perfected_ICP_Employee_Data.csv"


def _csv_text(*lines: str) -> io.BytesIO:
    content = "\n".join(lines)
    return io.BytesIO(content.encode("utf-8-sig"))


class WorkerCsvImportTests(TestCase):
    def setUp(self):
        self.company = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Test Co",
            company_name="Test Co",
        )

    def test_preview_arabic_headers(self):
        file_obj = _csv_text(
            "العمال,الاقامة,,الضمان,",
            "الاسم,تاريخ الانتهاء,باليوم,تاريخ الانتهاء,باليوم",
            "أحمد علي,2027-08-15,531,2026-10-26,238",
            "محمد حسن,15/08/2027,500,26/10/2026,200",
        )
        preview = preview_worker_csv_import(self.company, file_obj)
        self.assertEqual(preview["counts"]["total"], 2)
        self.assertEqual(preview["counts"]["error"], 0)
        self.assertEqual(preview["rows"][0]["mapped"]["name"], "أحمد علي")
        self.assertEqual(preview["rows"][0]["mapped"]["residency_expiry"], "2027-08-15")

    def test_invalid_date_is_row_error(self):
        file_obj = _csv_text(
            "name,residency_expiry,residency_days,insurance_expiry,insurance_days",
            "Worker One,not-a-date,,,",
        )
        preview = preview_worker_csv_import(self.company, file_obj)
        self.assertEqual(preview["counts"]["error"], 1)
        self.assertIn("Unrecognized date", preview["rows"][0]["errors"][0])

    def test_import_creates_workers(self):
        file_obj = _csv_text(
            "name,residency_expiry,residency_days,insurance_expiry,insurance_days",
            "Worker One,2027-01-01,100,2026-05-01,50",
            "Worker Two,2027-02-01,,,",
        )
        result = import_worker_csv(self.company, file_obj)
        self.assertEqual(result["created"], 2)
        self.assertEqual(CompanyEmployee.objects.filter(company=self.company).count(), 2)

    def test_duplicate_worker_skipped(self):
        CompanyEmployee.objects.create(
            company=self.company,
            name="Worker One",
            residency_expiry=date(2027, 1, 1),
        )
        file_obj = _csv_text(
            "name,residency_expiry,residency_days,insurance_expiry,insurance_days",
            "Worker One,2027-01-01,100,2026-05-01,50",
            "Worker Three,2027-03-01,,,",
        )
        result = import_worker_csv(self.company, file_obj)
        self.assertEqual(result["created"], 1)
        self.assertEqual(result["skipped"], 1)

    def test_preview_does_not_create_records(self):
        file_obj = _csv_text(
            "name,residency_expiry,residency_days,insurance_expiry,insurance_days",
            "Worker One,2027-01-01,100,2026-05-01,50",
        )
        preview_worker_csv_import(self.company, file_obj)
        self.assertEqual(CompanyEmployee.objects.count(), 0)

    def test_preview_icp_employee_csv(self):
        with ICP_FIXTURE.open("rb") as file_obj:
            preview = preview_worker_csv_import(self.company, file_obj)

        self.assertEqual(preview["format_detected"], "icp_employee")
        self.assertEqual(preview["counts"]["total"], 4)
        self.assertEqual(preview["counts"]["valid"], 4)
        self.assertEqual(preview["counts"]["warning"], 0)
        self.assertEqual(preview["counts"]["error"], 0)
        self.assertEqual(preview["header_labels"][0], "English Name")
        self.assertEqual(preview["header_labels"][5], "Expiry Date")
        self.assertEqual(preview["columns_detected"]["english_name"], 0)
        self.assertEqual(preview["columns_detected"]["arabic_name"], 1)
        self.assertEqual(preview["columns_detected"]["residency_expiry"], 5)
        self.assertIsNone(preview["columns_detected"]["insurance_expiry"])

        first = preview["rows"][0]["mapped"]
        self.assertEqual(preview["rows"][0]["status"], "valid")
        self.assertEqual(first["name"], "اسلام احمد عبدالمطلب زياده")
        self.assertEqual(first["residency_expiry"], "2028-06-02")
        self.assertIsNone(first["insurance_expiry"])
        self.assertTrue(first["no_health_insurance"])
        self.assertIsNone(first["identifier"])
        self.assertIsNone(first["notes"])
        self.assertEqual(preview["rows"][0]["warnings"], [])

    def test_icp_employee_english_name_fallback(self):
        file_obj = _csv_text(
            '"English Name","Arabic Name","Unified Number","Emirates ID","Type","Expiry Date","Nationality","File Status"',
            '"JOHN DOE","","12345","784123","مقيم - عمل","01/01/2028","India","فعالة"',
        )
        preview = preview_worker_csv_import(self.company, file_obj)
        self.assertEqual(preview["counts"]["valid"], 1)
        self.assertEqual(preview["counts"]["warning"], 0)
        self.assertEqual(preview["rows"][0]["mapped"]["name"], "JOHN DOE")

    def test_import_icp_employee_csv(self):
        with ICP_FIXTURE.open("rb") as file_obj:
            result = import_worker_csv(self.company, file_obj)

        self.assertEqual(result["created"], 4)
        self.assertEqual(result["skipped"], 0)
        worker = CompanyEmployee.objects.get(company=self.company, name="احمد السيد ياقوت عطا")
        self.assertEqual(worker.residency_expiry.isoformat(), "2027-07-29")
        self.assertTrue(worker.no_health_insurance)
