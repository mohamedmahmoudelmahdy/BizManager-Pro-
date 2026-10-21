"""API tests for employee expense claim workflow (Phase 4.0)."""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.services.role_groups import sync_role_managed_groups
from banking.models import BankCard
from expenses.groups import seed_expense_groups
from expenses.models import ExpenseAuditEvent

User = get_user_model()


def _grant(user, *codenames):
    for code in codenames:
        perm = Permission.objects.get(content_type__app_label="expenses", codename=code)
        user.user_permissions.add(perm)
    return User.objects.get(pk=user.pk)


class EmployeeExpenseWorkflowTests(TestCase):
    def setUp(self):
        seed_expense_groups()
        self.client = APIClient()
        self.employee = User.objects.create_user(
            username="emp-exp", password="pass", role=User.Roles.EMPLOYEE, first_name="Emp"
        )
        sync_role_managed_groups(self.employee)
        self.employee = User.objects.get(pk=self.employee.pk)

        self.other = User.objects.create_user(
            username="emp-other", password="pass", role=User.Roles.EMPLOYEE
        )
        sync_role_managed_groups(self.other)
        self.other = User.objects.get(pk=self.other.pk)

        self.manager = User.objects.create_user(
            username="mgr-exp", password="pass", role=User.Roles.MANAGER, first_name="Mgr"
        )
        self.card = BankCard.objects.create(
            bank_name="Test Bank", account_number="111", balance=Decimal("1000.00")
        )

    def _auth(self, user):
        self.client.force_authenticate(user)

    def _create_draft(self, user=None, **overrides):
        self._auth(user or self.employee)
        payload = {
            "category": "office",
            "date": "2026-07-20",
            "amount": "55.50",
            "merchant": "Office Depot",
            "business_purpose": "Printer paper",
            "notes": "Q3 supplies",
        }
        payload.update(overrides)
        return self.client.post("/api/expenses/", payload, format="json")

    def test_employee_creates_own_draft(self):
        response = self._create_draft()
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertEqual(data["workflow_status"], "draft")
        self.assertEqual(data["submitted_by"]["id"], self.employee.pk)
        self.assertEqual(data["expense_for_user"]["id"], self.employee.pk)
        self.assertTrue(data["expense_number"])
        self.assertIsNone(data["paid_by"])

    def test_employee_cannot_set_arbitrary_owners(self):
        response = self._create_draft(
            submitted_by=self.other.pk,
            approved_by=self.manager.pk,
            expense_for=self.other.pk,
        )
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertEqual(data["submitted_by"]["id"], self.employee.pk)
        self.assertEqual(data["expense_for_user"]["id"], self.employee.pk)
        self.assertIsNone(data.get("approved_by_user"))

    def test_employee_sees_only_own_expenses(self):
        self._create_draft()
        self._auth(self.other)
        self.client.post(
            "/api/expenses/",
            {
                "category": "misc",
                "date": "2026-07-21",
                "amount": "10.00",
                "business_purpose": "Taxi",
            },
            format="json",
        )
        self._auth(self.employee)
        listing = self.client.get("/api/expenses/?mine=1")
        self.assertEqual(listing.status_code, 200)
        rows = listing.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["submitted_by"]["id"], self.employee.pk)

    def test_draft_editable_submitted_not(self):
        created = self._create_draft().json()
        eid = created["id"]
        patch = self.client.patch(
            f"/api/expenses/{eid}/",
            {"amount": "60.00", "merchant": "Updated"},
            format="json",
        )
        self.assertEqual(patch.status_code, 200, patch.content)
        self.assertEqual(Decimal(patch.json()["amount"]), Decimal("60.00"))

        submit = self.client.post(f"/api/expenses/{eid}/submit/")
        self.assertEqual(submit.status_code, 200, submit.content)
        self.assertEqual(submit.json()["workflow_status"], "submitted")
        self.assertTrue(
            ExpenseAuditEvent.objects.filter(
                expense_id=eid, action=ExpenseAuditEvent.Action.SUBMITTED
            ).exists()
        )

        blocked = self.client.patch(
            f"/api/expenses/{eid}/", {"amount": "99.00"}, format="json"
        )
        self.assertEqual(blocked.status_code, 400)

    def test_submit_requires_business_purpose(self):
        created = self._create_draft(business_purpose="").json()
        response = self.client.post(f"/api/expenses/{created['id']}/submit/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "expense_not_submittable")

    def test_employee_cannot_approve_own(self):
        created = self._create_draft().json()
        self.client.post(f"/api/expenses/{created['id']}/submit/")
        emp = _grant(self.employee, "approve_expense")
        self._auth(emp)
        response = self.client.post(f"/api/expenses/{created['id']}/approve/")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "self_approval_not_allowed")

    def test_manager_return_approve_and_mark_paid(self):
        created = self._create_draft().json()
        eid = created["id"]
        self.client.post(f"/api/expenses/{eid}/submit/")

        self._auth(self.manager)
        returned = self.client.post(
            f"/api/expenses/{eid}/return/",
            {"reason": "Need clearer purpose"},
            format="json",
        )
        self.assertEqual(returned.status_code, 200, returned.content)
        self.assertEqual(returned.json()["workflow_status"], "returned")

        self._auth(self.employee)
        self.client.patch(
            f"/api/expenses/{eid}/",
            {"business_purpose": "Printer paper for HQ"},
            format="json",
        )
        self.client.post(f"/api/expenses/{eid}/submit/")

        self._auth(self.manager)
        reject = self.client.post(
            f"/api/expenses/{eid}/reject/", {"reason": ""}, format="json"
        )
        self.assertEqual(reject.status_code, 400)

        created2 = self._create_draft(amount="40.00").json()
        eid2 = created2["id"]
        self.client.post(f"/api/expenses/{eid2}/submit/")
        self._auth(self.manager)
        approved = self.client.post(f"/api/expenses/{eid2}/approve/")
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.json()["workflow_status"], "approved")

        paid = self.client.post(
            f"/api/expenses/{eid2}/mark-paid/",
            {"paid_by": str(self.card.pk), "payment_reference": "TRX-1"},
            format="json",
        )
        self.assertEqual(paid.status_code, 200, paid.content)
        self.assertEqual(paid.json()["workflow_status"], "paid")
        self.card.refresh_from_db()
        self.assertEqual(self.card.balance, Decimal("960.00"))

        dup = self.client.post(
            f"/api/expenses/{eid2}/mark-paid/",
            {"paid_by": str(self.card.pk)},
            format="json",
        )
        self.assertEqual(dup.status_code, 409)
        self.assertEqual(dup.json()["error"]["code"], "duplicate_payment")

    def test_employee_cannot_mark_paid(self):
        created = self._create_draft().json()
        self.client.post(f"/api/expenses/{created['id']}/submit/")
        self._auth(self.manager)
        self.client.post(f"/api/expenses/{created['id']}/approve/")
        self._auth(self.employee)
        response = self.client.post(
            f"/api/expenses/{created['id']}/mark-paid/",
            {"paid_by": str(self.card.pk)},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_put_and_delete_not_allowed(self):
        created = self._create_draft().json()
        eid = created["id"]
        self.assertEqual(
            self.client.put(f"/api/expenses/{eid}/", {}, format="json").status_code, 405
        )
        self.assertEqual(self.client.delete(f"/api/expenses/{eid}/").status_code, 405)

    def test_receipt_upload_on_draft(self):
        created = self._create_draft().json()
        eid = created["id"]
        upload = SimpleUploadedFile(
            "receipt.pdf", b"%PDF-1.4 receipt", content_type="application/pdf"
        )
        response = self.client.post(
            f"/api/expenses/{eid}/receipts/",
            {"file": upload},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()["attachments"]), 1)

    def test_other_employee_cannot_view_claim(self):
        created = self._create_draft().json()
        eid = created["id"]
        self._auth(self.other)
        response = self.client.get(f"/api/expenses/{eid}/")
        self.assertIn(response.status_code, (403, 404))

    def test_manager_sees_claims(self):
        self._create_draft()
        self._auth(self.manager)
        listing = self.client.get("/api/expenses/")
        self.assertEqual(listing.status_code, 200)
        self.assertGreaterEqual(len(listing.json()), 1)

    def test_operational_create_still_debits(self):
        self._auth(self.manager)
        response = self.client.post(
            "/api/expenses/",
            {
                "category": "office",
                "date": "2026-07-22",
                "amount": "25.00",
                "paid_by": str(self.card.pk),
                "notes": "ops",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["workflow_status"], "paid")
        self.card.refresh_from_db()
        self.assertEqual(self.card.balance, Decimal("975.00"))
