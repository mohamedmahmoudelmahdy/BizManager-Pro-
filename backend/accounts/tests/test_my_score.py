"""Tests for GET /api/employees/my-score/ — authoritative employee dashboard score."""

from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import EmployeeProfile
from accounts.services import employee_performance as perf
from banking.models import BankCard
from customers.models import Customer
from payments.models import Payment
from procedures.models import Procedure

User = get_user_model()


class MyScoreEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        today = timezone.localdate()
        self.period = f"{today.year:04d}-{today.month:02d}"
        self.admin = User.objects.create_user(
            username="score-admin", password="pass", role=User.Roles.ADMIN
        )
        self.employee = User.objects.create_user(
            username="score-emp", password="pass", role=User.Roles.EMPLOYEE
        )
        self.other = User.objects.create_user(
            username="score-other", password="pass", role=User.Roles.EMPLOYEE
        )
        self.profile = EmployeeProfile.objects.create(
            user=self.employee, full_name="Score Employee"
        )
        self.other_profile = EmployeeProfile.objects.create(
            user=self.other, full_name="Other Score Employee"
        )
        self.customer = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Score Co",
            company_name="Score Co",
        )
        self.card = BankCard.objects.create(
            bank_name="Cash",
            cardholder_name="Office",
            card_type="Cash",
            card_number="1111",
            last4="1111",
            expiry_month="12",
            expiry_year="2030",
            balance=Decimal("10000.00"),
        )
        # Give employee more activity than other so ranks are deterministic.
        # Dates on/before today so current-month future exclusion does not drop them.
        Procedure.objects.create(
            customer=self.customer,
            category="Emp Proc",
            cost=Decimal("10.00"),
            selling_price=Decimal("100.00"),
            paid=Decimal("100.00"),
            assigned_employee=self.employee,
            date=today,
            status=Procedure.Status.DONE,
        )
        Payment.objects.create(
            amount=Decimal("100.00"),
            date=today,
            type=Payment.PaymentType.CASH,
            customer=self.customer,
            recorded_by=self.employee,
            bank_card=self.card,
        )
        Procedure.objects.create(
            customer=self.customer,
            category="Other Proc",
            cost=Decimal("10.00"),
            selling_price=Decimal("20.00"),
            paid=Decimal("0.00"),
            assigned_employee=self.other,
            date=today,
            status=Procedure.Status.SUBMITTED,
        )

    def _url(self, period=None, extra=""):
        qs = []
        if period is not None:
            qs.append(f"period={period}")
        if extra:
            qs.append(extra.lstrip("&?"))
        suffix = ("?" + "&".join(qs)) if qs else ""
        return f"/api/employees/my-score/{suffix}"

    def test_unauthenticated_rejected(self):
        response = self.client.get(self._url(self.period))
        self.assertEqual(response.status_code, 401)

    def test_employee_receives_own_score(self):
        self.client.force_authenticate(self.employee)
        response = self.client.get(self._url(self.period))
        self.assertEqual(response.status_code, 200)
        score = response.json()["score"]
        self.assertIsInstance(score["value"], (int, float))
        self.assertEqual(score["maximum"], perf.PERFORMANCE_SCORE_MAXIMUM)
        self.assertIsInstance(score["rank"], int)
        self.assertEqual(score["rank_total"], 2)
        self.assertEqual(score["period"]["type"], "month")
        self.assertEqual(score["period"]["key"], self.period)
        today = timezone.localdate()
        self.assertEqual(score["period"]["month"], today.month)
        self.assertEqual(score["period"]["year"], today.year)

    def test_score_matches_authoritative_team_performance(self):
        team = perf.team_performance(self.period)
        expected = next(r for r in team if r["employee_id"] == str(self.profile.id))

        self.client.force_authenticate(self.employee)
        response = self.client.get(self._url(self.period))
        self.assertEqual(response.status_code, 200)
        score = response.json()["score"]
        self.assertEqual(score["value"], expected["performance_score"])
        self.assertEqual(score["maximum"], perf.PERFORMANCE_SCORE_MAXIMUM)
        self.assertEqual(score["rank"], expected["rank"])
        self.assertEqual(score["rank_total"], len(team))
        self.assertEqual(score["performance_level"], expected["performance_level"])

    def test_score_matches_existing_employee_dashboard_endpoint(self):
        self.client.force_authenticate(self.admin)
        dash = self.client.get(
            f"/api/employees/{self.profile.id}/dashboard/?period={self.period}"
        )
        self.assertEqual(dash.status_code, 200)
        dash_data = dash.json()

        self.client.force_authenticate(self.employee)
        mine = self.client.get(self._url(self.period))
        self.assertEqual(mine.status_code, 200)
        score = mine.json()["score"]
        self.assertEqual(score["value"], dash_data["performance_score"])
        self.assertEqual(score["rank"], dash_data["rank"])

    def test_employee_id_query_param_is_ignored(self):
        """Client cannot request another employee's score via query param."""
        self.client.force_authenticate(self.employee)
        response = self.client.get(
            self._url(self.period, extra=f"employee_id={self.other_profile.id}")
        )
        self.assertEqual(response.status_code, 200)
        score = response.json()["score"]

        team = perf.team_performance(self.period)
        own = next(r for r in team if r["employee_id"] == str(self.profile.id))
        other = next(r for r in team if r["employee_id"] == str(self.other_profile.id))
        self.assertEqual(score["value"], own["performance_score"])
        self.assertEqual(score["rank"], own["rank"])
        self.assertNotEqual(own["rank"], other["rank"])

    def test_null_score_when_no_employee_profile(self):
        lone = User.objects.create_user(
            username="no-profile", password="pass", role=User.Roles.EMPLOYEE
        )
        self.client.force_authenticate(lone)
        response = self.client.get(self._url(self.period))
        self.assertEqual(response.status_code, 200)
        score = response.json()["score"]
        self.assertIsNone(score["value"])
        self.assertIsNone(score["rank"])
        self.assertEqual(score["maximum"], perf.PERFORMANCE_SCORE_MAXIMUM)
        self.assertEqual(score["rank_total"], 2)

    def test_inactive_employee_denied(self):
        self.employee.is_active = False
        self.employee.save(update_fields=["is_active"])
        self.client.force_authenticate(self.employee)
        response = self.client.get(self._url(self.period))
        self.assertEqual(response.status_code, 403)

    def test_default_period_is_current_month(self):
        fixed = date(2026, 8, 15)
        with patch("accounts.services.employee_performance.timezone.localdate", return_value=fixed):
            payload = perf.score_payload_for_user(self.employee, period=None)
        self.assertEqual(payload["score"]["period"]["key"], "2026-08")
        self.assertEqual(payload["score"]["period"]["type"], "month")

        self.client.force_authenticate(self.employee)
        with patch("accounts.services.employee_performance.timezone.localdate", return_value=fixed):
            response = self.client.get(self._url())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["score"]["period"]["key"], "2026-08")

    def test_read_only_does_not_mutate_records(self):
        proc_count = Procedure.objects.count()
        pay_count = Payment.objects.count()
        profile_updated = self.profile.updated_at

        self.client.force_authenticate(self.employee)
        response = self.client.get(self._url(self.period))
        self.assertEqual(response.status_code, 200)

        self.assertEqual(Procedure.objects.count(), proc_count)
        self.assertEqual(Payment.objects.count(), pay_count)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.updated_at, profile_updated)

    def test_performance_list_endpoint_still_unchanged(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get(f"/api/employees/performance/?period={self.period}")
        self.assertEqual(response.status_code, 200)
        rows = response.json()
        self.assertIsInstance(rows, list)
        self.assertEqual(len(rows), 2)
        self.assertIn("performance_score", rows[0])
        self.assertIn("rank", rows[0])

    def test_no_extra_per_employee_query_loop_beyond_team_performance(self):
        """
        my-score must call team_performance once — query count should match a
        direct score_payload_for_user call (not grow with an extra per-employee loop).
        """
        self.client.force_authenticate(self.employee)

        with CaptureQueriesContext(connection) as ctx_direct:
            direct = perf.score_payload_for_user(self.employee, self.period)

        with CaptureQueriesContext(connection) as ctx_api:
            response = self.client.get(self._url(self.period))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["score"]["value"], direct["score"]["value"])
        # API may add auth/session overhead; allow a small constant delta, not O(n).
        self.assertLessEqual(len(ctx_api), len(ctx_direct) + 15)

        # Adding more profiles must not make my-score do one *extra* ranking pass.
        for i in range(3):
            u = User.objects.create_user(
                username=f"extra-{i}", password="pass", role=User.Roles.EMPLOYEE
            )
            EmployeeProfile.objects.create(user=u, full_name=f"Extra {i}")

        with CaptureQueriesContext(connection) as ctx_after:
            response2 = self.client.get(self._url(self.period))
        self.assertEqual(response2.status_code, 200)

        with CaptureQueriesContext(connection) as ctx_team:
            perf.team_performance(self.period)

        # Endpoint queries should stay within team_performance + small constant.
        self.assertLessEqual(len(ctx_after), len(ctx_team) + 15)

    def test_invalid_period_returns_null_score_safely(self):
        self.client.force_authenticate(self.employee)
        response = self.client.get(self._url("not-a-period"))
        self.assertEqual(response.status_code, 200)
        score = response.json()["score"]
        self.assertIsNone(score["value"])
        self.assertIsNone(score["rank"])
        self.assertEqual(score["maximum"], perf.PERFORMANCE_SCORE_MAXIMUM)

    def test_cashier_denied(self):
        cashier = User.objects.create_user(
            username="score-cashier", password="pass", role=User.Roles.CASHIER
        )
        self.client.force_authenticate(cashier)
        response = self.client.get(self._url(self.period))
        self.assertEqual(response.status_code, 403)
