"""Public submission API tests for Certificate Attestation."""

from __future__ import annotations

import json
from decimal import Decimal

from django.test import TestCase, override_settings
from django.urls import reverse

from attestation.models import (
    ApplicationDocument,
    ApplicationStatusHistory,
    AttestationApplication,
)
from attestation.tests.helpers import (
    make_exe,
    make_pdf,
    public_submit_files,
    public_submit_payload,
    seed_hr_batch,
)
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
class PublicAttestationSubmitTests(TestCase):
    def setUp(self):
        self.ctx = seed_hr_batch()
        self.url = reverse(
            "public-attestation-submit",
            kwargs={"public_slug": self.ctx["batch"].public_slug},
        )
        self.client = self.ctx["client"]

    def test_public_submission_succeeds_without_auth(self):
        resp = self.client.post(
            self.url,
            data={**public_submit_payload(), **public_submit_files()},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body["status"], "documents_received")
        self.assertTrue(body["reference_number"].startswith("ATT-"))
        self.assertEqual(body["message_code"], "attestation_application_submitted")
        self.assertNotIn("internal_notes", body)
        self.assertNotIn("customer", body)

    def test_full_name_required(self):
        data = public_submit_payload()
        data["full_name"] = ""
        resp = self.client.post(
            self.url, data={**data, **public_submit_files()}, format="multipart"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"]["code"], "attestation_submission_invalid")

    def test_phone_required(self):
        data = public_submit_payload()
        data["phone"] = ""
        resp = self.client.post(
            self.url, data={**data, **public_submit_files()}, format="multipart"
        )
        self.assertEqual(resp.status_code, 400)

    def test_at_least_one_degree_required(self):
        data = public_submit_payload(degrees=[])
        resp = self.client.post(
            self.url, data={**data, **public_submit_files()}, format="multipart"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"]["code"], "attestation_degree_required")

    def test_passport_required(self):
        files = public_submit_files()
        del files["passport"]
        resp = self.client.post(
            self.url, data={**public_submit_payload(), **files}, format="multipart"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"]["code"], "attestation_passport_required")

    def test_certificate_and_transcript_required_per_degree(self):
        files = public_submit_files()
        del files["degree_0_certificate"]
        resp = self.client.post(
            self.url, data={**public_submit_payload(), **files}, format="multipart"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"]["code"], "attestation_certificate_required")

        files = public_submit_files()
        del files["degree_0_transcript"]
        resp = self.client.post(
            self.url, data={**public_submit_payload(), **files}, format="multipart"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"]["code"], "attestation_transcript_required")

    def test_multiple_degrees_supported(self):
        degrees = [
            {
                "study_location": "UAE",
                "university": "Uni A",
                "degree_level": "Bachelor",
                "major": "Math",
                "start_year": 2015,
                "completion_year": 2019,
                "final_grade": "3.4 / 4",
            },
            {
                "study_location": "Egypt",
                "university": "Uni B",
                "degree_level": "Master",
                "major": "Education",
                "start_year": 2020,
                "completion_year": 2022,
                "final_grade": "Distinction",
            },
        ]
        resp = self.client.post(
            self.url,
            data={
                **public_submit_payload(degrees=degrees),
                **public_submit_files(degree_count=2),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        app = AttestationApplication.objects.get(
            reference_number=resp.json()["reference_number"]
        )
        self.assertEqual(app.degrees.count(), 2)

    def test_repeated_phone_supported(self):
        phone = "+971509998877"
        for name in ("First Teacher", "Second Teacher"):
            resp = self.client.post(
                self.url,
                data={
                    **public_submit_payload(full_name=name, phone=phone),
                    **public_submit_files(),
                },
                format="multipart",
            )
            self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(
            AttestationApplication.objects.filter(phone_normalized="971509998877").count(),
            2,
        )

    def test_arabic_name_and_grade_variants(self):
        resp = self.client.post(
            self.url,
            data={
                **public_submit_payload(
                    full_name="نورة أحمد",
                    degrees=[
                        {
                            "study_location": "الأردن",
                            "university": "الجامعة الأردنية",
                            "degree_level": "بكالوريوس",
                            "major": "تربية",
                            "start_year": 2016,
                            "completion_year": 2020,
                            "final_grade": "ممتاز",
                        }
                    ],
                ),
                **public_submit_files(),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_defaults_and_history(self):
        resp = self.client.post(
            self.url,
            data={**public_submit_payload(), **public_submit_files()},
            format="multipart",
        )
        app = AttestationApplication.objects.get(
            reference_number=resp.json()["reference_number"]
        )
        self.assertEqual(app.status, "documents_received")
        hist = ApplicationStatusHistory.objects.filter(application=app)
        self.assertEqual(hist.count(), 1)
        self.assertEqual(hist.get().from_status, "")
        self.assertEqual(hist.get().to_status, "documents_received")
        self.assertIsNone(hist.get().changed_by_id)
        self.assertEqual(hist.get().actor_source, "public_submission")

    def test_public_cannot_submit_control_fields(self):
        data = public_submit_payload()
        data["customer_id"] = str(self.ctx["customer"].pk)
        data["internal_notes"] = "secret"
        data["status"] = "completed"
        resp = self.client.post(
            self.url, data={**data, **public_submit_files()}, format="multipart"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"]["code"], "attestation_submission_invalid")

    def test_active_batch_selected_server_side(self):
        resp = self.client.post(
            self.url,
            data={**public_submit_payload(), **public_submit_files()},
            format="multipart",
        )
        app = AttestationApplication.objects.get(
            reference_number=resp.json()["reference_number"]
        )
        self.assertEqual(app.batch_id, self.ctx["batch"].pk)

    def test_inactive_batch_rejected(self):
        self.ctx["batch"].is_active = False
        self.ctx["batch"].save(update_fields=["is_active"])
        resp = self.client.post(
            self.url,
            data={**public_submit_payload(), **public_submit_files()},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()["error"]["code"], "attestation_batch_unavailable")

    def test_invalid_file_type_rejected(self):
        files = public_submit_files()
        files["passport"] = make_exe()
        resp = self.client.post(
            self.url, data={**public_submit_payload(), **files}, format="multipart"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"]["code"], "attestation_invalid_file_type")

    def test_oversize_file_rejected(self):
        big = make_pdf("big.pdf", content=b"%PDF" + (b"x" * (10 * 1024 * 1024 + 1)))
        files = public_submit_files()
        files["passport"] = big
        resp = self.client.post(
            self.url, data={**public_submit_payload(), **files}, format="multipart"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"]["code"], "attestation_file_too_large")

    def test_no_partial_application_on_failure(self):
        before = AttestationApplication.objects.count()
        files = public_submit_files()
        del files["degree_0_transcript"]
        resp = self.client.post(
            self.url, data={**public_submit_payload(), **files}, format="multipart"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(AttestationApplication.objects.count(), before)

    def test_idempotency_key_returns_same_reference(self):
        payload = {**public_submit_payload(), **public_submit_files()}
        headers = {"HTTP_IDEMPOTENCY_KEY": "teacher-jane-1"}
        r1 = self.client.post(self.url, data=payload, format="multipart", **headers)
        self.assertEqual(r1.status_code, 201, r1.content)
        # New file objects for second attempt
        payload2 = {
            **public_submit_payload(full_name="Different Name"),
            **public_submit_files(),
        }
        r2 = self.client.post(self.url, data=payload2, format="multipart", **headers)
        self.assertEqual(r2.status_code, 201, r2.content)
        self.assertEqual(r1.json()["reference_number"], r2.json()["reference_number"])
        self.assertEqual(AttestationApplication.objects.count(), 1)

    def test_no_financial_mutations(self):
        customer = self.ctx["customer"]
        procedure = self.ctx["procedure"]
        card = self.ctx["card"]
        customer.refresh_from_db()
        procedure.refresh_from_db()
        card.refresh_from_db()
        bal = customer.balance
        paid = procedure.paid
        selling = procedure.selling_price
        card_bal = card.balance
        payments_before = Payment.objects.count()
        expenses_before = Expense.objects.count()
        procedures_before = Procedure.objects.count()

        resp = self.client.post(
            self.url,
            data={**public_submit_payload(), **public_submit_files()},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.content)

        customer.refresh_from_db()
        procedure.refresh_from_db()
        card.refresh_from_db()
        self.assertEqual(customer.balance, bal)
        self.assertEqual(procedure.paid, paid)
        self.assertEqual(procedure.selling_price, selling)
        self.assertEqual(card.balance, card_bal)
        self.assertEqual(Payment.objects.count(), payments_before)
        self.assertEqual(Expense.objects.count(), expenses_before)
        self.assertEqual(Procedure.objects.count(), procedures_before)

    def test_public_get_list_and_detail_unavailable(self):
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, 405)
        # No public applications list route
        resp2 = self.client.get("/api/public/attestation/applications/")
        self.assertIn(resp2.status_code, (404, 405))

    def test_passport_is_application_level(self):
        resp = self.client.post(
            self.url,
            data={**public_submit_payload(), **public_submit_files()},
            format="multipart",
        )
        app = AttestationApplication.objects.get(
            reference_number=resp.json()["reference_number"]
        )
        passport = app.documents.get(document_type="passport")
        self.assertIsNone(passport.degree_id)
        cert = app.documents.get(document_type="degree_certificate")
        self.assertIsNotNone(cert.degree_id)
