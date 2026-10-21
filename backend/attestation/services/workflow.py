"""Internal attestation workflow transitions and notes."""

from __future__ import annotations

from django.db import transaction
from django.db.models import Prefetch, Q, QuerySet
from django.utils import timezone
from django.utils.dateparse import parse_date

from attestation.exceptions import (
    AttestationApplicationNotFoundError,
    AttestationDataflowDetailsRequiredError,
    AttestationFinalEquivalencyRequiredError,
    AttestationInvalidTransitionError,
    AttestationMohesrDetailsRequiredError,
    AttestationOperationNotPermittedError,
    AttestationPermissionDeniedError,
)
from attestation.models import (
    ApplicationDocument,
    ApplicationStatusHistory,
    AttestationApplication,
    AttestationAuditEvent,
)
from attestation.services.audit import record_attestation_audit
from attestation.services.documents import create_application_document

ALLOWED_TRANSITIONS = {
    AttestationApplication.Status.DOCUMENTS_RECEIVED: (
        AttestationApplication.Status.DATAFLOW_IN_PROGRESS,
    ),
    AttestationApplication.Status.DATAFLOW_IN_PROGRESS: (
        AttestationApplication.Status.MOHESR_IN_PROGRESS,
    ),
    AttestationApplication.Status.MOHESR_IN_PROGRESS: (
        AttestationApplication.Status.COMPLETED,
    ),
}


def _is_admin_or_manager(user) -> bool:
    return getattr(user, "is_superuser", False) or getattr(user, "role", None) in (
        "admin",
        "manager",
    )


def user_has_attestation_perm(user, codename: str) -> bool:
    if _is_admin_or_manager(user):
        return True
    return user.has_perm(f"attestation.{codename}")


def ensure_attestation_perm(user, *codenames: str, any_of: bool = False) -> None:
    if _is_admin_or_manager(user):
        return
    ok = (
        any(user.has_perm(f"attestation.{c}") for c in codenames)
        if any_of
        else all(user.has_perm(f"attestation.{c}") for c in codenames)
    )
    if not ok:
        raise AttestationPermissionDeniedError(details={"permissions": list(codenames)})


def applications_queryset() -> QuerySet:
    return AttestationApplication.objects.select_related(
        "batch",
        "batch__customer",
        "batch__linked_procedure",
        "created_by",
    ).prefetch_related(
        "degrees",
        Prefetch(
            "documents",
            queryset=ApplicationDocument.objects.select_related("degree").order_by(
                "uploaded_at"
            ),
        ),
        "status_history",
    )


def filter_applications(
    qs: QuerySet,
    *,
    search: str | None = None,
    status: str | None = None,
    batch_id: str | None = None,
    submitted_from: str | None = None,
    submitted_to: str | None = None,
) -> QuerySet:
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
    if batch_id:
        qs = qs.filter(batch_id=batch_id)
    if submitted_from:
        d = parse_date(submitted_from)
        if d:
            qs = qs.filter(submitted_at__date__gte=d)
    if submitted_to:
        d = parse_date(submitted_to)
        if d:
            qs = qs.filter(submitted_at__date__lte=d)
    return qs


def get_application_for_staff(*, actor, application_id) -> AttestationApplication:
    ensure_attestation_perm(
        actor,
        "view_attestationapplication",
        "change_attestationapplication",
        "process_attestationapplication",
        any_of=True,
    )
    try:
        return applications_queryset().get(pk=application_id)
    except AttestationApplication.DoesNotExist as exc:
        raise AttestationApplicationNotFoundError(
            details={"id": str(application_id)}
        ) from exc


def _lock_application(application_id) -> AttestationApplication:
    try:
        return AttestationApplication.objects.select_for_update().get(pk=application_id)
    except AttestationApplication.DoesNotExist as exc:
        raise AttestationApplicationNotFoundError(
            details={"id": str(application_id)}
        ) from exc


def _append_history(*, application, actor, from_status: str, to_status: str, note: str = ""):
    ApplicationStatusHistory.objects.create(
        application=application,
        from_status=from_status or "",
        to_status=to_status,
        changed_by=actor if getattr(actor, "is_authenticated", False) else None,
        actor_source=ApplicationStatusHistory.ActorSource.INTERNAL,
        internal_note=note or "",
    )


def update_internal_notes(*, actor, application_id, notes: str) -> AttestationApplication:
    ensure_attestation_perm(
        actor,
        "change_attestationapplication",
        "process_attestationapplication",
        "view_internal_notes",
        any_of=True,
    )
    with transaction.atomic():
        application = _lock_application(application_id)
        application.internal_notes = notes if notes is not None else ""
        application.save(update_fields=["internal_notes", "updated_at"])
        record_attestation_audit(
            event_type=AttestationAuditEvent.EventType.NOTES_UPDATED,
            actor_type=AttestationAuditEvent.ActorType.INTERNAL,
            actor_user=actor,
            application=application,
            batch=application.batch,
            metadata={"notes_length": len(application.internal_notes or "")},
        )
    return get_application_for_staff(actor=actor, application_id=application.pk)


def save_dataflow_details(
    *,
    actor,
    application_id,
    reference: str | None = None,
    submitted_at: str | None = None,
    payment_proof=None,
    result_file=None,
) -> AttestationApplication:
    ensure_attestation_perm(actor, "process_attestationapplication")
    with transaction.atomic():
        application = _lock_application(application_id)
        if reference is not None:
            application.dataflow_reference = str(reference).strip()
        if submitted_at is not None:
            application.dataflow_submitted_at = parse_date(submitted_at) if submitted_at else None
        application.save(
            update_fields=[
                "dataflow_reference",
                "dataflow_submitted_at",
                "updated_at",
            ]
        )
        if payment_proof is not None:
            create_application_document(
                application=application,
                document_type=ApplicationDocument.DocumentType.DATAFLOW_PAYMENT_PROOF,
                uploaded=payment_proof,
                uploaded_by=actor,
            )
        if result_file is not None:
            create_application_document(
                application=application,
                document_type=ApplicationDocument.DocumentType.DATAFLOW_RESULT,
                uploaded=result_file,
                uploaded_by=actor,
            )
    return get_application_for_staff(actor=actor, application_id=application_id)


def set_dataflow_in_progress(*, actor, application_id) -> AttestationApplication:
    ensure_attestation_perm(actor, "process_attestationapplication")
    with transaction.atomic():
        application = _lock_application(application_id)
        if application.status != AttestationApplication.Status.DOCUMENTS_RECEIVED:
            raise AttestationInvalidTransitionError(
                details={
                    "from": application.status,
                    "to": AttestationApplication.Status.DATAFLOW_IN_PROGRESS,
                }
            )
        has_proof = application.documents.filter(
            document_type=ApplicationDocument.DocumentType.DATAFLOW_PAYMENT_PROOF
        ).exists()
        if not application.dataflow_reference.strip() or not has_proof:
            raise AttestationDataflowDetailsRequiredError(
                details={
                    "dataflow_reference": bool(application.dataflow_reference.strip()),
                    "payment_proof": has_proof,
                }
            )
        from_status = application.status
        application.status = AttestationApplication.Status.DATAFLOW_IN_PROGRESS
        application.save(update_fields=["status", "updated_at"])
        _append_history(
            application=application,
            actor=actor,
            from_status=from_status,
            to_status=application.status,
        )
        record_attestation_audit(
            event_type=AttestationAuditEvent.EventType.DATAFLOW_TRANSITION,
            actor_type=AttestationAuditEvent.ActorType.INTERNAL,
            actor_user=actor,
            application=application,
            batch=application.batch,
            metadata={"from": from_status, "to": application.status},
        )
    return get_application_for_staff(actor=actor, application_id=application_id)


def save_mohesr_details(
    *,
    actor,
    application_id,
    reference: str | None = None,
    submitted_at: str | None = None,
    payment_proof=None,
) -> AttestationApplication:
    ensure_attestation_perm(actor, "process_attestationapplication")
    with transaction.atomic():
        application = _lock_application(application_id)
        if reference is not None:
            application.mohesr_reference = str(reference).strip()
        if submitted_at is not None:
            application.mohesr_submitted_at = parse_date(submitted_at) if submitted_at else None
        application.save(
            update_fields=["mohesr_reference", "mohesr_submitted_at", "updated_at"]
        )
        if payment_proof is not None:
            create_application_document(
                application=application,
                document_type=ApplicationDocument.DocumentType.MOHESR_PAYMENT_PROOF,
                uploaded=payment_proof,
                uploaded_by=actor,
            )
    return get_application_for_staff(actor=actor, application_id=application_id)


def set_mohesr_in_progress(*, actor, application_id) -> AttestationApplication:
    ensure_attestation_perm(actor, "process_attestationapplication")
    with transaction.atomic():
        application = _lock_application(application_id)
        if application.status != AttestationApplication.Status.DATAFLOW_IN_PROGRESS:
            raise AttestationInvalidTransitionError(
                details={
                    "from": application.status,
                    "to": AttestationApplication.Status.MOHESR_IN_PROGRESS,
                }
            )
        has_proof = application.documents.filter(
            document_type=ApplicationDocument.DocumentType.MOHESR_PAYMENT_PROOF
        ).exists()
        if not application.mohesr_reference.strip() or not has_proof:
            raise AttestationMohesrDetailsRequiredError(
                details={
                    "mohesr_reference": bool(application.mohesr_reference.strip()),
                    "payment_proof": has_proof,
                }
            )
        from_status = application.status
        application.status = AttestationApplication.Status.MOHESR_IN_PROGRESS
        application.save(update_fields=["status", "updated_at"])
        _append_history(
            application=application,
            actor=actor,
            from_status=from_status,
            to_status=application.status,
        )
        record_attestation_audit(
            event_type=AttestationAuditEvent.EventType.MOHESR_TRANSITION,
            actor_type=AttestationAuditEvent.ActorType.INTERNAL,
            actor_user=actor,
            application=application,
            batch=application.batch,
            metadata={"from": from_status, "to": application.status},
        )
    return get_application_for_staff(actor=actor, application_id=application_id)


def complete_application(
    *,
    actor,
    application_id,
    equivalency_file=None,
) -> AttestationApplication:
    ensure_attestation_perm(actor, "process_attestationapplication")
    with transaction.atomic():
        application = _lock_application(application_id)
        if application.status != AttestationApplication.Status.MOHESR_IN_PROGRESS:
            raise AttestationInvalidTransitionError(
                details={
                    "from": application.status,
                    "to": AttestationApplication.Status.COMPLETED,
                }
            )
        if equivalency_file is not None:
            create_application_document(
                application=application,
                document_type=ApplicationDocument.DocumentType.FINAL_EQUIVALENCY,
                uploaded=equivalency_file,
                uploaded_by=actor,
            )
        has_equivalency = application.documents.filter(
            document_type=ApplicationDocument.DocumentType.FINAL_EQUIVALENCY
        ).exists()
        if not has_equivalency:
            raise AttestationFinalEquivalencyRequiredError()
        from_status = application.status
        application.status = AttestationApplication.Status.COMPLETED
        application.completed_at = timezone.now()
        application.save(update_fields=["status", "completed_at", "updated_at"])
        _append_history(
            application=application,
            actor=actor,
            from_status=from_status,
            to_status=application.status,
        )
        record_attestation_audit(
            event_type=AttestationAuditEvent.EventType.COMPLETED,
            actor_type=AttestationAuditEvent.ActorType.INTERNAL,
            actor_user=actor,
            application=application,
            batch=application.batch,
            metadata={"from": from_status, "to": application.status},
        )
    return get_application_for_staff(actor=actor, application_id=application_id)


def get_document_for_download(*, actor, document_id) -> ApplicationDocument:
    ensure_attestation_perm(
        actor,
        "view_attestationapplication",
        "process_attestationapplication",
        any_of=True,
    )
    try:
        document = ApplicationDocument.objects.select_related(
            "application", "degree"
        ).get(pk=document_id)
    except ApplicationDocument.DoesNotExist as exc:
        raise AttestationApplicationNotFoundError(
            details={"document_id": str(document_id)}
        ) from exc
    if document.visibility == ApplicationDocument.Visibility.INTERNAL:
        if not user_has_attestation_perm(actor, "view_internal_notes") and not _is_admin_or_manager(
            actor
        ):
            # Internal docs require internal-notes-level access or process perm.
            if not user_has_attestation_perm(actor, "process_attestationapplication"):
                raise AttestationOperationNotPermittedError(
                    details={"reason": "document_visibility"}
                )
    return document
