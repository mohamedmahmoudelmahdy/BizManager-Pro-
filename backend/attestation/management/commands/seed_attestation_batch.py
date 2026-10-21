"""
Seed a demo HR Certificate Attestation batch for local/dev use.

Creates (if missing):
- HR Organization customer
- One bulk Certificate Attestation Procedure
- One active AttestationBatch (expected_applicant_count=54)
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from attestation.models import AttestationBatch
from banking.models import BankCard
from customers.models import Customer
from procedures.models import Procedure
from procedures.services.create_with_accounting import create_procedure_with_accounting

User = get_user_model()

DEFAULT_SLUG = "hr-cert-attestation"


class Command(BaseCommand):
    help = (
        "DEV/BOOTSTRAP ONLY: seed an HR attestation batch "
        "(Customer + bulk Procedure + AttestationBatch). "
        "Refuses to create a duplicate live slug. Does not mutate existing Procedure financials."
    )

    def add_arguments(self, parser):
        parser.add_argument("--slug", default=DEFAULT_SLUG)
        parser.add_argument("--expected", type=int, default=54)
        parser.add_argument(
            "--force",
            action="store_true",
            help="Allow running when DJANGO_DEBUG is False (still refuses duplicate slug).",
        )

    def handle(self, *args, **options):
        from django.conf import settings

        if not settings.DEBUG and not options["force"]:
            self.stderr.write(
                self.style.ERROR(
                    "Refusing to seed in production (DEBUG=False). "
                    "Pass --force only for controlled bootstrap."
                )
            )
            return

        slug = options["slug"]
        expected = options["expected"]

        existing = AttestationBatch.objects.filter(public_slug=slug).first()
        if existing:
            self.stdout.write(
                self.style.WARNING(
                    f"Batch already exists for slug={slug} (id={existing.pk}). "
                    "No duplicate created; Procedure financials untouched."
                )
            )
            return

        admin = User.objects.filter(role=User.Roles.ADMIN).first()
        if admin is None:
            admin = User.objects.create_superuser(
                username="admin", password="admin", email="admin@example.com"
            )
            admin.role = User.Roles.ADMIN
            admin.save(update_fields=["role"])

        customer, _created = Customer.objects.get_or_create(
            name="HR Organization",
            defaults={
                "type": Customer.CustomerType.COMPANY,
                "company_name": "HR Organization LLC",
                "phone": "0501112233",
                "balance": Decimal("0.00"),
                "attestation_apply_slug": slug,
            },
        )
        if not customer.attestation_apply_slug:
            # Prefer the seed slug when free; otherwise allocate a unique one.
            if not Customer.objects.filter(attestation_apply_slug=slug).exclude(
                pk=customer.pk
            ).exists():
                customer.attestation_apply_slug = slug
            else:
                from attestation.services.customer_slug import (
                    allocate_unique_customer_apply_slug,
                )

                customer.attestation_apply_slug = allocate_unique_customer_apply_slug(
                    slug, exclude_customer_id=customer.pk
                )
            customer.save(update_fields=["attestation_apply_slug", "updated_at"])

        card = BankCard.objects.filter(method_type=BankCard.MethodType.CASH).first()
        if card is None:
            card = BankCard.objects.create(
                bank_name="Cash Box",
                cardholder_name="Office",
                card_type="Cash",
                card_number="0001",
                last4="0001",
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
                "description": f"Bulk certificate attestation ({expected} teachers)",
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

        # Deactivate other active batches for this customer (one-active rule).
        AttestationBatch.objects.filter(customer=customer, is_active=True).update(
            is_active=False
        )

        batch = AttestationBatch.objects.create(
            customer=customer,
            linked_procedure=procedure,
            title="Certificate Attestation — Teachers",
            expected_applicant_count=expected,
            is_active=True,
            public_slug=slug,
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Created batch {batch.public_slug} linked to procedure {procedure.pk}"
            )
        )
        self.stdout.write(
            f"Public apply: /attestation/apply/{customer.attestation_apply_slug}"
        )
        self.stdout.write(
            f"Public submit: POST /api/public/attestation/{customer.attestation_apply_slug}/applications/"
        )
