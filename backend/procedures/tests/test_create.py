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


class ProcedureCreateTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="adminproc", password="pass", role=User.Roles.ADMIN)
        self.manager = User.objects.create_user(username="mgrproc", password="pass", role=User.Roles.MANAGER)
        self.employee = User.objects.create_user(
            username="empproc", password="pass", role=User.Roles.EMPLOYEE
        )
        EmployeeProfile.objects.create(user=self.employee, full_name="Employee One")
        self.other_employee = User.objects.create_user(
            username="empother", password="pass", role=User.Roles.EMPLOYEE
        )
        EmployeeProfile.objects.create(user=self.other_employee, full_name="Employee Two")

        self.customer = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Test Co",
            company_name="Test Co",
            balance=Decimal("0.00"),
        )
        self.card = BankCard.objects.create(
            bank_name="Cash Box",
            cardholder_name="Office",
            card_type="Cash",
            card_number="1111",
            last4="1111",
            expiry_month="12",
            expiry_year="2030",
            balance=Decimal("500.00"),
        )
        self.low_balance_card = BankCard.objects.create(
            bank_name="Low Cash",
            cardholder_name="Office",
            card_type="Cash",
            card_number="2222",
            last4="2222",
            expiry_month="12",
            expiry_year="2030",
            balance=Decimal("10.00"),
        )
        self.client = APIClient()

    def _payload(self, **overrides):
        data = {
            "customer": str(self.customer.pk),
            "category": "Visa Renewal",
            "description": "Test procedure",
            "cost": "50.00",
            "selling_price": "150.00",
            "paid": "0.00",
            "cash_in": "0.00",
            "cash_out_type": self.card.pk,
            "cash_in_type": None,
            "customer_card_mode": False,
            "status": "submitted",
            "assigned_employee": None,
            "date": date.today().isoformat(),
        }
        data.update(overrides)
        return data

    def test_admin_can_create_procedure(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/procedures/", self._payload(), format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Procedure.objects.count(), 1)

    def test_manager_can_create_procedure(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post("/api/procedures/", self._payload(), format="json")
        self.assertEqual(response.status_code, 201, response.content)

    def test_employee_can_create_procedure_assigned_to_self(self):
        self.client.force_authenticate(self.employee)
        response = self.client.post(
            "/api/procedures/",
            self._payload(assigned_employee=None),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        procedure = Procedure.objects.get()
        self.assertEqual(procedure.assigned_employee_id, self.employee.pk)

    def test_employee_cannot_assign_procedure_to_other_employee(self):
        self.client.force_authenticate(self.employee)
        response = self.client.post(
            "/api/procedures/",
            self._payload(assigned_employee=self.other_employee.pk),
            format="json",
        )
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(Procedure.objects.count(), 0)

    def test_insufficient_cash_out_balance_blocks_create(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/procedures/",
            self._payload(cash_out_type=self.low_balance_card.pk, cost="50.00"),
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("cost", response.json())
        self.assertEqual(Procedure.objects.count(), 0)
