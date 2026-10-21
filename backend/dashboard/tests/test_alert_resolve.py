import io
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from banking.models import BankCard
from customers.models import CompanyEmployee, Customer
from dashboard.services.alert_resolve import ALERT_THRESHOLD_DAYS, resolve_dashboard_alert
from procedures.models import Procedure

User = get_user_model()


class DashboardAlertResolveTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="adminalert", password="pass", role="admin")
        self.employee = User.objects.create_user(username="empalert", password="pass", role="employee")
        self.cashier = User.objects.create_user(username="cashalert", password="pass", role="cashier")
        self.company = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Acme LLC",
            company_name="Acme LLC",
            phone="0500000000",
            license_expiry=date.today() + timedelta(days=5),
            workers_expiry=date.today() + timedelta(days=10),
            health_insurance_expiry=date.today() + timedelta(days=3),
        )
        self.worker = CompanyEmployee.objects.create(
            company=self.company,
            name="Worker One",
            residency_expiry=date.today() + timedelta(days=7),
            insurance_expiry=date.today() + timedelta(days=4),
        )
        self.card = BankCard.objects.create(
            bank_name="Office Bank",
            cardholder_name="Office",
            card_number="1234567890123456",
            expiry_month="12",
            expiry_year="2030",
            method_type="bank",
            balance=Decimal("1000.00"),
        )
        self.client = APIClient()

    def _resolve(self, payload, user=None):
        self.client.force_authenticate(user=user or self.admin)
        return self.client.post("/api/dashboard/alerts/resolve/", payload, format="json")

    def test_resolve_license_expiry_clears_alert_window(self):
        new_date = date.today() + timedelta(days=120)
        res = self._resolve(
            {
                "alert_type": "license_expiry",
                "customer_id": str(self.company.pk),
                "field": "license_expiry",
                "new_expiry_date": new_date.isoformat(),
            }
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.company.refresh_from_db()
        self.assertEqual(self.company.license_expiry, new_date)
        self.assertFalse(res.json()["alert_may_remain"])

    def test_resolve_trade_license_expiry_alias(self):
        new_date = date.today() + timedelta(days=200)
        res = self._resolve(
            {
                "alert_type": "trade_license_expiry",
                "customer_id": str(self.company.pk),
                "field": "license_expiry",
                "new_expiry_date": new_date.isoformat(),
            }
        )
        self.assertEqual(res.status_code, 200)
        self.company.refresh_from_db()
        self.assertEqual(self.company.license_expiry, new_date)

    def test_resolve_health_insurance_expiry(self):
        new_date = date.today() + timedelta(days=90)
        res = self._resolve(
            {
                "alert_type": "health_insurance_expiry",
                "customer_id": str(self.company.pk),
                "field": "health_insurance_expiry",
                "new_expiry_date": new_date.isoformat(),
            }
        )
        self.assertEqual(res.status_code, 200)
        self.company.refresh_from_db()
        self.assertEqual(self.company.health_insurance_expiry, new_date)

    def test_resolve_workers_expiry(self):
        new_date = date.today() + timedelta(days=90)
        res = self._resolve(
            {
                "alert_type": "workers_expiry",
                "customer_id": str(self.company.pk),
                "field": "workers_expiry",
                "new_expiry_date": new_date.isoformat(),
            }
        )
        self.assertEqual(res.status_code, 200)
        self.company.refresh_from_db()
        self.assertEqual(self.company.workers_expiry, new_date)

    def test_resolve_worker_residency_expiry(self):
        new_date = date.today() + timedelta(days=90)
        res = self._resolve(
            {
                "alert_type": "worker_residency_expiry",
                "customer_id": str(self.company.pk),
                "worker_id": str(self.worker.pk),
                "field": "residency_expiry",
                "new_expiry_date": new_date.isoformat(),
            }
        )
        self.assertEqual(res.status_code, 200)
        self.worker.refresh_from_db()
        self.assertEqual(self.worker.residency_expiry, new_date)

    def test_warning_when_still_in_alert_window(self):
        new_date = date.today() + timedelta(days=10)
        res = self._resolve(
            {
                "alert_type": "license_expiry",
                "customer_id": str(self.company.pk),
                "field": "license_expiry",
                "new_expiry_date": new_date.isoformat(),
            }
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["alert_may_remain"])
        self.assertIsNotNone(body["warning"])
        self.assertLessEqual(body["days_until_expiry"], ALERT_THRESHOLD_DAYS)

    def test_create_linked_procedure(self):
        balance_before = self.company.balance
        card_before = self.card.balance
        new_date = date.today() + timedelta(days=120)
        res = self._resolve(
            {
                "alert_type": "license_expiry",
                "customer_id": str(self.company.pk),
                "field": "license_expiry",
                "new_expiry_date": new_date.isoformat(),
                "create_procedure": True,
                "procedure": {
                    "category": "License Renewal",
                    "description": "Renewal for license",
                    "cost": "100.00",
                    "selling_price": "250.00",
                    "paid": "250.00",
                    "cash_out_type": self.card.pk,
                    "cash_in_type": self.card.pk,
                    "status": "submitted",
                    "date": date.today().isoformat(),
                },
            }
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIsNotNone(res.json()["procedure"])
        self.assertEqual(Procedure.objects.filter(customer=self.company).count(), 1)
        self.company.refresh_from_db()
        self.card.refresh_from_db()
        self.assertEqual(self.company.balance, balance_before + Decimal("0.00"))
        self.assertEqual(self.card.balance, card_before - Decimal("100.00") + Decimal("250.00"))

    def test_procedure_accounting_matches_normal_create(self):
        balance_before = self.company.balance
        card_before = self.card.balance
        payload = {
            "customer": str(self.company.pk),
            "category": "Renewal",
            "description": "Normal create",
            "cost": "50.00",
            "selling_price": "150.00",
            "paid": "150.00",
            "cash_out_type": self.card.pk,
            "cash_in_type": self.card.pk,
            "status": "submitted",
            "date": date.today().isoformat(),
        }
        self.client.force_authenticate(self.admin)
        normal = self.client.post("/api/procedures/", payload, format="json")
        self.assertEqual(normal.status_code, 201, normal.content)
        self.company.refresh_from_db()
        self.card.refresh_from_db()
        expected_customer_balance = balance_before
        expected_card_balance = card_before - Decimal("50.00") + Decimal("150.00")
        self.assertEqual(self.company.balance, expected_customer_balance)
        self.assertEqual(self.card.balance, expected_card_balance)

    def test_cashier_cannot_create_procedure_from_alert(self):
        res = self._resolve(
            {
                "alert_type": "license_expiry",
                "customer_id": str(self.company.pk),
                "field": "license_expiry",
                "new_expiry_date": (date.today() + timedelta(days=120)).isoformat(),
                "create_procedure": True,
                "procedure": {
                    "category": "License Renewal",
                    "description": "Renewal",
                    "cost": "0",
                    "selling_price": "0",
                    "status": "submitted",
                },
            },
            user=self.cashier,
        )
        self.assertEqual(res.status_code, 403)

    def test_cashier_can_update_customer_expiry(self):
        new_date = date.today() + timedelta(days=120)
        res = self._resolve(
            {
                "alert_type": "license_expiry",
                "customer_id": str(self.company.pk),
                "field": "license_expiry",
                "new_expiry_date": new_date.isoformat(),
            },
            user=self.cashier,
        )
        self.assertEqual(res.status_code, 200)

    def test_cashier_cannot_update_worker_expiry(self):
        res = self._resolve(
            {
                "alert_type": "worker_residency_expiry",
                "customer_id": str(self.company.pk),
                "worker_id": str(self.worker.pk),
                "field": "residency_expiry",
                "new_expiry_date": (date.today() + timedelta(days=120)).isoformat(),
            },
            user=self.cashier,
        )
        self.assertEqual(res.status_code, 403)
