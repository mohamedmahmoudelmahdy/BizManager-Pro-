"""Multi-customer attestation apply slug + Customer profile portal APIs."""

from __future__ import annotations

from django.db import IntegrityError
from django.test import TestCase, override_settings
from django.urls import reverse

from accounts.models import User
from accounts.services.role_groups import sync_role_managed_groups
from attestation.groups import seed_hr_portal_groups
from attestation.models import AttestationApplication, AttestationBatch, HRPortalProfile
from attestation.services.customer_portal import enable_customer_attestation
from attestation.tests.helpers import (
    make_pdf,
    public_submit_files,
    public_submit_payload,
    seed_hr_batch,
)
from customers.models import Customer
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
class MultiCustomerAttestationTests(TestCase):
    def setUp(self):
        self.ctx = seed_hr_batch()
        self.client = self.ctx["client"]
        self.customer = self.ctx["customer"]
        self.admin = self.ctx["admin"]

    def test_public_submit_by_customer_apply_slug(self):
        slug = self.customer.attestation_apply_slug
        self.assertTrue(slug)
        resp = self.client.post(
            f"/api/public/attestation/{slug}/applications/",
            data={
                **public_submit_payload(full_name="Teacher C", phone="+971503333333"),
                **public_submit_files(),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        app = AttestationApplication.objects.get(
            reference_number=resp.json()["reference_number"]
        )
        self.assertEqual(app.batch.customer_id, self.customer.pk)

    def test_public_submit_legacy_batch_slug_still_works(self):
        resp = self.client.post(
            f"/api/public/attestation/{self.ctx['batch'].public_slug}/applications/",
            data={
                **public_submit_payload(full_name="Teacher Legacy", phone="+971504444444"),
                **public_submit_files(),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_missing_or_inactive_slug_unavailable(self):
        resp = self.client.post(
            "/api/public/attestation/does-not-exist/applications/",
            data={
                **public_submit_payload(full_name="X", phone="+971505555555"),
                **public_submit_files(),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()["error"]["code"], "attestation_batch_unavailable")

        AttestationBatch.objects.filter(pk=self.ctx["batch"].pk).update(is_active=False)
        resp2 = self.client.post(
            f"/api/public/attestation/{self.customer.attestation_apply_slug}/applications/",
            data={
                **public_submit_payload(full_name="Y", phone="+971506666666"),
                **public_submit_files(),
            },
            format="multipart",
        )
        self.assertEqual(resp2.status_code, 404)

    def test_one_active_batch_per_customer_constraint(self):
        from datetime import date
        from decimal import Decimal

        from banking.models import BankCard
        from procedures.services.create_with_accounting import (
            create_procedure_with_accounting,
        )

        card = BankCard.objects.filter(method_type=BankCard.MethodType.CASH).first()
        procedure = create_procedure_with_accounting(
            user=self.admin,
            validated_data={
                "customer": self.customer,
                "category": "Certificate Attestation",
                "description": "Second batch",
                "cost": Decimal("0.00"),
                "selling_price": Decimal("0.00"),
                "paid": Decimal("0.00"),
                "cash_in": Decimal("0.00"),
                "cash_out_type": card,
                "cash_in_type": None,
                "status": Procedure.Status.SUBMITTED,
                "assigned_employee": None,
                "date": date.today(),
            },
            raw_data={},
        )
        with self.assertRaises(IntegrityError):
            AttestationBatch.objects.create(
                customer=self.customer,
                linked_procedure=procedure,
                title="Second Active",
                expected_applicant_count=1,
                is_active=True,
                public_slug="second-active-batch",
            )

    def test_staff_enable_creates_slug_and_batch(self):
        company = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Acme Corp",
            company_name="Acme Corp LLC",
            phone="0509998877",
        )
        self.client.force_authenticate(self.admin)
        before_procs = Procedure.objects.count()
        before_pays = Payment.objects.count()
        resp = self.client.post(
            f"/api/customers/{company.pk}/attestation/enable/",
            {"expected_applicant_count": 12},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertTrue(body["enabled"])
        self.assertTrue(body["attestation_apply_slug"])
        self.assertTrue(body["apply_path"].startswith("/attestation/apply/"))
        self.assertIsNotNone(body["active_batch"])
        company.refresh_from_db()
        self.assertEqual(company.attestation_apply_slug, body["attestation_apply_slug"])
        # Enable creates one Procedure (commercial link) but no Payment rows.
        self.assertEqual(Procedure.objects.count(), before_procs + 1)
        self.assertEqual(Payment.objects.count(), before_pays)

        # Public submit via new slug
        self.client.force_authenticate(None)
        submit = self.client.post(
            f"/api/public/attestation/{company.attestation_apply_slug}/applications/",
            data={
                **public_submit_payload(full_name="Acme Teacher", phone="+971507777777"),
                **public_submit_files(),
            },
            format="multipart",
        )
        self.assertEqual(submit.status_code, 201, submit.content)

    def test_hr_user_scoped_to_customer(self):
        seed_hr_portal_groups()
        other = Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Other Co",
            company_name="Other Co",
            attestation_apply_slug="other-co",
        )
        enable_customer_attestation(actor=self.admin, customer_id=other.pk)

        self.client.force_authenticate(self.admin)
        create = self.client.post(
            f"/api/customers/{self.customer.pk}/attestation/hr-users/",
            {"username": "hr-acme", "password": "ComplexPass123!", "email": ""},
            format="json",
        )
        self.assertEqual(create.status_code, 201, create.content)

        hr = User.objects.get(username="hr-acme")
        self.assertEqual(hr.role, User.Roles.HR_CLIENT)
        profile = HRPortalProfile.objects.get(user=hr)
        self.assertEqual(profile.customer_id, self.customer.pk)

        # Seed an app on customer A
        self.client.force_authenticate(None)
        self.client.post(
            f"/api/public/attestation/{self.customer.attestation_apply_slug}/applications/",
            data={
                **public_submit_payload(full_name="A1", phone="+971508888001"),
                **public_submit_files(),
            },
            format="multipart",
        )
        self.client.post(
            f"/api/public/attestation/{other.attestation_apply_slug}/applications/",
            data={
                **public_submit_payload(full_name="B1", phone="+971508888002"),
                **public_submit_files(),
            },
            format="multipart",
        )

        self.client.force_authenticate(hr)
        listing = self.client.get("/api/hr/attestation/applications/")
        self.assertEqual(listing.status_code, 200, listing.content)
        names = {row["full_name"] for row in listing.json()["results"]}
        self.assertIn("A1", names)
        self.assertNotIn("B1", names)

        # HR cannot call internal process APIs
        app = AttestationApplication.objects.filter(
            batch__customer_id=self.customer.pk
        ).first()
        denied = self.client.post(
            f"/api/attestation/applications/{app.pk}/set-dataflow/",
            {
                "dataflow_reference": "X",
                "dataflow_submitted_at": "2026-09-01",
                "dataflow_payment_proof": make_pdf("x.pdf"),
            },
            format="multipart",
        )
        self.assertEqual(denied.status_code, 403)

    def test_public_cannot_get_internal_applications(self):
        resp = self.client.get("/api/attestation/applications/")
        self.assertIn(resp.status_code, (401, 403))
