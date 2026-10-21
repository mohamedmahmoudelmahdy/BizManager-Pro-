"""Shared helpers for attestation tests."""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from attestation.models import AttestationBatch
from banking.models import BankCard
from customers.models import Customer
from procedures.models import Procedure
from procedures.services.create_with_accounting import create_procedure_with_accounting

User = get_user_model()


def make_pdf(name: str = "doc.pdf", content: bytes = b"%PDF-1.4 attestation") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, content, content_type="application/pdf")


def make_jpeg(name: str = "photo.jpg") -> SimpleUploadedFile:
    return SimpleUploadedFile(
        name, b"\xff\xd8\xff\xe0" + b"\x00" * 32, content_type="image/jpeg"
    )


def make_png(name: str = "photo.png") -> SimpleUploadedFile:
    return SimpleUploadedFile(
        name,
        b"\x89PNG\r\n\x1a\n" + b"\x00" * 32,
        content_type="image/png",
    )


def make_exe(name: str = "malware.exe") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, b"MZ executable", content_type="application/octet-stream")


def make_exe_as_pdf(name: str = "fake.pdf") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, b"MZ executable", content_type="application/pdf")


def make_html_as_jpg(name: str = "page.jpg") -> SimpleUploadedFile:
    return SimpleUploadedFile(
        name, b"<!DOCTYPE html><html></html>", content_type="image/jpeg"
    )


def make_svg(name: str = "img.svg") -> SimpleUploadedFile:
    return SimpleUploadedFile(
        name,
        b'<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        content_type="image/svg+xml",
    )

def seed_hr_batch(*, slug: str = "hr-cert-attestation", expected: int = 54) -> dict:
    cache.clear()
    admin = User.objects.create_user(
        username="att-admin", password="pass", role=User.Roles.ADMIN
    )
    manager = User.objects.create_user(
        username="att-manager", password="pass", role=User.Roles.MANAGER
    )
    employee = User.objects.create_user(
        username="att-employee", password="pass", role=User.Roles.EMPLOYEE
    )
    customer = Customer.objects.create(
        type=Customer.CustomerType.COMPANY,
        name="HR Organization",
        company_name="HR Organization LLC",
        phone="0501112233",
        balance=Decimal("0.00"),
        attestation_apply_slug=slug,
    )
    card = BankCard.objects.create(
        bank_name="Cash Box",
        cardholder_name="Office",
        card_type="Cash",
        card_number="9999",
        last4="9999",
        expiry_month="12",
        expiry_year="2030",
        method_type=BankCard.MethodType.CASH,
        balance=Decimal("10000.00"),
    )
    procedure = create_procedure_with_accounting(
        user=admin,
        validated_data={
            "customer": customer,
            "category": "Certificate Attestation",
            "description": "Bulk certificate attestation batch (54 teachers)",
            "cost": Decimal("0.00"),
            "selling_price": Decimal("54000.00"),
            "paid": Decimal("0.00"),
            "cash_in": Decimal("0.00"),
            "cash_out_type": card,
            "cash_in_type": None,
            "status": Procedure.Status.SUBMITTED,
            "assigned_employee": None,
            "date": date(2026, 8, 1),
        },
        raw_data={},
    )
    batch = AttestationBatch.objects.create(
        customer=customer,
        linked_procedure=procedure,
        title="Certificate Attestation — Teachers 2026",
        expected_applicant_count=expected,
        is_active=True,
        public_slug=slug,
    )
    return {
        "admin": admin,
        "manager": manager,
        "employee": employee,
        "customer": customer,
        "card": card,
        "procedure": procedure,
        "batch": batch,
        "client": APIClient(),
    }


def public_submit_payload(*, full_name="Jane Doe", phone="+971501112233", degrees=None):
    if degrees is None:
        degrees = [
            {
                "study_location": "United Kingdom",
                "university": "University of Example",
                "degree_level": "Bachelor",
                "major": "Education",
                "start_year": 2018,
                "completion_year": 2022,
                "final_grade": "Very Good",
            }
        ]
    return {
        "full_name": full_name,
        "phone": phone,
        "degrees": json.dumps(degrees),
    }


def public_submit_files(*, degree_count: int = 1):
    files = {"passport": make_pdf("passport.pdf")}
    for i in range(degree_count):
        files[f"degree_{i}_certificate"] = make_pdf(f"cert_{i}.pdf")
        files[f"degree_{i}_transcript"] = make_pdf(f"transcript_{i}.pdf")
    return files
