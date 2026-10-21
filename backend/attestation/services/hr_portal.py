"""HR portal customer scoping and read-only query helpers."""

from __future__ import annotations

from django.db.models import Prefetch, Q, QuerySet

from attestation.exceptions import (
    AttestationApplicationNotFoundError,
    AttestationPermissionDeniedError,
)
from attestation.models import (
    ApplicationDocument,
    AttestationApplication,
    AttestationBatch,
    HRPortalProfile,
)

HR_VISIBLE_VISIBILITIES = frozenset(
    {
        ApplicationDocument.Visibility.HR,
        ApplicationDocument.Visibility.APPLICANT_SUBMISSION,
    }
)


def get_hr_profile(user) -> HRPortalProfile | None:
    if not user or not getattr(user, "is_authenticated", False):
        return None
    try:
        profile = user.hr_portal_profile
    except HRPortalProfile.DoesNotExist:
        return None
    if not profile.is_active:
        return None
    return profile


def user_has_hr_perm(user, codename: str) -> bool:
    return bool(user and user.has_perm(f"attestation.{codename}"))


def ensure_hr_portal_access(user) -> HRPortalProfile:
    if not user or not getattr(user, "is_authenticated", False):
        raise AttestationPermissionDeniedError(details={"reason": "authentication_required"})
    if not getattr(user, "is_active", False):
        raise AttestationPermissionDeniedError(details={"reason": "account_inactive"})
    profile = get_hr_profile(user)
    if profile is None:
        raise AttestationPermissionDeniedError(
            details={"reason": "hr_profile_required"}
        )
    if not (
        user_has_hr_perm(user, "view_hr_attestation_portal")
        or user_has_hr_perm(user, "view_hr_attestationapplication")
    ):
        raise AttestationPermissionDeniedError(
            details={"reason": "hr_permission_required"}
        )
    return profile


def ensure_hr_download_access(user) -> HRPortalProfile:
    profile = ensure_hr_portal_access(user)
    if not user_has_hr_perm(user, "download_hr_attestationdocument"):
        # Portal viewers may also download when they hold view_hr_attestationapplication
        # only if they also have download perm — require explicit download perm.
        raise AttestationPermissionDeniedError(
            details={"reason": "hr_download_permission_required"}
        )
    return profile


def hr_visible_documents_qs() -> QuerySet:
    return ApplicationDocument.objects.filter(
        visibility__in=HR_VISIBLE_VISIBILITIES
    ).select_related("degree").order_by("uploaded_at")


def hr_applications_queryset(customer_id) -> QuerySet:
    """Customer-scoped applications — call BEFORE search/filters/pagination."""
    return (
        AttestationApplication.objects.filter(batch__customer_id=customer_id)
        .select_related("batch", "batch__customer")
        .prefetch_related(
            "degrees",
            Prefetch("documents", queryset=hr_visible_documents_qs()),
            "status_history",
        )
    )


def filter_hr_applications(
    qs: QuerySet,
    *,
    search: str | None = None,
    status: str | None = None,
    submitted_from: str | None = None,
    submitted_to: str | None = None,
) -> QuerySet:
    from django.utils.dateparse import parse_date

    if search:
        term = search.strip()
        if term:
            qs = qs.filter(
                Q(reference_number__icontains=term)
                | Q(full_name__icontains=term)
                | Q(phone__icontains=term)
                | Q(phone_normalized__icontains=term)
            )
    if status:
        qs = qs.filter(status=status)
    if submitted_from:
        d = parse_date(submitted_from)
        if d:
            qs = qs.filter(submitted_at__date__gte=d)
    if submitted_to:
        d = parse_date(submitted_to)
        if d:
            qs = qs.filter(submitted_at__date__lte=d)
    return qs


def get_hr_application(*, user, application_id) -> AttestationApplication:
    profile = ensure_hr_portal_access(user)
    try:
        return hr_applications_queryset(profile.customer_id).get(pk=application_id)
    except AttestationApplication.DoesNotExist as exc:
        # Hide existence across customers.
        raise AttestationApplicationNotFoundError(
            details={"id": str(application_id)}
        ) from exc


def get_hr_document_for_download(*, user, document_id) -> ApplicationDocument:
    profile = ensure_hr_download_access(user)
    try:
        document = ApplicationDocument.objects.select_related(
            "application",
            "application__batch",
            "degree",
        ).get(pk=document_id)
    except ApplicationDocument.DoesNotExist as exc:
        raise AttestationApplicationNotFoundError(
            details={"document_id": str(document_id)}
        ) from exc

    if document.application.batch.customer_id != profile.customer_id:
        raise AttestationApplicationNotFoundError(
            details={"document_id": str(document_id)}
        )
    if document.visibility not in HR_VISIBLE_VISIBILITIES:
        raise AttestationApplicationNotFoundError(
            details={"document_id": str(document_id)}
        )
    return document


def get_active_batch_for_customer(customer_id) -> AttestationBatch | None:
    return (
        AttestationBatch.objects.filter(customer_id=customer_id, is_active=True)
        .order_by("-created_at")
        .first()
    )


def build_hr_overview(*, user) -> dict:
    profile = ensure_hr_portal_access(user)
    batch = get_active_batch_for_customer(profile.customer_id)
    base = AttestationApplication.objects.filter(batch__customer_id=profile.customer_id)
    if batch:
        base = base.filter(batch_id=batch.pk)

    counts = {
        "submitted": base.count(),
        "documents_received": base.filter(
            status=AttestationApplication.Status.DOCUMENTS_RECEIVED
        ).count(),
        "dataflow_in_progress": base.filter(
            status=AttestationApplication.Status.DATAFLOW_IN_PROGRESS
        ).count(),
        "mohesr_in_progress": base.filter(
            status=AttestationApplication.Status.MOHESR_IN_PROGRESS
        ).count(),
        "completed": base.filter(
            status=AttestationApplication.Status.COMPLETED
        ).count(),
    }
    expected = batch.expected_applicant_count if batch else None
    remaining = 0
    if expected is not None:
        remaining = max(0, int(expected) - int(counts["submitted"]))

    return {
        "customer": {
            "id": str(profile.customer_id),
            "display_name": profile.customer.company_name
            or profile.customer.name
            or str(profile.customer_id),
        },
        "batch": (
            {
                "id": str(batch.pk),
                "title": batch.title,
                "expected_applicant_count": batch.expected_applicant_count,
                "is_active": batch.is_active,
            }
            if batch
            else None
        ),
        "summary": {
            **counts,
            "remaining_expected": remaining,
        },
    }
