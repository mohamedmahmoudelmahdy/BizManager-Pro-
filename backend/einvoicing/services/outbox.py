"""Transactional outbox helpers for e-invoicing jobs."""

from __future__ import annotations

from typing import Any

from django.db import transaction
from django.utils import timezone

from einvoicing.models import EInvoiceDocument, EInvoiceOutbox


def enqueue_document_event(
    *,
    document: EInvoiceDocument,
    event_type: str,
    payload: dict[str, Any] | None = None,
    dispatch: bool = True,
) -> EInvoiceOutbox:
    """
    Persist an outbox row (caller must be inside an atomic block for the
    document mutation). Optionally schedule Celery after commit.
    """
    event = EInvoiceOutbox.objects.create(
        document=document,
        event_type=event_type,
        payload=payload or {},
        status=EInvoiceOutbox.Status.PENDING,
        available_at=timezone.now(),
    )
    if dispatch:
        _schedule_process_outbox(event.pk)
    return event


def _schedule_process_outbox(outbox_id) -> None:
    def _enqueue():
        # Late import keeps Celery optional at import time for manage.py.
        # If broker is down, leave the outbox row PENDING for recovery drain.
        import logging

        from einvoicing.tasks import process_einvoice_outbox_event

        try:
            process_einvoice_outbox_event.delay(str(outbox_id))
        except Exception as exc:  # noqa: BLE001
            logging.getLogger(__name__).error(
                "einvoicing outbox dispatch failed id=%s err=%s — left PENDING for recovery",
                outbox_id,
                exc,
            )

    transaction.on_commit(_enqueue)


@transaction.atomic
def mark_outbox_processing(outbox_id) -> EInvoiceOutbox | None:
    """Claim a pending outbox row (skip locked). Returns None if already taken."""
    qs = (
        EInvoiceOutbox.objects.select_for_update(skip_locked=True)
        .filter(pk=outbox_id, status=EInvoiceOutbox.Status.PENDING)
    )
    event = qs.first()
    if event is None:
        return None
    event.status = EInvoiceOutbox.Status.PROCESSING
    event.attempts += 1
    # Stamp claim time on available_at for stuck-PROCESSING reclaim.
    event.available_at = timezone.now()
    event.save(update_fields=["status", "attempts", "available_at"])
    return event


@transaction.atomic
def mark_outbox_done(outbox_id) -> None:
    EInvoiceOutbox.objects.filter(pk=outbox_id).update(
        status=EInvoiceOutbox.Status.DONE,
        processed_at=timezone.now(),
        last_error="",
    )


@transaction.atomic
def mark_outbox_failed(outbox_id, error: str) -> None:
    EInvoiceOutbox.objects.filter(pk=outbox_id).update(
        status=EInvoiceOutbox.Status.FAILED,
        last_error=(error or "")[:2000],
        processed_at=timezone.now(),
    )
