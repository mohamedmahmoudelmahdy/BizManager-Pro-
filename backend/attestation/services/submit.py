"""Public attestation application submission (no financial side effects)."""

from __future__ import annotations

import json
from typing import Any

from django.db import transaction
from django.utils import timezone

from attestation.exceptions import (
    AttestationBatchUnavailableError,
    AttestationCertificateRequiredError,
    AttestationDegreeRequiredError,
    AttestationInvalidAcademicPeriodError,
    AttestationPassportRequiredError,
    AttestationSubmissionInvalidError,
    AttestationTranscriptRequiredError,
)
from attestation.models import (
    ApplicationDegree,
    ApplicationDocument,
    ApplicationStatusHistory,
    AttestationApplication,
    AttestationAuditEvent,
    AttestationBatch,
    AttestationSubmissionIdempotency,
)
from attestation.services.audit import record_attestation_audit
from attestation.services.captcha import CaptchaRejected, verify_captcha_token
from attestation.services.documents import (
    MAX_SUBMISSION_TOTAL_BYTES,
    create_application_document,
)
from attestation.services.phone import normalize_applicant_phone
from attestation.services.reference_numbers import allocate_attestation_number
from attestation.storage import get_attestation_storage
from attestation.exceptions import AttestationFileTooLargeError


def get_active_batch_by_slug(public_slug: str) -> AttestationBatch:
    """
    Resolve public submit slug.

    Preferred: Customer.attestation_apply_slug → active batch.
    Legacy fallback: AttestationBatch.public_slug.
    """
    from attestation.services.customer_slug import get_active_batch_for_customer_slug

    return get_active_batch_for_customer_slug(public_slug)


def _parse_degrees_payload(raw: Any) -> list[dict]:
    if raw is None or raw == "":
        raise AttestationDegreeRequiredError(details={"reason": "missing"})
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise AttestationSubmissionInvalidError(
                details={"field": "degrees", "reason": "invalid_json"}
            ) from exc
    if not isinstance(raw, list) or not raw:
        raise AttestationDegreeRequiredError(details={"reason": "empty"})
    return raw


def _validate_degree_dict(item: dict, index: int) -> dict:
    if not isinstance(item, dict):
        raise AttestationSubmissionInvalidError(
            details={"field": "degrees", "index": index, "reason": "not_object"}
        )
    required = (
        "study_location",
        "university",
        "degree_level",
        "major",
        "start_year",
        "completion_year",
        "final_grade",
    )
    missing = [k for k in required if not str(item.get(k, "")).strip()]
    if missing:
        raise AttestationSubmissionInvalidError(
            details={"field": "degrees", "index": index, "missing": missing}
        )

    # Reject exact-date aliases to keep year precision explicit.
    for banned in ("start_date", "completion_date", "customer_id", "procedure_id", "batch_id"):
        if banned in item:
            raise AttestationSubmissionInvalidError(
                details={"field": "degrees", "index": index, "forbidden": banned}
            )

    try:
        start_year = int(item["start_year"])
        completion_year = int(item["completion_year"])
    except (TypeError, ValueError) as exc:
        raise AttestationInvalidAcademicPeriodError(
            details={"index": index, "reason": "year_not_integer"}
        ) from exc

    if start_year < 1950 or completion_year > 2100 or start_year > completion_year:
        raise AttestationInvalidAcademicPeriodError(
            details={
                "index": index,
                "start_year": start_year,
                "completion_year": completion_year,
            }
        )

    return {
        "study_location": str(item["study_location"]).strip(),
        "university": str(item["university"]).strip(),
        "degree_level": str(item["degree_level"]).strip(),
        "major": str(item["major"]).strip(),
        "start_year": start_year,
        "completion_year": completion_year,
        "final_grade": str(item["final_grade"]).strip(),
        "sort_order": index,
    }


def _reject_public_control_fields(data: dict) -> None:
    forbidden = (
        "customer_id",
        "procedure_id",
        "batch_id",
        "status",
        "internal_notes",
        "reference_number",
        "dataflow_reference",
        "mohesr_reference",
        "completed_at",
    )
    present = [k for k in forbidden if k in data and data.get(k) not in (None, "")]
    if present:
        raise AttestationSubmissionInvalidError(
            details={"forbidden_fields": present}
        )


def _reject_honeypot(data: dict) -> None:
    """Reject bots that fill hidden fields. Do not reveal anti-bot logic."""
    for field in ("website", "company_url", "fax_number"):
        value = data.get(field)
        if value not in (None, ""):
            raise AttestationSubmissionInvalidError(details={"reason": "rejected"})


def _total_upload_bytes(files) -> int:
    if not files:
        return 0
    total = 0
    for key in files:
        items = files.getlist(key) if hasattr(files, "getlist") else [files.get(key)]
        for item in items:
            if item is None:
                continue
            total += int(getattr(item, "size", 0) or 0)
    return total


def _cleanup_orphan_files(names: list[str]) -> None:
    if not names:
        return
    storage = get_attestation_storage()
    for name in names:
        try:
            if name and storage.exists(name):
                storage.delete(name)
        except Exception:
            pass


def submit_public_application(
    *,
    public_slug: str,
    data: dict,
    files,
    idempotency_key: str | None = None,
) -> dict:
    """
    Create one AttestationApplication under the active batch.

    Financial isolation: does not create Procedure/Payment/Expense or mutate balances.
    """
    _reject_public_control_fields(data)
    _reject_honeypot(data)
    try:
        verify_captcha_token(data.get("captcha_token"))
    except CaptchaRejected:
        raise AttestationSubmissionInvalidError(details={"reason": "rejected"}) from None
    batch = get_active_batch_by_slug(public_slug)

    key = (idempotency_key or "").strip()[:128]
    if key:
        existing = AttestationSubmissionIdempotency.objects.filter(
            batch=batch, key=key
        ).first()
        if existing:
            return existing.response_payload

    full_name = str(data.get("full_name") or "").strip()
    if not full_name:
        raise AttestationSubmissionInvalidError(
            details={"field": "full_name", "reason": "required"}
        )

    phone_raw, phone_normalized = normalize_applicant_phone(data.get("phone"))
    degree_rows = [
        _validate_degree_dict(item, idx)
        for idx, item in enumerate(_parse_degrees_payload(data.get("degrees")))
    ]

    passport = files.get("passport") if files is not None else None
    if not passport:
        raise AttestationPassportRequiredError()

    total_bytes = _total_upload_bytes(files)
    if total_bytes > MAX_SUBMISSION_TOTAL_BYTES:
        raise AttestationFileTooLargeError(
            details={
                "max_total_bytes": MAX_SUBMISSION_TOTAL_BYTES,
                "size": total_bytes,
            }
        )

    # Allocate reference outside the write transaction (durable reservation).
    reference_number = allocate_attestation_number()
    saved_storage_names: list[str] = []

    try:
        with transaction.atomic():
            application = AttestationApplication.objects.create(
                reference_number=reference_number,
                batch=batch,
                full_name=full_name,
                phone=phone_raw,
                phone_normalized=phone_normalized,
                status=AttestationApplication.Status.DOCUMENTS_RECEIVED,
                submitted_at=timezone.now(),
                created_by=None,
            )

            degrees: list[ApplicationDegree] = []
            for row in degree_rows:
                degrees.append(
                    ApplicationDegree.objects.create(application=application, **row)
                )

            passport_doc = create_application_document(
                application=application,
                document_type=ApplicationDocument.DocumentType.PASSPORT,
                uploaded=passport,
                uploaded_by=None,
            )
            saved_storage_names.append(passport_doc.file.name)

            for idx, degree in enumerate(degrees):
                cert = files.get(f"degree_{idx}_certificate") if files is not None else None
                transcript = (
                    files.get(f"degree_{idx}_transcript") if files is not None else None
                )
                if not cert:
                    raise AttestationCertificateRequiredError(details={"degree_index": idx})
                if not transcript:
                    raise AttestationTranscriptRequiredError(details={"degree_index": idx})
                cert_doc = create_application_document(
                    application=application,
                    document_type=ApplicationDocument.DocumentType.DEGREE_CERTIFICATE,
                    uploaded=cert,
                    degree=degree,
                    uploaded_by=None,
                )
                saved_storage_names.append(cert_doc.file.name)
                tr_doc = create_application_document(
                    application=application,
                    document_type=ApplicationDocument.DocumentType.TRANSCRIPT,
                    uploaded=transcript,
                    degree=degree,
                    uploaded_by=None,
                )
                saved_storage_names.append(tr_doc.file.name)

            ApplicationStatusHistory.objects.create(
                application=application,
                from_status="",
                to_status=AttestationApplication.Status.DOCUMENTS_RECEIVED,
                changed_by=None,
                actor_source=ApplicationStatusHistory.ActorSource.PUBLIC_SUBMISSION,
                internal_note="",
            )

            payload = {
                "reference_number": application.reference_number,
                "status": application.status,
                "submitted_at": application.submitted_at.isoformat(),
                "message_code": "attestation_application_submitted",
            }

            if key:
                AttestationSubmissionIdempotency.objects.create(
                    batch=batch,
                    key=key,
                    reference_number=application.reference_number,
                    response_payload=payload,
                )

            record_attestation_audit(
                event_type=AttestationAuditEvent.EventType.PUBLIC_SUBMITTED,
                actor_type=AttestationAuditEvent.ActorType.PUBLIC,
                application=application,
                batch=batch,
                metadata={"reference_number": application.reference_number},
            )
            # DB rows own these files after successful commit.
            saved_storage_names.clear()
            return payload
    except Exception:
        _cleanup_orphan_files(saved_storage_names)
        raise
