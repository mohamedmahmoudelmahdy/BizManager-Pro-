"""Security and scoping tests for the HR attestation portal."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.services.role_groups import sync_role_managed_groups
from attestation.groups import seed_hr_portal_groups
from attestation.models import (
    ApplicationDocument,
    AttestationApplication,
    AttestationBatch,
    HRPortalProfile,
)
from attestation.tests.helpers import (
    public_submit_files,
    public_submit_payload,
    seed_hr_batch,
)
from customers.models import Customer
from procedures.models import Procedure
from procedures.services.create_with_accounting import create_procedure_with_accounting

User = get_user_model()


def _make_pdf(name="x.pdf"):
    return SimpleUploadedFile(name, b"%PDF-1.4 hr", content_type="application/pdf")


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
        "DEFAULT_THROTTLE_RATES": {"attestation_public_submit": "1000/hour"},
    }
)
class HRAttestationPortalSecurityTests(TestCase):
    def setUp(self):
        seed_hr_portal_groups()
        self.ctx = seed_hr_batch(slug="hr-portal-batch-a")
        self.client = APIClient()

        # Public application for customer A
        resp = self.client.post(
            f"/api/public/attestation/{self.ctx['batch'].public_slug}/applications/",
            data={
                **public_submit_payload(full_name="Teacher A", phone="+971501111111"),
                **public_submit_files(),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.app_a = AttestationApplication.objects.get(
            reference_number=resp.json()["reference_number"]
        )

        # Second customer + batch + application
        self.customer_b = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Other Org",
            company_name="Other Org LLC",
            phone="0502223344",
            balance=Decimal("0.00"),
        )
        procedure_b = create_procedure_with_accounting(
            user=self.ctx["admin"],
            validated_data={
                "customer": self.customer_b,
                "category": "Certificate Attestation",
                "description": "Other batch",
                "cost": Decimal("0.00"),
                "selling_price": Decimal("0.00"),
                "paid": Decimal("0.00"),
                "cash_in": Decimal("0.00"),
                "cash_out_type": self.ctx["card"],
                "cash_in_type": None,
                "status": Procedure.Status.SUBMITTED,
                "assigned_employee": None,
                "date": date(2026, 8, 1),
            },
            raw_data={},
        )
        self.batch_b = AttestationBatch.objects.create(
            customer=self.customer_b,
            linked_procedure=procedure_b,
            title="Other Batch",
            expected_applicant_count=10,
            is_active=True,
            public_slug="hr-portal-batch-b",
        )
        resp_b = self.client.post(
            f"/api/public/attestation/{self.batch_b.public_slug}/applications/",
            data={
                **public_submit_payload(full_name="Teacher B", phone="+971502222222"),
                **public_submit_files(),
            },
            format="multipart",
        )
        self.assertEqual(resp_b.status_code, 201, resp_b.content)
        self.app_b = AttestationApplication.objects.get(
            reference_number=resp_b.json()["reference_number"]
        )

        # HR user for customer A
        self.hr_user = User.objects.create_user(
            username="hr-a", password="pass", role=User.Roles.HR_CLIENT
        )
        HRPortalProfile.objects.create(
            user=self.hr_user, customer=self.ctx["customer"], is_active=True
        )
        sync_role_managed_groups(self.hr_user)

        # Add an internal-only document on app A
        ApplicationDocument.objects.create(
            application=self.app_a,
            document_type=ApplicationDocument.DocumentType.OTHER_INTERNAL,
            visibility=ApplicationDocument.Visibility.INTERNAL,
            file=_make_pdf("secret.pdf"),
            original_filename="secret.pdf",
            content_type="application/pdf",
            size_bytes=12,
        )

    def test_unauthenticated_overview_denied(self):
        resp = self.client.get("/api/hr/attestation/overview/")
        self.assertIn(resp.status_code, (401, 403))

    def test_hr_overview_scoped(self):
        self.client.force_authenticate(self.hr_user)
        resp = self.client.get("/api/hr/attestation/overview/")
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body["summary"]["submitted"], 1)
        self.assertEqual(body["batch"]["expected_applicant_count"], 54)
        self.assertNotIn("selling_price", str(body))
        self.assertNotIn("balance", str(body))

    def test_hr_list_own_customer_only(self):
        self.client.force_authenticate(self.hr_user)
        resp = self.client.get("/api/hr/attestation/applications/")
        self.assertEqual(resp.status_code, 200, resp.content)
        refs = {r["reference_number"] for r in resp.json()["results"]}
        self.assertIn(self.app_a.reference_number, refs)
        self.assertNotIn(self.app_b.reference_number, refs)

    def test_hr_detail_own_and_hidden_other(self):
        self.client.force_authenticate(self.hr_user)
        ok = self.client.get(f"/api/hr/attestation/applications/{self.app_a.pk}/")
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertNotIn("internal_notes", ok.json())
        doc_types = {d["document_type"] for d in ok.json()["documents"]}
        self.assertNotIn("other_internal", doc_types)

        hidden = self.client.get(f"/api/hr/attestation/applications/{self.app_b.pk}/")
        self.assertEqual(hidden.status_code, 404)

    def test_hr_cannot_download_internal_or_other_customer(self):
        self.client.force_authenticate(self.hr_user)
        detail = self.client.get(
            f"/api/hr/attestation/applications/{self.app_a.pk}/"
        ).json()
        passport_id = next(
            d["id"] for d in detail["documents"] if d["document_type"] == "passport"
        )
        ok = self.client.get(f"/api/hr/attestation/documents/{passport_id}/download/")
        self.assertEqual(ok.status_code, 200)

        internal = ApplicationDocument.objects.get(
            application=self.app_a, document_type="other_internal"
        )
        bad = self.client.get(f"/api/hr/attestation/documents/{internal.pk}/download/")
        self.assertEqual(bad.status_code, 404)

        other_passport = self.app_b.documents.get(document_type="passport")
        bad2 = self.client.get(
            f"/api/hr/attestation/documents/{other_passport.pk}/download/"
        )
        self.assertEqual(bad2.status_code, 404)

    def test_hr_mutations_not_allowed(self):
        self.client.force_authenticate(self.hr_user)
        url = f"/api/hr/attestation/applications/{self.app_a.pk}/"
        self.assertEqual(self.client.post(url, {}).status_code, 405)
        self.assertEqual(
            self.client.patch(url, {"internal_notes": "x"}, format="json").status_code,
            405,
        )
        self.assertEqual(self.client.put(url, {}).status_code, 405)
        self.assertEqual(self.client.delete(url).status_code, 405)

        # Internal processing endpoints remain staff-only
        forbidden = self.client.post(
            f"/api/attestation/applications/{self.app_a.pk}/complete/",
            format="multipart",
        )
        self.assertIn(forbidden.status_code, (403, 401))

    def test_search_and_status_filter_scoped(self):
        self.client.force_authenticate(self.hr_user)
        resp = self.client.get("/api/hr/attestation/applications/?search=Teacher%20A")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["count"], 1)
        resp = self.client.get(
            "/api/hr/attestation/applications/?status=documents_received"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(resp.json()["count"], 1)

    def test_me_exposes_hr_customer_context(self):
        self.client.force_authenticate(self.hr_user)
        resp = self.client.get("/api/me/")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["portal_type"], "hr")
        self.assertEqual(body["customer"]["id"], str(self.ctx["customer"].pk))
        self.assertNotIn("balance", body.get("customer") or {})
