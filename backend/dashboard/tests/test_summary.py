"""Tests for GET /api/dashboard/summary/ — management KPIs."""

from calendar import monthrange
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import EmployeeProfile
from banking.models import BankCard
from customers.models import Customer
from expenses.models import Expense
from payments.models import Payment
from procedures.models import Procedure
from procedures.services.profitability import net_profit_sum

User = get_user_model()


class DashboardSummaryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.today = timezone.localdate()
        self.period = f"{self.today.year:04d}-{self.today.month:02d}"

        self.admin = User.objects.create_user(
            username="dash-admin", password="pass", role=User.Roles.ADMIN
        )
        self.manager = User.objects.create_user(
            username="dash-mgr", password="pass", role=User.Roles.MANAGER
        )
        self.employee = User.objects.create_user(
            username="dash-emp", password="pass", role=User.Roles.EMPLOYEE
        )
        self.cashier = User.objects.create_user(
            username="dash-cash", password="pass", role=User.Roles.CASHIER
        )
        EmployeeProfile.objects.create(user=self.employee, full_name="Dash Employee")

        self.card = BankCard.objects.create(
            bank_name="Cash",
            cardholder_name="Office",
            card_type="Cash",
            card_number="9999",
            last4="9999",
            expiry_month="12",
            expiry_year="2030",
            balance=Decimal("5000.00"),
        )

        self.customer_a = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Alpha Co",
            company_name="Alpha Co",
            balance=Decimal("1000.00"),
        )
        self.customer_b = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Beta Co",
            company_name="Beta Co",
            balance=Decimal("500.00"),
        )

        # DONE procedure this month → authoritative net profit = max(200-50,0) = 150
        Procedure.objects.create(
            customer=self.customer_a,
            category="Visa renewal",
            cost=Decimal("50.00"),
            selling_price=Decimal("200.00"),
            paid=Decimal("200.00"),
            assigned_employee=self.employee,
            date=self.today,
            status=Procedure.Status.DONE,
        )
        # Open but recent — not overdue
        Procedure.objects.create(
            customer=self.customer_a,
            category="Open recent",
            cost=Decimal("10.00"),
            selling_price=Decimal("20.00"),
            paid=Decimal("0.00"),
            assigned_employee=self.employee,
            date=self.today,
            status=Procedure.Status.IN_PROCESS,
        )
        # Open and older than 7 days → overdue
        Procedure.objects.create(
            customer=self.customer_b,
            category="Open old",
            cost=Decimal("10.00"),
            selling_price=Decimal("20.00"),
            paid=Decimal("0.00"),
            assigned_employee=None,
            date=self.today - timedelta(days=8),
            status=Procedure.Status.SUBMITTED,
        )

        Payment.objects.create(
            amount=Decimal("300.00"),
            date=self.today,
            type=Payment.PaymentType.CASH,
            customer=self.customer_a,
            recorded_by=self.employee,
            bank_card=self.card,
        )
        # Anchor aging: last payment 45 days ago for customer_b → 31_60 bucket
        Payment.objects.create(
            amount=Decimal("50.00"),
            date=self.today - timedelta(days=45),
            type=Payment.PaymentType.CASH,
            customer=self.customer_b,
            recorded_by=self.employee,
            bank_card=self.card,
        )

        Expense.objects.create(
            category=Expense.Category.OFFICE,
            date=self.today,
            amount=Decimal("100.00"),
            paid_by=self.card,
            notes="office",
        )

    def _get(self, user, period=None):
        self.client.force_authenticate(user=user)
        url = "/api/dashboard/summary/"
        if period is not None:
            url += f"?period={period}"
        return self.client.get(url)

    def test_unauthenticated_rejected(self):
        res = self.client.get("/api/dashboard/summary/")
        self.assertEqual(res.status_code, 401)

    def test_employee_forbidden(self):
        res = self._get(self.employee)
        self.assertEqual(res.status_code, 403)

    def test_cashier_forbidden(self):
        res = self._get(self.cashier)
        self.assertEqual(res.status_code, 403)

    def test_admin_ok(self):
        res = self._get(self.admin, self.period)
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()
        self.assertEqual(data["period"]["key"], self.period)
        self.assertIn("executive", data)
        self.assertIn("collection", data)
        self.assertIn("debt_aging", data)
        self.assertIn("operations", data)

    def test_manager_ok(self):
        res = self._get(self.manager, self.period)
        self.assertEqual(res.status_code, 200)

    def test_net_profit_matches_authoritative_helper(self):
        done = Procedure.objects.filter(
            status=Procedure.Status.DONE,
            date__year=self.today.year,
            date__month=self.today.month,
        )
        expected = net_profit_sum(done)
        res = self._get(self.admin, self.period)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["executive"]["net_profit"], f"{expected:.2f}")
        self.assertEqual(res.json()["executive"]["net_profit"], "150.00")

    def test_collection_rate_formula(self):
        month_start = self.today.replace(day=1)
        month_end = self.today.replace(day=monthrange(self.today.year, self.today.month)[1])
        collected = Decimal("0")
        for p in Payment.objects.filter(date__gte=month_start, date__lte=month_end):
            collected += p.amount
        outstanding = Decimal("1500.00")  # 1000 + 500
        amount_due = collected + outstanding
        expected_rate = (collected / amount_due).quantize(Decimal("0.0001"))

        res = self._get(self.admin, self.period)
        data = res.json()
        self.assertEqual(data["collection"]["collected"], f"{collected:.2f}")
        self.assertEqual(data["collection"]["amount_due"], f"{amount_due:.2f}")
        self.assertEqual(data["collection"]["rate"], format(expected_rate, "f"))

    def test_debt_aging_buckets(self):
        res = self._get(self.admin, self.period)
        aging = {row["bucket"]: row["amount"] for row in res.json()["debt_aging"]}
        # customer_a last pay today → current 1000
        self.assertEqual(aging["current"], "1000.00")
        # customer_b last pay 45 days ago → 31_60 500
        self.assertEqual(aging["31_60"], "500.00")

    def test_overdue_procedures_older_than_7_days(self):
        res = self._get(self.admin, self.period)
        ops = res.json()["operations"]
        self.assertEqual(ops["overdue"], 1)
        self.assertEqual(ops["unassigned"], 1)
        self.assertGreaterEqual(ops["active"], 2)

    def test_profit_by_type(self):
        res = self._get(self.admin, self.period)
        rows = res.json()["profit_by_type"]
        visa = next(r for r in rows if r["procedure_type"] == "Visa renewal")
        self.assertEqual(visa["revenue"], "200.00")
        self.assertEqual(visa["cost"], "50.00")
        self.assertEqual(visa["net_profit"], "150.00")
        self.assertEqual(visa["margin_pct"], "75.00")

    def test_expense_ratio(self):
        res = self._get(self.admin, self.period)
        expenses = res.json()["expenses"]
        self.assertEqual(expenses["total"], "100.00")
        collected = Decimal(res.json()["executive"]["collected_revenue"])
        expected = (Decimal("100.00") / collected).quantize(Decimal("0.0001"))
        self.assertEqual(expenses["expense_ratio"], format(expected, "f"))

    def test_cash_available(self):
        res = self._get(self.admin, self.period)
        self.assertEqual(res.json()["executive"]["cash_available"], "5000.00")

    def test_marketing_section_reuses_overview(self):
        with patch(
            "marketing.services.revenue_attribution.overview.build_overview_revenue"
        ) as mock_overview:
            mock_overview.return_value = {
                "summary": {
                    "leads": 10,
                    "converted_customers": 4,
                    "collected_revenue": "1000.00",
                    "net_profit": "400.00",
                    "campaign_spend": "100.00",
                    "marketing_contribution": "300.00",
                    "roas": "10.00",
                    "marketing_roi": "3.0000",
                }
            }
            res = self._get(self.admin, self.period)
            self.assertEqual(res.status_code, 200)
            mkt = res.json()["marketing"]
            self.assertIsNotNone(mkt)
            self.assertEqual(mkt["leads"], 10)
            self.assertEqual(mkt["converted_customers"], 4)
            self.assertEqual(mkt["marketing_contribution"], "300.00")
            self.assertEqual(mkt["roas"], "10.00")
            mock_overview.assert_called_once()
            args, _kwargs = mock_overview.call_args
            self.assertEqual(args[0], self.admin)
            params = args[1]
            self.assertIn("date_from", params)
            self.assertIn("date_to", params)

    def test_alerts_include_overdue(self):
        res = self._get(self.admin, self.period)
        ids = [a["id"] for a in res.json()["alerts"]]
        self.assertIn("overdue-procedures", ids)
