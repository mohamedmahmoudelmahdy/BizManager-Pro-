"""Staff APIs: enable customer attestation + manage HR portal users."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, Q

from accounts.services.role_groups import sync_role_managed_groups
from attestation.exceptions import (
    AttestationBusinessError,
    AttestationPermissionDeniedError,
)
from attestation.groups import seed_hr_portal_groups
from attestation.models import AttestationApplication, AttestationBatch, HRPortalProfile
from attestation.services.customer_slug import (
    allocate_unique_customer_apply_slug,
    ensure_single_active_batch,
    normalize_apply_slug,
)
from attestation.services.workflow import ensure_attestation_perm
from banking.models import BankCard
from customers.models import Customer
from procedures.models import Procedure
from procedures.services.create_with_accounting import create_procedure_with_accounting

User = get_user_model()


class AttestationCustomerNotCompanyError(AttestationBusinessError):
    code = "attestation_customer_not_company"
    http_status = 400


class AttestationAlreadyEnabledError(AttestationBusinessError):
    code = "attestation_already_enabled"
    http_status = 400


class AttestationNotEnabledError(AttestationBusinessError):
    code = "attestation_not_enabled"
    http_status = 400


class AttestationHrUserInvalidError(AttestationBusinessError):
    code = "attestation_hr_user_invalid"
    http_status = 400


def require_manage_attestation(user) -> None:
    ensure_attestation_perm(user, "manage_attestationbatch")


def _display_name(customer: Customer) -> str:
    return (customer.company_name or customer.name or "").strip() or str(customer.pk)


def build_customer_attestation_status(customer: Customer) -> dict:
    batch = (
        AttestationBatch.objects.filter(customer_id=customer.pk)
        .annotate(
            application_count=Count("applications", distinct=True),
            completed_count=Count(
                "applications",
                filter=Q(applications__status=AttestationApplication.Status.COMPLETED),
                distinct=True,
            ),
        )
        .order_by("-is_active", "-created_at")
        .first()
    )
    active = (
        AttestationBatch.objects.filter(customer_id=customer.pk, is_active=True)
        .order_by("-created_at")
        .first()
    )
    hr_users = []
    for profile in (
        HRPortalProfile.objects.filter(customer_id=customer.pk)
        .select_related("user")
        .order_by("user__username")
    ):
        hr_users.append(
            {
                "profile_id": str(profile.pk),
                "user_id": str(profile.user_id),
                "username": profile.user.username,
                "email": profile.user.email or "",
                "is_active": bool(profile.is_active and profile.user.is_active),
            }
        )

    slug = customer.attestation_apply_slug or ""
    return {
        "enabled": bool(slug),
        "attestation_apply_slug": slug or None,
        "apply_path": f"/attestation/apply/{slug}" if slug else None,
        "active_batch": (
            {
                "id": str(active.pk),
                "title": active.title,
                "public_slug": active.public_slug,
                "expected_applicant_count": active.expected_applicant_count,
                "is_active": active.is_active,
                "application_count": getattr(batch, "application_count", 0)
                if batch and batch.pk == active.pk
                else AttestationApplication.objects.filter(batch_id=active.pk).count(),
            }
            if active
            else None
        ),
        "latest_batch": (
            {
                "id": str(batch.pk),
                "title": batch.title,
                "public_slug": batch.public_slug,
                "expected_applicant_count": batch.expected_applicant_count,
                "is_active": batch.is_active,
                "application_count": batch.application_count,
                "completed_count": batch.completed_count,
            }
            if batch
            else None
        ),
        "hr_users": hr_users,
        "customer": {
            "id": str(customer.pk),
            "display_name": _display_name(customer),
            "type": customer.type,
        },
    }


@transaction.atomic
def enable_customer_attestation(
    *,
    actor,
    customer_id,
    expected_applicant_count: int | None = 54,
    title: str | None = None,
    slug: str | None = None,
) -> dict:
    require_manage_attestation(actor)
    try:
        customer = Customer.objects.select_for_update().get(pk=customer_id)
    except Customer.DoesNotExist as exc:
        raise AttestationBusinessError(
            message="customer_not_found",
            details={"customer_id": str(customer_id)},
            http_status=404,
        ) from exc

    if customer.type != Customer.CustomerType.COMPANY:
        raise AttestationCustomerNotCompanyError(
            details={"customer_id": str(customer.pk)}
        )

    if customer.attestation_apply_slug and AttestationBatch.objects.filter(
        customer_id=customer.pk
    ).exists():
        raise AttestationAlreadyEnabledError(
            details={"attestation_apply_slug": customer.attestation_apply_slug}
        )

    base = slug or customer.company_name or customer.name or "customer"
    apply_slug = allocate_unique_customer_apply_slug(
        normalize_apply_slug(base) or "customer",
        exclude_customer_id=customer.pk,
    )
    customer.attestation_apply_slug = apply_slug
    customer.save(update_fields=["attestation_apply_slug", "updated_at"])

    existing_active = AttestationBatch.objects.filter(
        customer_id=customer.pk, is_active=True
    ).first()
    if existing_active is not None:
        # Slug was missing but batch exists — just wire slug.
        return build_customer_attestation_status(customer)

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

    expected = expected_applicant_count if expected_applicant_count is not None else 54
    batch_title = (title or "").strip() or f"Certificate Attestation — {_display_name(customer)}"

    procedure = create_procedure_with_accounting(
        user=actor,
        validated_data={
            "customer": customer,
            "category": "Certificate Attestation",
            "description": f"Bulk certificate attestation ({expected} applicants)",
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

    # Prefer matching batch.public_slug to customer apply slug when free.
    batch_slug = apply_slug
    if AttestationBatch.objects.filter(public_slug=batch_slug).exists():
        n = 2
        while AttestationBatch.objects.filter(public_slug=f"{apply_slug}-b{n}").exists():
            n += 1
            if n > 10_000:
                raise AttestationBusinessError(message="attestation_batch_slug_exhausted")
        batch_slug = f"{apply_slug}-b{n}"

    ensure_single_active_batch(customer_id=customer.pk)
    try:
        AttestationBatch.objects.create(
            customer=customer,
            linked_procedure=procedure,
            title=batch_title,
            expected_applicant_count=expected,
            is_active=True,
            public_slug=batch_slug,
        )
    except IntegrityError as exc:
        raise AttestationBusinessError(
            message="attestation_batch_create_failed",
            details={"reason": "integrity"},
        ) from exc

    return build_customer_attestation_status(customer)


@transaction.atomic
def set_customer_attestation_active(*, actor, customer_id, is_active: bool) -> dict:
    require_manage_attestation(actor)
    try:
        customer = Customer.objects.get(pk=customer_id)
    except Customer.DoesNotExist as exc:
        raise AttestationBusinessError(
            message="customer_not_found",
            details={"customer_id": str(customer_id)},
            http_status=404,
        ) from exc
    if not customer.attestation_apply_slug:
        raise AttestationNotEnabledError(details={"customer_id": str(customer.pk)})

    batch = (
        AttestationBatch.objects.filter(customer_id=customer.pk)
        .order_by("-created_at")
        .first()
    )
    if batch is None:
        raise AttestationNotEnabledError(details={"reason": "no_batch"})

    if is_active:
        ensure_single_active_batch(
            customer_id=customer.pk, activating_batch_id=batch.pk
        )
        batch.is_active = True
        batch.save(update_fields=["is_active", "updated_at"])
    else:
        batch.is_active = False
        batch.save(update_fields=["is_active", "updated_at"])

    return build_customer_attestation_status(customer)


@transaction.atomic
def create_customer_hr_portal_user(
    *,
    actor,
    customer_id,
    username: str,
    password: str,
    email: str = "",
) -> dict:
    require_manage_attestation(actor)
    seed_hr_portal_groups()
    try:
        customer = Customer.objects.get(pk=customer_id)
    except Customer.DoesNotExist as exc:
        raise AttestationBusinessError(
            message="customer_not_found",
            details={"customer_id": str(customer_id)},
            http_status=404,
        ) from exc

    username = (username or "").strip()
    if not username:
        raise AttestationHrUserInvalidError(details={"field": "username"})
    if not password:
        raise AttestationHrUserInvalidError(details={"field": "password"})
    try:
        validate_password(password)
    except DjangoValidationError as exc:
        raise AttestationHrUserInvalidError(
            details={"field": "password", "messages": list(exc.messages)}
        ) from exc

    existing = User.objects.filter(username=username).first()
    if existing is not None and existing.role != User.Roles.HR_CLIENT:
        raise AttestationHrUserInvalidError(
            details={
                "field": "username",
                "reason": "exists_non_hr",
                "role": existing.role,
            }
        )
    if existing is not None:
        other = HRPortalProfile.objects.filter(user=existing).first()
        if other is not None and other.customer_id != customer.pk:
            raise AttestationHrUserInvalidError(
                details={"reason": "hr_user_other_customer"}
            )

    user, _created = User.objects.get_or_create(
        username=username,
        defaults={"email": email or "", "role": User.Roles.HR_CLIENT},
    )
    user.role = User.Roles.HR_CLIENT
    user.email = email or user.email
    user.set_password(password)
    user.is_active = True
    user.save()
    sync_role_managed_groups(user)

    HRPortalProfile.objects.update_or_create(
        user=user,
        defaults={"customer": customer, "is_active": True},
    )

    return build_customer_attestation_status(customer)


@transaction.atomic
def set_customer_hr_portal_user_active(
    *, actor, customer_id, user_id, is_active: bool
) -> dict:
    require_manage_attestation(actor)
    try:
        profile = HRPortalProfile.objects.select_related("user").get(
            customer_id=customer_id, user_id=user_id
        )
    except HRPortalProfile.DoesNotExist as exc:
        raise AttestationBusinessError(
            message="hr_user_not_found",
            details={"user_id": str(user_id)},
            http_status=404,
        ) from exc

    profile.is_active = is_active
    profile.save(update_fields=["is_active", "updated_at"])
    profile.user.is_active = is_active
    profile.user.save(update_fields=["is_active"])
    return build_customer_attestation_status(
        Customer.objects.get(pk=customer_id)
    )
