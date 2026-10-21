"""Tests for performance period resolution and period-consistent team report."""

from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from accounts.models import EmployeeProfile
from accounts.services import employee_performance as perf
from accounts.services.performance_period import (
    MODE_ALL_TIME,
    MODE_MONTH,
    MODE_YEAR,
    resolve_performance_period,
)
from banking.models import BankCard
from customers.models import Customer
from payments.models import Payment
from procedures.models import Procedure

User = get_user_model()


class PerformancePeriodResolverTests(TestCase):
    def test_january_range(self):
        p = resolve_performance_period(period_mode=MODE_MONTH, year=2026, month=1, today=date(2026, 8, 4))
        self.assertEqual(p.start, date(2026, 1, 1))
        self.assertEqual(p.end_exclusive, date(2026, 2, 1))
        self.assertEqual(p.period_key, "2026-01")
        self.assertEqual(p.label, "January 2026")

    def test_february_leap_year(self):
        p = resolve_performance_period(period_mode=MODE_MONTH, year=2024, month=2, today=date(2026, 8, 4))
        self.assertEqual(p.start, date(2024, 2, 1))
        self.assertEqual(p.end_exclusive, date(2024, 3, 1))
        self.assertEqual(p.end_inclusive, date(2024, 2, 29))

    def test_december_range(self):
        p = resolve_performance_period(period_mode=MODE_MONTH, year=2025, month=12, today=date(2026, 8, 4))
        self.assertEqual(p.start, date(2025, 12, 1))
        self.assertEqual(p.end_exclusive, date(2026, 1, 1))

    def test_selected_year_range(self):
        p = resolve_performance_period(period_mode=MODE_YEAR, year=2025, today=date(2026, 8, 4))
        self.assertEqual(p.start, date(2025, 1, 1))
        self.assertEqual(p.end_exclusive, date(2026, 1, 1))
        self.assertIsNone(p.month)

    def test_current_year_excludes_future(self):
        today = date(2026, 8, 4)
        p = resolve_performance_period(period_mode=MODE_YEAR, year=2026, today=today)
        self.assertEqual(p.start, date(2026, 1, 1))
        self.assertEqual(p.end_exclusive, date(2026, 8, 5))

    def test_current_month_excludes_future_days(self):
        today = date(2026, 8, 4)
        p = resolve_performance_period(period_mode=MODE_MONTH, year=2026, month=8, today=today)
        self.assertEqual(p.start, date(2026, 8, 1))
        self.assertEqual(p.end_exclusive, date(2026, 8, 5))

    def test_all_time_through_today(self):
        today = date(2026, 8, 4)
        p = resolve_performance_period(period_mode=MODE_ALL_TIME, today=today)
        self.assertEqual(p.mode, MODE_ALL_TIME)
        self.assertEqual(p.end_exclusive, date(2026, 8, 5))
        self.assertIsNone(p.year)
        self.assertIsNone(p.month)

    def test_invalid_month(self):
        with self.assertRaises(ValidationError):
            resolve_performance_period(period_mode=MODE_MONTH, year=2026, month=13)

    def test_missing_month_for_month_mode(self):
        with self.assertRaises(ValidationError):
            resolve_performance_period(period_mode=MODE_MONTH, year=2026)

    def test_missing_year_for_year_mode(self):
        with self.assertRaises(ValidationError):
            resolve_performance_period(period_mode=MODE_YEAR)

    def test_legacy_period_string(self):
        p = resolve_performance_period(period="2026-05", today=date(2026, 8, 4))
        self.assertEqual(p.mode, MODE_MONTH)
        self.assertEqual(p.period_key, "2026-05")


class TeamPerformancePeriodConsistencyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username="perf-admin", password="pass", role=User.Roles.ADMIN
        )
        self.emp_a = User.objects.create_user(
            username="perf-a", password="pass", role=User.Roles.EMPLOYEE
        )
        self.emp_b = User.objects.create_user(
            username="perf-b", password="pass", role=User.Roles.EMPLOYEE
        )
        self.profile_a = EmployeeProfile.objects.create(
            user=self.emp_a, full_name="Alpha", salary=Decimal("3000"), commission_rate=Decimal("10")
        )
        self.profile_b = EmployeeProfile.objects.create(
            user=self.emp_b, full_name="Beta", salary=Decimal("2000"), commission_rate=Decimal("5")
        )
        self.customer = Customer.objects.create(
            type=Customer.CustomerType.COMPANY, name="Perf Co", company_name="Perf Co"
        )
        self.card = BankCard.objects.create(
            bank_name="Cash",
            cardholder_name="Office",
            card_type="Cash",
            card_number="2222",
            last4="2222",
            expiry_month="12",
            expiry_year="2030",
            balance=Decimal("50000"),
        )
        # May activity for A, June activity for B
        Procedure.objects.create(
            customer=self.customer,
            category="May A",
            cost=Decimal("10"),
            selling_price=Decimal("100"),
            paid=Decimal("100"),
            assigned_employee=self.emp_a,
            date=date(2026, 5, 10),
            status=Procedure.Status.DONE,
        )
        Payment.objects.create(
            customer=self.customer,
            amount=Decimal("100"),
            date=date(2026, 5, 10),
            type="cash",
            recorded_by=self.emp_a,
            bank_card=self.card,
        )
        Procedure.objects.create(
            customer=self.customer,
            category="June B",
            cost=Decimal("10"),
            selling_price=Decimal("200"),
            paid=Decimal("200"),
            assigned_employee=self.emp_b,
            date=date(2026, 6, 10),
            status=Procedure.Status.DONE,
        )
        Payment.objects.create(
            customer=self.customer,
            amount=Decimal("200"),
            date=date(2026, 6, 10),
            type="cash",
            recorded_by=self.emp_b,
            bank_card=self.card,
        )
        self.client.force_authenticate(self.admin)

    def test_score_and_rank_change_by_month(self):
        may = resolve_performance_period(period_mode=MODE_MONTH, year=2026, month=5, today=date(2026, 8, 4))
        june = resolve_performance_period(period_mode=MODE_MONTH, year=2026, month=6, today=date(2026, 8, 4))
        may_rows = {r["employee_id"]: r for r in perf.team_performance(may)}
        june_rows = {r["employee_id"]: r for r in perf.team_performance(june)}
        self.assertGreater(
            may_rows[str(self.profile_a.id)]["performance_score"],
            may_rows[str(self.profile_b.id)]["performance_score"],
        )
        self.assertEqual(may_rows[str(self.profile_a.id)]["rank"], 1)
        self.assertGreater(
            june_rows[str(self.profile_b.id)]["performance_score"],
            june_rows[str(self.profile_a.id)]["performance_score"],
        )
        self.assertEqual(june_rows[str(self.profile_b.id)]["rank"], 1)

    def test_report_summary_matches_employee_aggregates(self):
        resolved = resolve_performance_period(
            period_mode=MODE_MONTH, year=2026, month=5, today=date(2026, 8, 4)
        )
        report = perf.build_team_performance_report(resolved)
        employees = report["employees"]
        self.assertEqual(
            report["summary"]["open_procedures"],
            sum(r["open_procedures"] for r in employees),
        )
        self.assertEqual(
            report["summary"]["closed_procedures"],
            sum(r["closed_procedures"] for r in employees),
        )
        self.assertAlmostEqual(
            report["summary"]["total_collected"],
            sum(r["payments_collected"] for r in employees),
            places=2,
        )
        self.assertEqual(report["period"]["mode"], "month")
        self.assertEqual(report["period"]["month"], 5)

    def test_year_mode_includes_both_months(self):
        resolved = resolve_performance_period(period_mode=MODE_YEAR, year=2026, today=date(2026, 8, 4))
        report = perf.build_team_performance_report(resolved)
        by_id = {r["employee_id"]: r for r in report["employees"]}
        self.assertEqual(by_id[str(self.profile_a.id)]["closed_procedures"], 1)
        self.assertEqual(by_id[str(self.profile_b.id)]["closed_procedures"], 1)
        self.assertEqual(report["summary"]["closed_procedures"], 2)

    def test_all_time_includes_historical(self):
        resolved = resolve_performance_period(period_mode=MODE_ALL_TIME, today=date(2026, 8, 4))
        report = perf.build_team_performance_report(resolved)
        self.assertEqual(report["period"]["mode"], "all_time")
        self.assertEqual(report["summary"]["closed_procedures"], 2)

    def test_api_period_mode_envelope(self):
        resp = self.client.get(
            "/api/employees/performance/?period_mode=month&year=2026&month=5"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertIn("period", data)
        self.assertIn("summary", data)
        self.assertIn("employees", data)
        self.assertEqual(data["period"]["month"], 5)

    def test_legacy_period_still_returns_list(self):
        resp = self.client.get("/api/employees/performance/?period=2026-05")
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertIsInstance(data, list)
        self.assertTrue(any(r.get("performance_score") is not None for r in data))

    def test_performance_filter_uses_period_score(self):
        resp = self.client.get(
            "/api/employees/performance/?period_mode=month&year=2026&month=5&performance=High"
        )
        self.assertEqual(resp.status_code, 200)
        for row in resp.json()["employees"]:
            self.assertEqual(row["performance_level"], "High")

    def test_invalid_period_mode_400(self):
        resp = self.client.get("/api/employees/performance/?period_mode=week")
        self.assertEqual(resp.status_code, 400)

    def test_read_only_no_mutation(self):
        before = Procedure.objects.count()
        self.client.get("/api/employees/performance/?period_mode=all_time")
        self.assertEqual(Procedure.objects.count(), before)
