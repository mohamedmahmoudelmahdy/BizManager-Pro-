"""
Celery tasks for e-invoicing — foundation stubs only.

Idempotency rules:
* Outbox row is claimed with select_for_update(skip_locked=True).
* Document status transitions are guarded; duplicate delivery is a no-op.
* No provider API calls in this phase.
"""

from __future__ import annotations

import logging

from celery import shared_task
from django.db import transaction

from einvoicing.models import EInvoiceDocument, EInvoiceOutbox
from einvoicing.services.outbox import (
    mark_outbox_done,
    mark_outbox_failed,
    mark_outbox_processing,
)

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    name="einvoicing.process_outbox_event",
    max_retries=5,
    default_retry_delay=30,
    acks_late=True,
)
def process_einvoice_outbox_event(self, outbox_id: str) -> dict:
    event = mark_outbox_processing(outbox_id)
    if event is None:
        # Already processed / claimed — safe idempotent exit.
        return {"status": "skipped", "outbox_id": outbox_id}

    try:
        with transaction.atomic():
            document = EInvoiceDocument.objects.select_for_update().get(
                pk=event.document_id
            )
            if event.event_type == "submit":
                # Foundation: mark queued → submitting → submitted placeholder.
                # Real provider submission is intentionally not implemented.
                if document.status in (
                    EInvoiceDocument.Status.DRAFT,
                    EInvoiceDocument.Status.QUEUED,
                    EInvoiceDocument.Status.FAILED,
                ):
                    document.status = EInvoiceDocument.Status.SUBMITTING
                    document.save(update_fields=["status", "updated_at"])
                if document.status == EInvoiceDocument.Status.SUBMITTING:
                    document.status = EInvoiceDocument.Status.SUBMITTED
                    document.meta = {
                        **(document.meta or {}),
                        "foundation": True,
                        "note": "Provider integration not implemented",
                    }
                    document.save(update_fields=["status", "meta", "updated_at"])
            elif event.event_type == "poll_status":
                # Placeholder for future provider status polling.
                logger.info(
                    "einvoicing.poll_status stub document=%s",
                    document.pk,
                )
            else:
                raise ValueError(f"Unsupported event_type={event.event_type}")

        mark_outbox_done(outbox_id)
        return {"status": "done", "outbox_id": outbox_id, "document_id": str(document.pk)}
    except Exception as exc:  # noqa: BLE001 — surface to Celery retry / failure
        logger.exception("einvoicing outbox failed id=%s", outbox_id)
        if self.request.retries >= self.max_retries:
            mark_outbox_failed(outbox_id, str(exc))
            raise
        # Keep row re-claimable for retry (do not leave stuck in FAILED).
        EInvoiceOutbox.objects.filter(pk=outbox_id).update(
            status=EInvoiceOutbox.Status.PENDING,
            last_error=str(exc)[:2000],
        )
        raise self.retry(exc=exc)
