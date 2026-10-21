"""
E-Invoicing domain state in PostgreSQL/SQLite (system of record).

Redis/Celery only transport work; invoice identity and status live here.
No provider XML/tax/issuance logic in this foundation phase.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class EInvoiceDocument(models.Model):
    """Authoritative invoice issuance record (provider-agnostic)."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        QUEUED = "queued", "Queued"
        SUBMITTING = "submitting", "Submitting"
        SUBMITTED = "submitted", "Submitted"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Business idempotency key — e.g. hash of source document + tax period.
    idempotency_key = models.CharField(max_length=128)
    source_type = models.CharField(max_length=64, blank=True, default="")
    source_id = models.CharField(max_length=64, blank=True, default="")
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.DRAFT, db_index=True
    )
    provider_ref = models.CharField(max_length=128, blank=True, default="")
    # Opaque JSON for future provider payloads / error details (not legal XML yet).
    meta = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="einvoice_documents",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["idempotency_key"],
                name="einvoicing_unique_idempotency_key",
            ),
            models.UniqueConstraint(
                fields=["source_type", "source_id"],
                condition=~Q(source_id=""),
                name="einvoicing_unique_source_when_set",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "updated_at"]),
        ]

    def __str__(self) -> str:
        return f"EInvoiceDocument({self.idempotency_key}, {self.status})"


class EInvoiceOutbox(models.Model):
    """
    Transactional outbox for crash-safe async dispatch.

    Write the outbox row in the same DB transaction as the document state
    change, then enqueue Celery via transaction.on_commit.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PROCESSING = "processing", "Processing"
        DONE = "done", "Done"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        EInvoiceDocument,
        on_delete=models.CASCADE,
        related_name="outbox_events",
    )
    event_type = models.CharField(max_length=64)
    payload = models.JSONField(default=dict, blank=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True
    )
    attempts = models.PositiveIntegerField(default=0)
    available_at = models.DateTimeField(auto_now_add=True, db_index=True)
    last_error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["status", "available_at"]),
        ]
        ordering = ["available_at", "created_at"]

    def __str__(self) -> str:
        return f"EInvoiceOutbox({self.event_type}, {self.status})"
