"""Attestation Employee group: full operational workflow for synced employees."""

from __future__ import annotations

from django.contrib.auth.models import Group
from django.test import TestCase, override_settings
from django.urls import reverse

from accounts.models import User
from accounts.services.role_groups import sync_role_managed_groups
from attestation.groups import (
    GROUP_ATTESTATION_EMPLOYEE,
    seed_attestation_employee_groups,
    seed_hr_portal_groups,
)
from attestation.models import AttestationApplication, AttestationAuditEvent
from attestation.tests.helpers import (
    make_pdf,
    public_submit_files,
    public_submit_payload,
    seed_hr_batch,
)
from banking.models import BankCard
from customers.models import Customer
from expenses.models import Expense
from payments.models import Payment
from procedures.models import Procedure


@override_settings(
    REST_FRAMEWORK={
        "DEFAULT_AUTHENTICATION_CLASSES": (
            "rest_framework_simplejwt.authentication.JWTAuthentication",
        ),
        "DEFAULT_PERMISSION_CLASSES": (
            "rest_framework.permissions.IsAuthenticated",
        ),
        "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
        "PAGE_SIZE": 20,
        "DEFAULT_THROTTLE_RATES": {
            "attestation_public_submit": "1000/hour",
        },
    }
)
class AttestationEmployeeAccessTests(TestCase):
    def setUp(self):
        self.ctx = seed_hr_batch()
        self.client = self.ctx["client"]
        self.public_url = reverse(
            "public-attestation-submit",
            kwargs={"public_slug": self.ctx["batch"].public_slug},
        )
        resp = self.client.post(
            self.public_url,
            data={
                **public_submit_payload(full_name="Teacher One", phone="+971501000001"),
                **public_submit_files(),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.app = AttestationApplication.objects.get(
            reference_number=resp.json()["reference_number"]
        )
        self.employee = self.ctx["employee"]
        sync_role_managed_groups(self.employee)
        self.employee = User.objects.get(pk=self.employee.pk)

    def _auth(self, user):
        self.client.force_authenticate(user)

    def _financial_snapshot(self):
        return {
            "procedures": Procedure.objects.count(),
            "payments": Payment.objects.count(),
            "expenses": Expense.objects.count(),
            "customers": Customer.objects.count(),
            "cards": BankCard.objects.count(),
            "balances": list(
                Customer.objects.order_by("pk").values_list("pk", "balance")
            ),
            "card_balances": list(
                BankCard.objects.order_by("pk").values_list("pk", "balance")
            ),
        }

    def test_seed_attestation_employee_group_operational_perms(self):
        group = seed_attestation_employee_groups()
        self.assertEqual(group.name, GROUP_ATTESTATION_EMPLOYEE)
        codenames = set(group.permissions.values_list("codename", flat=True))
        self.assertEqual(
            codenames,
            {
                "view_attestationapplication",
                "change_attestationapplication",
                "process_attestationapplication",
                "view_internal_notes",
            },
        )
        self.assertNotIn("manage_attestationbatch", codenames)
        self.assertNotIn("view_hr_attestation_portal", codenames)
        # Idempotent re-seed refreshes perms for existing groups
        seed_attestation_employee_groups()
        self.assertEqual(Group.objects.filter(name=GROUP_ATTESTATION_EMPLOYEE).count(), 1)
        self.assertEqual(
            set(
                Group.objects.get(name=GROUP_ATTESTATION_EMPLOYEE).permissions.values_list(
                    "codename", flat=True
                )
            ),
            codenames,
        )

    def test_synced_employee_receives_operational_permissions(self):
        self.assertTrue(
            self.employee.groups.filter(name=GROUP_ATTESTATION_EMPLOYEE).exists()
        )
        perms = self.employee.get_all_permissions()
        for code in (
            "attestation.view_attestationapplication",
            "attestation.change_attestationapplication",
            "attestation.process_attestationapplication",
            "attestation.view_internal_notes",
        ):
            self.assertIn(code, perms)
        self.assertNotIn("attestation.manage_attestationbatch", perms)
        self.assertNotIn("attestation.view_hr_attestation_portal", perms)

    def test_api_me_syncs_operational_permissions(self):
        fresh = User.objects.create_user(
            username="emp-attest-me",
            password="pass",
            role=User.Roles.EMPLOYEE,
        )
        self.client.force_authenticate(user=fresh)
        response = self.client.get("/api/me/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(GROUP_ATTESTATION_EMPLOYEE, response.data["groups"])
        self.assertEqual(response.data["portal_type"], "internal")
        for code in (
            "attestation.view_attestationapplication",
            "attestation.change_attestationapplication",
            "attestation.process_attestationapplication",
            "attestation.view_internal_notes",
        ):
            self.assertIn(code, response.data["permissions"])

    def test_synced_employee_can_list_and_retrieve_with_notes(self):
        self._auth(self.ctx["admin"])
        self.client.patch(
            f"/api/attestation/applications/{self.app.pk}/",
            {"internal_notes": "call applicant"},
            format="json",
        )
        self._auth(self.employee)
        resp = self.client.get("/api/attestation/applications/")
        self.assertEqual(resp.status_code, 200, resp.content)
        detail = self.client.get(f"/api/attestation/applications/{self.app.pk}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        body = detail.json()
        self.assertEqual(body["full_name"], "Teacher One")
        self.assertEqual(body["internal_notes"], "call applicant")

    def test_synced_employee_can_edit_notes(self):
        self._auth(self.employee)
        resp = self.client.patch(
            f"/api/attestation/applications/{self.app.pk}/",
            {"internal_notes": "employee note"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["internal_notes"], "employee note")
        self.app.refresh_from_db()
        self.assertEqual(self.app.internal_notes, "employee note")
        self.assertTrue(
            AttestationAuditEvent.objects.filter(
                application=self.app,
                event_type=AttestationAuditEvent.EventType.NOTES_UPDATED,
                actor_user=self.employee,
            ).exists()
        )

    def test_employee_full_happy_path_workflow(self):
        """Employee can DataFlow → MOHESR → Complete with docs; no finance side effects."""
        before = self._financial_snapshot()
        self._auth(self.employee)

        # Cannot skip to MOHESR
        skip = self.client.post(
            f"/api/attestation/applications/{self.app.pk}/set-mohesr/",
            {
                "mohesr_reference": "MH-SKIP",
                "mohesr_submitted_at": "2026-09-02",
                "mohesr_payment_proof": make_pdf("mh_skip.pdf"),
            },
            format="multipart",
        )
        self.assertEqual(skip.status_code, 400)
        self.assertEqual(skip.json()["error"]["code"], "attestation_invalid_transition")

        # Save + transition DataFlow
        save_df = self.client.post(
            f"/api/attestation/applications/{self.app.pk}/save-dataflow/",
            {
                "dataflow_reference": "DF-EMP",
                "dataflow_submitted_at": "2026-09-01",
                "dataflow_payment_proof": make_pdf("df_pay.pdf"),
                "dataflow_result": make_pdf("df_result.pdf"),
            },
            format="multipart",
        )
        self.assertEqual(save_df.status_code, 200, save_df.content)

        set_df = self.client.post(
            f"/api/attestation/applications/{self.app.pk}/set-dataflow/",
            format="multipart",
        )
        self.assertEqual(set_df.status_code, 200, set_df.content)
        self.assertEqual(set_df.json()["status"], "dataflow_in_progress")
        self.assertTrue(
            AttestationAuditEvent.objects.filter(
                application=self.app,
                event_type=AttestationAuditEvent.EventType.DATAFLOW_TRANSITION,
                actor_user=self.employee,
            ).exists()
        )

        # Cannot complete early
        early = self.client.post(
            f"/api/attestation/applications/{self.app.pk}/complete/",
            {"final_equivalency": make_pdf("early.pdf")},
            format="multipart",
        )
        self.assertEqual(early.status_code, 400)

        # MOHESR
        set_mh = self.client.post(
            f"/api/attestation/applications/{self.app.pk}/set-mohesr/",
            {
                "mohesr_reference": "MH-EMP",
                "mohesr_submitted_at": "2026-09-02",
                "mohesr_payment_proof": make_pdf("mh_pay.pdf"),
            },
            format="multipart",
        )
        self.assertEqual(set_mh.status_code, 200, set_mh.content)
        self.assertEqual(set_mh.json()["status"], "mohesr_in_progress")

        # Complete requires final equivalency
        missing = self.client.post(
            f"/api/attestation/applications/{self.app.pk}/complete/",
            format="multipart",
        )
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(
            missing.json()["error"]["code"], "attestation_final_equivalency_required"
        )

        done = self.client.post(
            f"/api/attestation/applications/{self.app.pk}/complete/",
            {"final_equivalency": make_pdf("equiv.pdf")},
            format="multipart",
        )
        self.assertEqual(done.status_code, 200, done.content)
        body = done.json()
        self.assertEqual(body["status"], "completed")
        self.assertIsNotNone(body["completed_at"])
        self.assertGreaterEqual(len(body["status_history"]), 4)
        usernames = {
            h.get("changed_by_username")
            for h in body["status_history"]
            if h.get("changed_by_username")
        }
        self.assertIn(self.employee.username, usernames)

        self.assertTrue(
            AttestationAuditEvent.objects.filter(
                application=self.app,
                event_type=AttestationAuditEvent.EventType.COMPLETED,
                actor_user=self.employee,
            ).exists()
        )

        after = self._financial_snapshot()
        self.assertEqual(before, after)

    def test_manager_can_still_process(self):
        self._auth(self.ctx["manager"])
        resp = self.client.post(
            f"/api/attestation/applications/{self.app.pk}/set-dataflow/",
            {
                "dataflow_reference": "DF-MGR",
                "dataflow_submitted_at": "2026-09-01",
                "dataflow_payment_proof": make_pdf("df_mgr.pdf"),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["status"], "dataflow_in_progress")

    def test_admin_list_unchanged(self):
        self._auth(self.ctx["admin"])
        resp = self.client.get("/api/attestation/applications/")
        self.assertEqual(resp.status_code, 200)

    def test_hr_client_remains_read_only_on_internal_apis(self):
        seed_hr_portal_groups()
        hr = User.objects.create_user(
            username="hr-no-internal",
            password="pass",
            role=User.Roles.HR_CLIENT,
        )
        sync_role_managed_groups(hr)
        self._auth(hr)
        self.assertEqual(self.client.get("/api/attestation/applications/").status_code, 403)
        self.assertEqual(
            self.client.patch(
                f"/api/attestation/applications/{self.app.pk}/",
                {"internal_notes": "hr note"},
                format="json",
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                f"/api/attestation/applications/{self.app.pk}/set-dataflow/",
                {
                    "dataflow_reference": "DF-HR",
                    "dataflow_submitted_at": "2026-09-01",
                    "dataflow_payment_proof": make_pdf("df_hr.pdf"),
                },
                format="multipart",
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                f"/api/attestation/applications/{self.app.pk}/set-mohesr/",
                {
                    "mohesr_reference": "MH-HR",
                    "mohesr_submitted_at": "2026-09-02",
                    "mohesr_payment_proof": make_pdf("mh_hr.pdf"),
                },
                format="multipart",
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                f"/api/attestation/applications/{self.app.pk}/complete/",
                {"final_equivalency": make_pdf("eq_hr.pdf")},
                format="multipart",
            ).status_code,
            403,
        )

    def test_public_unauthenticated_cannot_access_internal_api(self):
        self.client.force_authenticate(None)
        resp = self.client.get("/api/attestation/applications/")
        self.assertIn(resp.status_code, (401, 403))
        resp = self.client.get(f"/api/attestation/applications/{self.app.pk}/")
        self.assertIn(resp.status_code, (401, 403))
        resp = self.client.patch(
            f"/api/attestation/applications/{self.app.pk}/",
            {"internal_notes": "public"},
            format="json",
        )
        self.assertIn(resp.status_code, (401, 403))

    def test_employee_without_group_still_denied(self):
        bare = User.objects.create_user(
            username="emp-bare-attest",
            password="pass",
            role=User.Roles.EMPLOYEE,
        )
        self._auth(bare)
        resp = self.client.get("/api/attestation/applications/")
        self.assertEqual(resp.status_code, 403)
