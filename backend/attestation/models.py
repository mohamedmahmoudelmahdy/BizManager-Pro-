"""Certificate Attestation domain models (operational; not financial)."""

from __future__ import annotations

import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from attestation.storage import get_attestation_storage


def application_document_upload_path(instance: "ApplicationDocument", filename: str) -> str:
    """Store under opaque UUID filenames; never expose the original name in the path."""
    ext = ""
    if "." in (filename or ""):
        ext = "." + filename.rsplit(".", 1)[-1].lower()[:10]
    return (
        f"attestation/{instance.application_id}/"
        f"{instance.document_type}/{uuid.uuid4().hex}{ext}"
    )


class AttestationNumberSequence(models.Model):
    """Sequential ATT-###### counter (permanent reservation; gaps allowed)."""

    scope_key = models.CharField(max_length=100, unique=True, default="default")
    next_value = models.PositiveBigIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["scope_key"]

    def clean(self):
        if self.next_value is not None and self.next_value < 1:
            raise ValidationError({"next_value": "next_value must be >= 1."})

    def __str__(self):
        return f"AttestationNumberSequence({self.scope_key}) next={self.next_value}"


class AttestationBatch(models.Model):
    """
    Operational configuration for one bulk Certificate Attestation Procedure.

    The linked Procedure remains the commercial/financial source of truth.
    This model does not store charges, costs, payments, or balances.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.PROTECT,
        related_name="attestation_batches",
    )
    linked_procedure = models.OneToOneField(
        "procedures.Procedure",
        on_delete=models.PROTECT,
        related_name="attestation_batch",
    )
    title = models.CharField(max_length=255)
    expected_applicant_count = models.PositiveIntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    public_slug = models.SlugField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        permissions = [
            ("manage_attestationbatch", "Can manage attestation batches"),
            ("process_attestationapplication", "Can process attestation applications"),
            ("view_internal_notes", "Can view attestation internal notes"),
            ("view_hr_attestation_portal", "Can access HR attestation portal"),
            ("view_hr_attestationapplication", "Can view HR attestation applications"),
            ("download_hr_attestationdocument", "Can download HR attestation documents"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["customer"],
                condition=models.Q(is_active=True),
                name="attestation_one_active_batch_per_customer",
            ),
        ]

    def __str__(self):
        return f"{self.title} ({self.public_slug})"


class AttestationApplication(models.Model):
    class Status(models.TextChoices):
        DOCUMENTS_RECEIVED = "documents_received", "Documents received"
        DATAFLOW_IN_PROGRESS = "dataflow_in_progress", "DataFlow in progress"
        MOHESR_IN_PROGRESS = "mohesr_in_progress", "MOHESR in progress"
        COMPLETED = "completed", "Completed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reference_number = models.CharField(max_length=32, unique=True, editable=False)
    batch = models.ForeignKey(
        AttestationBatch,
        on_delete=models.PROTECT,
        related_name="applications",
    )
    full_name = models.CharField(max_length=255)
    phone = models.CharField(max_length=50)
    phone_normalized = models.CharField(max_length=50, db_index=True)
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.DOCUMENTS_RECEIVED,
        db_index=True,
    )
    internal_notes = models.TextField(blank=True, default="")

    dataflow_reference = models.CharField(max_length=255, blank=True, default="")
    dataflow_submitted_at = models.DateField(null=True, blank=True)
    mohesr_reference = models.CharField(max_length=255, blank=True, default="")
    mohesr_submitted_at = models.DateField(null=True, blank=True)

    submitted_at = models.DateTimeField(default=timezone.now, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_attestation_applications",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-submitted_at", "-created_at"]
        indexes = [
            models.Index(fields=["batch", "status"]),
            models.Index(fields=["full_name"]),
        ]

    def __str__(self):
        return f"{self.reference_number} — {self.full_name}"


class ApplicationDegree(models.Model):
    """Academic degree within an attestation application (year precision)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    application = models.ForeignKey(
        AttestationApplication,
        on_delete=models.CASCADE,
        related_name="degrees",
    )
    study_location = models.CharField(max_length=255)
    university = models.CharField(max_length=255)
    degree_level = models.CharField(max_length=255)
    major = models.CharField(max_length=255)
    start_year = models.PositiveIntegerField()
    completion_year = models.PositiveIntegerField()
    final_grade = models.CharField(max_length=255)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort_order", "created_at"]

    def clean(self):
        if (
            self.start_year is not None
            and self.completion_year is not None
            and self.start_year > self.completion_year
        ):
            raise ValidationError(
                {"completion_year": "completion_year must be >= start_year."}
            )

    def __str__(self):
        return f"{self.degree_level} — {self.university}"


class ApplicationDocument(models.Model):
    class DocumentType(models.TextChoices):
        PASSPORT = "passport", "Passport"
        DEGREE_CERTIFICATE = "degree_certificate", "Degree certificate"
        TRANSCRIPT = "transcript", "Transcript"
        DATAFLOW_PAYMENT_PROOF = "dataflow_payment_proof", "DataFlow payment proof"
        DATAFLOW_RESULT = "dataflow_result", "DataFlow result"
        MOHESR_PAYMENT_PROOF = "mohesr_payment_proof", "MOHESR payment proof"
        FINAL_EQUIVALENCY = "final_equivalency", "Final equivalency"
        OTHER_INTERNAL = "other_internal", "Other internal"

    class Visibility(models.TextChoices):
        INTERNAL = "internal", "Internal only"
        HR = "hr", "HR visible"
        APPLICANT_SUBMISSION = "applicant_submission", "Applicant submission"

    DEGREE_REQUIRED_TYPES = frozenset(
        {DocumentType.DEGREE_CERTIFICATE, DocumentType.TRANSCRIPT}
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    application = models.ForeignKey(
        AttestationApplication,
        on_delete=models.CASCADE,
        related_name="documents",
    )
    degree = models.ForeignKey(
        ApplicationDegree,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="documents",
    )
    document_type = models.CharField(max_length=40, choices=DocumentType.choices)
    visibility = models.CharField(
        max_length=32,
        choices=Visibility.choices,
        default=Visibility.INTERNAL,
    )
    file = models.FileField(
        upload_to=application_document_upload_path,
        storage=get_attestation_storage,
    )
    original_filename = models.CharField(max_length=255, blank=True, default="")
    content_type = models.CharField(max_length=100, blank=True, default="")
    size_bytes = models.PositiveIntegerField(default=0)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="attestation_documents_uploaded",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at"]
        indexes = [
            models.Index(fields=["application", "document_type"]),
        ]

    def clean(self):
        if self.document_type in self.DEGREE_REQUIRED_TYPES and self.degree_id is None:
            raise ValidationError(
                {"degree": "Certificate and transcript require a degree."}
            )
        if (
            self.document_type == self.DocumentType.PASSPORT
            and self.degree_id is not None
        ):
            raise ValidationError({"degree": "Passport must not be linked to a degree."})

    def __str__(self):
        return f"{self.document_type} ({self.original_filename})"


class ApplicationStatusHistory(models.Model):
    """Append-only status transition log."""

    class ActorSource(models.TextChoices):
        PUBLIC_SUBMISSION = "public_submission", "Public submission"
        INTERNAL = "internal", "Internal staff"
        SYSTEM = "system", "System"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    application = models.ForeignKey(
        AttestationApplication,
        on_delete=models.CASCADE,
        related_name="status_history",
    )
    from_status = models.CharField(max_length=32, blank=True, default="")
    to_status = models.CharField(max_length=32)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="attestation_status_changes",
    )
    actor_source = models.CharField(
        max_length=32,
        choices=ActorSource.choices,
        default=ActorSource.INTERNAL,
    )
    internal_note = models.TextField(blank=True, default="")
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["changed_at"]
        verbose_name_plural = "application status histories"

    def __str__(self):
        return f"{self.from_status or '∅'} → {self.to_status}"


class AttestationSubmissionIdempotency(models.Model):
    """Optional public double-submit protection via Idempotency-Key header."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(
        AttestationBatch,
        on_delete=models.CASCADE,
        related_name="idempotency_keys",
    )
    key = models.CharField(max_length=128)
    reference_number = models.CharField(max_length=32)
    response_payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["batch", "key"],
                name="uniq_attestation_idempotency_batch_key",
            )
        ]
        indexes = [
            models.Index(fields=["created_at"]),
        ]


class HRPortalProfile(models.Model):
    """
    Links an external HR portal User to exactly one Customer organization.

    Kept off accounts.User to avoid polluting internal employee semantics.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="hr_portal_profile",
    )
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.PROTECT,
        related_name="hr_portal_profiles",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["customer__name", "user__username"]

    def __str__(self):
        return f"HRPortalProfile({self.user_id} → {self.customer_id})"


class AttestationAuditEvent(models.Model):
    """Append-only security/operational audit events (not status history)."""

    class EventType(models.TextChoices):
        PUBLIC_SUBMITTED = "public_submitted", "Public application submitted"
        DOCUMENT_DOWNLOADED_INTERNAL = (
            "document_downloaded_internal",
            "Internal document download",
        )
        DOCUMENT_DOWNLOADED_HR = "document_downloaded_hr", "HR document download"
        NOTES_UPDATED = "notes_updated", "Internal notes updated"
        DATAFLOW_TRANSITION = "dataflow_transition", "Moved to DataFlow"
        MOHESR_TRANSITION = "mohesr_transition", "Moved to MOHESR"
        COMPLETED = "completed", "Application completed"
        HR_ACCESS_DENIED = "hr_access_denied", "HR access denied"
        PUBLIC_REJECTED = "public_rejected", "Public submission rejected"

    class ActorType(models.TextChoices):
        PUBLIC = "public", "Public"
        INTERNAL = "internal", "Internal staff"
        HR = "hr", "HR portal"
        SYSTEM = "system", "System"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_type = models.CharField(max_length=64, choices=EventType.choices, db_index=True)
    application = models.ForeignKey(
        AttestationApplication,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_events",
    )
    batch = models.ForeignKey(
        AttestationBatch,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_events",
    )
    actor_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="attestation_audit_events",
    )
    actor_type = models.CharField(
        max_length=32, choices=ActorType.choices, default=ActorType.SYSTEM
    )
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.event_type} @ {self.created_at}"
