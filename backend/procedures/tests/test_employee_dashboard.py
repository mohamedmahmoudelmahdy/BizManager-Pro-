"""Regression tests for employee procedure assignment used by dashboard counts."""

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


class EmployeeDashboardProcedureAssignmentTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="admindash", password="pass", role=User.Roles.ADMIN)
        self.employee = User.objects.create_user(
            username="empdash", password="pass", role=User.Roles.EMPLOYEE
        )
        EmployeeProfile.objects.create(user=self.employee, full_name="Employee Display Name")
        self.other_employee = User.objects.create_user(
            username="otherdash", password="pass", role=User.Roles.EMPLOYEE
        )
        EmployeeProfile.objects.create(user=self.other_employee, full_name="Other Employee")

        self.customer = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Dash Co",
            company_name="Dash Co",
        )
        self.card = BankCard.objects.create(
            bank_name="Cash",
            cardholder_name="Office",
            card_type="Cash",
            card_number="9999",
            last4="9999",
            expiry_month="12",
            expiry_year="2030",
            balance=Decimal("1000.00"),
        )
        self.client = APIClient()

        today = date.today()
        Procedure.objects.create(
            customer=self.customer,
            category="This Month Assigned",
            cost=Decimal("10.00"),
            selling_price=Decimal("20.00"),
            assigned_employee=self.employee,
            date=today,
            status=Procedure.Status.SUBMITTED,
        )
        Procedure.objects.create(
            customer=self.customer,
            category="Other Employee",
            cost=Decimal("10.00"),
            selling_price=Decimal("20.00"),
            assigned_employee=self.other_employee,
            date=today,
            status=Procedure.Status.SUBMITTED,
        )

    def test_employee_list_returns_only_assigned_procedures(self):
        self.client.force_authenticate(self.employee)
        response = self.client.get("/api/procedures/")
        self.assertEqual(response.status_code, 200)
        rows = response.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["assigned_employee"], self.employee.pk)
        self.assertEqual(rows[0]["assigned_employee_name"], "Employee Display Name")

    def test_employee_create_assigns_current_user_not_username(self):
        self.client.force_authenticate(self.employee)
        response = self.client.post(
            "/api/procedures/",
            {
                "customer": str(self.customer.pk),
                "category": "New Entry",
                "description": "",
                "cost": "0.00",
                "selling_price": "0.00",
                "paid": "0.00",
                "cash_in": "0.00",
                "cash_out_type": None,
                "cash_in_type": None,
                "customer_card_mode": True,
                "status": "submitted",
                "assigned_employee": None,
                "date": date.today().isoformat(),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body["assigned_employee"], self.employee.pk)
        self.assertNotEqual(body["assigned_employee_name"], self.employee.username)

    def test_admin_list_unfiltered(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/procedures/")
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.json()), 2)
