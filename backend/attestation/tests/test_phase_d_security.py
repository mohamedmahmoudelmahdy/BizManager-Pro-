"""Phase D production hardening / security regression tests."""

from __future__ import annotations

import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.services.role_groups import sync_role_managed_groups
from attestation.groups import seed_hr_portal_groups
from attestation.models import (
    ApplicationDocument,
    AttestationApplication,
    AttestationAuditEvent,
    HRPortalProfile,
)
from attestation.services.downloads import sanitize_download_filename
from attestation.services.malware import NullMalwareScanner
from attestation.storage import get_attestation_storage
from attestation.tests.helpers import (
    make_exe_as_pdf,
    make_html_as_jpg,
    make_jpeg,
    make_pdf,
    make_png,
    make_svg,
    public_submit_files,
    public_submit_payload,
    seed_hr_batch,
)
from customers.models import Customer
from procedures.models import Procedure
from procedures.services.create_with_accounting import create_procedure_with_accounting

User = get_user_model()

_RF = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_THROTTLE_RATES": {
        "attestation_public_submit": "1000/hour",
        "login": "1000/minute",
    },
}


@override_settings(REST_FRAMEWORK=_RF)
class PhaseDDocumentSecurityTests(TestCase):
    def setUp(self):
        seed_hr_portal_groups()
        self.ctx = seed_hr_batch(slug="phase-d-docs")
        self.client = APIClient()
        resp = self.client.post(
            f"/api/public/attestation/{self.ctx['batch'].public_slug}/applications/",
            data={**public_submit_payload(), **public_submit_files()},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.app = AttestationApplication.objects.get(
            reference_number=resp.json()["reference_number"]
        )
        self.passport = self.app.documents.get(
            document_type=ApplicationDocument.DocumentType.PASSPORT
        )
        self.hr_user = User.objects.create_user(
            username="hr-d", password="pass1234567", role=User.Roles.HR_CLIENT
        )
        sync_role_managed_groups(self.hr_user)
        HRPortalProfile.objects.create(
            user=self.hr_user, customer=self.ctx["customer"], is_active=True
        )
        internal = ApplicationDocument.objects.create(
            application=self.app,
            document_type=ApplicationDocument.DocumentType.OTHER_INTERNAL,
            visibility=ApplicationDocument.Visibility.INTERNAL,
            file=make_pdf("internal.pdf"),
            original_filename="internal.pdf",
            content_type="application/pdf",
            size_bytes=20,
            uploaded_by=self.ctx["admin"],
        )
        self.internal_doc = internal

    def test_private_storage_has_no_public_url(self):
        with self.assertRaises(ValueError):
            get_attestation_storage().url(self.passport.file.name)

    def test_raw_media_path_unavailable(self):
        # Even under DEBUG static(media) wiring, private storage is outside MEDIA_ROOT.
        name = self.passport.file.name
        resp = self.client.get(f"/media/{name}")
        self.assertIn(resp.status_code, (404, 301, 302))

    def test_unauthenticated_download_denied(self):
        resp = self.client.get(
            f"/api/attestation/documents/{self.passport.pk}/download/"
        )
        self.assertEqual(resp.status_code, 401)

    def test_hr_can_download_hr_visible(self):
        self.client.force_authenticate(user=self.hr_user)
        resp = self.client.get(
            f"/api/hr/attestation/documents/{self.passport.pk}/download/"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["X-Content-Type-Options"], "nosniff")
        self.assertIn("no-store", resp["Cache-Control"])
        self.assertIn("attachment", resp["Content-Disposition"])
        self.assertTrue(
            AttestationAuditEvent.objects.filter(
                event_type=AttestationAuditEvent.EventType.DOCUMENT_DOWNLOADED_HR
            ).exists()
        )

    def test_hr_cannot_download_internal_only(self):
        self.client.force_authenticate(user=self.hr_user)
        resp = self.client.get(
            f"/api/hr/attestation/documents/{self.internal_doc.pk}/download/"
        )
        self.assertEqual(resp.status_code, 404)

    def test_hr_cannot_download_other_customer(self):
        other = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Other D",
            company_name="Other D LLC",
            phone="0509998877",
            balance=Decimal("0.00"),
        )
        other_hr = User.objects.create_user(
            username="hr-other-d", password="pass1234567", role=User.Roles.HR_CLIENT
        )
        sync_role_managed_groups(other_hr)
        HRPortalProfile.objects.create(user=other_hr, customer=other, is_active=True)
        self.client.force_authenticate(user=other_hr)
        resp = self.client.get(
            f"/api/hr/attestation/documents/{self.passport.pk}/download/"
        )
        self.assertEqual(resp.status_code, 404)

    def test_internal_authorized_download(self):
        self.client.force_authenticate(user=self.ctx["admin"])
        resp = self.client.get(
            f"/api/attestation/documents/{self.passport.pk}/download/"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["X-Content-Type-Options"], "nosniff")

    def test_invalid_document_uuid_safe_404(self):
        self.client.force_authenticate(user=self.ctx["admin"])
        resp = self.client.get(
            f"/api/attestation/documents/{uuid.uuid4()}/download/"
        )
        self.assertEqual(resp.status_code, 404)

    def test_content_disposition_sanitized(self):
        safe = sanitize_download_filename('bad\r\n"name.pdf')
        self.assertNotIn("\r", safe)
        self.assertNotIn("\n", safe)
        self.assertNotIn('"', safe)


@override_settings(REST_FRAMEWORK=_RF)
class PhaseDUploadSecurityTests(TestCase):
    def setUp(self):
        self.ctx = seed_hr_batch(slug="phase-d-upload")
        self.url = reverse(
            "public-attestation-submit",
            kwargs={"public_slug": self.ctx["batch"].public_slug},
        )
        self.client = self.ctx["client"]

    def _post(self, files):
        return self.client.post(
            self.url,
            data={**public_submit_payload(), **files},
            format="multipart",
        )

    def test_valid_pdf_accepted(self):
        self.assertEqual(self._post(public_submit_files()).status_code, 201)

    def test_valid_jpeg_accepted(self):
        files = public_submit_files()
        files["passport"] = make_jpeg("passport.jpg")
        self.assertEqual(self._post(files).status_code, 201)

    def test_valid_png_accepted(self):
        files = public_submit_files()
        files["passport"] = make_png("passport.png")
        self.assertEqual(self._post(files).status_code, 201)

    def test_executable_renamed_pdf_rejected(self):
        files = public_submit_files()
        files["passport"] = make_exe_as_pdf()
        resp = self._post(files)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"]["code"], "attestation_invalid_file_type")

    def test_html_renamed_jpg_rejected(self):
        files = public_submit_files()
        files["passport"] = make_html_as_jpg()
        resp = self._post(files)
        self.assertEqual(resp.status_code, 400)

    def test_svg_rejected(self):
        files = public_submit_files()
        files["passport"] = make_svg()
        resp = self._post(files)
        self.assertEqual(resp.status_code, 400)

    def test_unsupported_extension_rejected(self):
        files = public_submit_files()
        files["passport"] = SimpleUploadedFile(
            "x.zip", b"PK\x03\x04", content_type="application/zip"
        )
        resp = self._post(files)
        self.assertEqual(resp.status_code, 400)

    def test_empty_file_rejected(self):
        files = public_submit_files()
        files["passport"] = SimpleUploadedFile(
            "empty.pdf", b"", content_type="application/pdf"
        )
        resp = self._post(files)
        self.assertEqual(resp.status_code, 400)

    def test_oversized_file_rejected(self):
        files = public_submit_files()
        big = SimpleUploadedFile(
            "big.pdf",
            b"%PDF" + (b"x" * (10 * 1024 * 1024 + 1)),
            content_type="application/pdf",
        )
        files["passport"] = big
        resp = self._post(files)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"]["code"], "attestation_file_too_large")

    def test_honeypot_rejects_bots(self):
        data = {**public_submit_payload(), **public_submit_files(), "website": "http://spam"}
        resp = self.client.post(self.url, data=data, format="multipart")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"]["code"], "attestation_submission_invalid")

    def test_null_malware_scanner_hook_exists(self):
        NullMalwareScanner().scan_upload(make_pdf())


@override_settings(REST_FRAMEWORK=_RF)
class PhaseDPublicSecurityTests(TestCase):
    def setUp(self):
        self.ctx = seed_hr_batch(slug="phase-d-public")
        self.url = reverse(
            "public-attestation-submit",
            kwargs={"public_slug": self.ctx["batch"].public_slug},
        )
        self.client = self.ctx["client"]

    def test_inactive_batch_rejects(self):
        self.ctx["batch"].is_active = False
        self.ctx["batch"].save(update_fields=["is_active"])
        resp = self.client.post(
            self.url,
            data={**public_submit_payload(), **public_submit_files()},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()["error"]["code"], "attestation_batch_unavailable")
        # Historical applications remain (none yet — ensure batch still exists).
        self.ctx["batch"].refresh_from_db()
        self.assertFalse(self.ctx["batch"].is_active)

    def test_idempotent_retry_no_duplicate(self):
        data = {**public_submit_payload(), **public_submit_files()}
        headers = {"HTTP_IDEMPOTENCY_KEY": "phase-d-key-1"}
        r1 = self.client.post(self.url, data=data, format="multipart", **headers)
        self.assertEqual(r1.status_code, 201)
        r2 = self.client.post(
            self.url,
            data={**public_submit_payload(full_name="Other"), **public_submit_files()},
            format="multipart",
            **headers,
        )
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(r1.json()["reference_number"], r2.json()["reference_number"])
        self.assertEqual(AttestationApplication.objects.count(), 1)

    def test_different_idempotency_key_creates_new(self):
        self.client.post(
            self.url,
            data={**public_submit_payload(), **public_submit_files()},
            format="multipart",
            HTTP_IDEMPOTENCY_KEY="k-a",
        )
        self.client.post(
            self.url,
            data={**public_submit_payload(full_name="Second"), **public_submit_files()},
            format="multipart",
            HTTP_IDEMPOTENCY_KEY="k-b",
        )
        self.assertEqual(AttestationApplication.objects.count(), 2)

    def test_injection_fields_rejected(self):
        for field, value in (
            ("customer_id", str(self.ctx["customer"].pk)),
            ("batch_id", str(self.ctx["batch"].pk)),
            ("internal_notes", "secret"),
            ("status", "completed"),
        ):
            data = {**public_submit_payload(), **public_submit_files(), field: value}
            resp = self.client.post(self.url, data=data, format="multipart")
            self.assertEqual(resp.status_code, 400, field)

    @override_settings(
        REST_FRAMEWORK={
            **_RF,
            "DEFAULT_THROTTLE_RATES": {
                "attestation_public_submit": "2/hour",
                "login": "1000/minute",
            },
        }
    )
    def test_throttle_enforced(self):
        from django.core.cache import cache

        cache.clear()
        url = reverse(
            "public-attestation-submit",
            kwargs={"public_slug": self.ctx["batch"].public_slug},
        )
        for _ in range(2):
            resp = self.client.post(
                url,
                data={**public_submit_payload(), **public_submit_files()},
                format="multipart",
            )
            self.assertEqual(resp.status_code, 201, resp.content)
        resp = self.client.post(
            url,
            data={**public_submit_payload(), **public_submit_files()},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 429)


@override_settings(REST_FRAMEWORK=_RF)
class PhaseDHRAccountSecurityTests(TestCase):
    def setUp(self):
        seed_hr_portal_groups()
        self.ctx = seed_hr_batch(slug="phase-d-hr")
        self.client = APIClient()
        self.hr_user = User.objects.create_user(
            username="hr-phase-d", password="pass1234567", role=User.Roles.HR_CLIENT
        )
        sync_role_managed_groups(self.hr_user)
        self.profile = HRPortalProfile.objects.create(
            user=self.hr_user, customer=self.ctx["customer"], is_active=True
        )

    def test_inactive_user_cannot_login(self):
        self.hr_user.is_active = False
        self.hr_user.save(update_fields=["is_active"])
        resp = self.client.post(
            "/api/token/",
            {"username": "hr-phase-d", "password": "pass1234567"},
            format="json",
        )
        self.assertEqual(resp.status_code, 401)

    def test_inactive_user_cannot_use_protected_api(self):
        token = str(RefreshToken.for_user(self.hr_user).access_token)
        self.hr_user.is_active = False
        self.hr_user.save(update_fields=["is_active"])
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        resp = self.client.get("/api/hr/attestation/overview/")
        self.assertIn(resp.status_code, (401, 403))

    def test_inactive_profile_denied(self):
        self.profile.is_active = False
        self.profile.save(update_fields=["is_active"])
        self.client.force_authenticate(user=self.hr_user)
        resp = self.client.get("/api/hr/attestation/overview/")
        self.assertEqual(resp.status_code, 403)

    def test_hr_cannot_mutate_application(self):
        resp = self.client.post(
            f"/api/public/attestation/{self.ctx['batch'].public_slug}/applications/",
            data={**public_submit_payload(), **public_submit_files()},
            format="multipart",
        )
        app = AttestationApplication.objects.get(
            reference_number=resp.json()["reference_number"]
        )
        self.client.force_authenticate(user=self.hr_user)
        patch = self.client.patch(
            f"/api/hr/attestation/applications/{app.pk}/",
            {"internal_notes": "hack"},
            format="json",
        )
        self.assertEqual(patch.status_code, 405)
        internal = self.client.post(
            f"/api/attestation/applications/{app.pk}/set-dataflow/",
            {},
            format="multipart",
        )
        self.assertIn(internal.status_code, (403, 404))


@override_settings(REST_FRAMEWORK=_RF)
class PhaseDLoggingPrivacyTests(TestCase):
    def test_audit_strips_secrets(self):
        from attestation.services.audit import record_attestation_audit

        evt = record_attestation_audit(
            event_type=AttestationAuditEvent.EventType.PUBLIC_SUBMITTED,
            actor_type=AttestationAuditEvent.ActorType.SYSTEM,
            metadata={
                "password": "secret",
                "authorization": "Bearer xyz",
                "token": "abc",
                "file": b"bytes",
                "ok": "safe",
            },
        )
        self.assertNotIn("password", evt.metadata)
        self.assertNotIn("authorization", evt.metadata)
        self.assertNotIn("token", evt.metadata)
        self.assertNotIn("file", evt.metadata)
        self.assertEqual(evt.metadata.get("ok"), "safe")
