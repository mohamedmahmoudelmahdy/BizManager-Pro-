"""Internal API and workflow tests for Certificate Attestation."""

from __future__ import annotations

from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase, override_settings
from django.urls import reverse

from attestation.models import AttestationApplication
from attestation.tests.helpers import (
    make_pdf,
    public_submit_files,
    public_submit_payload,
    seed_hr_batch,
)


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
class InternalAttestationWorkflowTests(TestCase):
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

    def _auth(self, user):
        self.client.force_authenticate(user)

    def test_authentication_required(self):
        resp = self.client.get("/api/attestation/applications/")
        self.assertIn(resp.status_code, (401, 403))

    def test_employee_without_perm_denied(self):
        self._auth(self.ctx["employee"])
        resp = self.client.get("/api/attestation/applications/")
        self.assertEqual(resp.status_code, 403)

    def test_admin_list_search_filter_pagination(self):
        # second app
        self.client.force_authenticate(None)
        self.client.post(
            self.public_url,
            data={
                **public_submit_payload(full_name="Other Teacher", phone="+971501000002"),
                **public_submit_files(),
            },
            format="multipart",
        )
        self._auth(self.ctx["admin"])
        resp = self.client.get("/api/attestation/applications/?search=ATT-")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn("results", resp.json())
        self.assertGreaterEqual(resp.json()["count"], 2)

        resp = self.client.get(
            f"/api/attestation/applications/?search={self.app.full_name}"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(resp.json()["count"], 1)

        resp = self.client.get("/api/attestation/applications/?search=971501000001")
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(resp.json()["count"], 1)

        resp = self.client.get(
            "/api/attestation/applications/?status=documents_received"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(resp.json()["count"], 1)

    def test_detail_includes_internal_notes_not_storage_path(self):
        self._auth(self.ctx["admin"])
        self.client.patch(
            f"/api/attestation/applications/{self.app.pk}/",
            {"internal_notes": "Call applicant about stamp"},
            format="json",
        )
        resp = self.client.get(f"/api/attestation/applications/{self.app.pk}/")
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body["internal_notes"], "Call applicant about stamp")
        for doc in body["documents"]:
            self.assertNotIn("file", doc)
            self.assertIn("download_path", doc)
            self.assertTrue(doc["download_path"].startswith("/api/attestation/documents/"))

    def test_cannot_skip_to_mohesr(self):
        self._auth(self.ctx["admin"])
        resp = self.client.post(
            f"/api/attestation/applications/{self.app.pk}/set-mohesr/",
            {
                "mohesr_reference": "MH-1",
                "mohesr_payment_proof": make_pdf("m.pdf"),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"]["code"], "attestation_invalid_transition")

    def test_full_happy_path_workflow(self):
        self._auth(self.ctx["admin"])
        # DataFlow required fields
        resp = self.client.post(
            f"/api/attestation/applications/{self.app.pk}/set-dataflow/",
            format="multipart",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(
            resp.json()["error"]["code"], "attestation_dataflow_details_required"
        )

        resp = self.client.post(
            f"/api/attestation/applications/{self.app.pk}/set-dataflow/",
            {
                "dataflow_reference": "DF-100",
                "dataflow_submitted_at": "2026-08-10",
                "dataflow_payment_proof": make_pdf("df_pay.pdf"),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["status"], "dataflow_in_progress")

        resp = self.client.post(
            f"/api/attestation/applications/{self.app.pk}/set-mohesr/",
            {
                "mohesr_reference": "MH-200",
                "mohesr_submitted_at": "2026-08-20",
                "mohesr_payment_proof": make_pdf("mh_pay.pdf"),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["status"], "mohesr_in_progress")

        resp = self.client.post(
            f"/api/attestation/applications/{self.app.pk}/complete/",
            format="multipart",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(
            resp.json()["error"]["code"], "attestation_final_equivalency_required"
        )

        resp = self.client.post(
            f"/api/attestation/applications/{self.app.pk}/complete/",
            {"final_equivalency": make_pdf("equiv.pdf")},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["status"], "completed")
        self.assertIsNotNone(resp.json()["completed_at"])
        self.assertGreaterEqual(len(resp.json()["status_history"]), 4)

    def test_document_download_requires_auth(self):
        self._auth(self.ctx["admin"])
        detail = self.client.get(f"/api/attestation/applications/{self.app.pk}/").json()
        doc_id = detail["documents"][0]["id"]
        self.client.force_authenticate(None)
        resp = self.client.get(f"/api/attestation/documents/{doc_id}/download/")
        self.assertIn(resp.status_code, (401, 403))

        self._auth(self.ctx["admin"])
        resp = self.client.get(f"/api/attestation/documents/{doc_id}/download/")
        self.assertEqual(resp.status_code, 200)

    def test_django_permission_grants_employee_access(self):
        emp = self.ctx["employee"]
        ct = ContentType.objects.get_for_model(AttestationApplication)
        perm = Permission.objects.get(
            content_type=ct, codename="view_attestationapplication"
        )
        emp.user_permissions.add(perm)
        self._auth(emp)
        resp = self.client.get("/api/attestation/applications/")
        self.assertEqual(resp.status_code, 200, resp.content)
