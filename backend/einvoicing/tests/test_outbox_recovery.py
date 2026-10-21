from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from einvoicing.models import EInvoiceDocument, EInvoiceOutbox
from einvoicing.services.outbox import enqueue_document_event
from einvoicing.services.recovery import drain_pending_outbox, reclaim_stuck_processing
from einvoicing.tasks import process_einvoice_outbox_event


class EInvoiceOutboxRecoveryTests(TestCase):
    def test_reclaim_stuck_processing(self):
        doc = EInvoiceDocument.objects.create(
            idempotency_key="rec-1", status=EInvoiceDocument.Status.QUEUED
        )
        event = enqueue_document_event(
            document=doc, event_type="submit", dispatch=False
        )
        EInvoiceOutbox.objects.filter(pk=event.pk).update(
            status=EInvoiceOutbox.Status.PROCESSING,
            available_at=timezone.now() - timedelta(minutes=30),
        )
        n = reclaim_stuck_processing(older_than_seconds=60)
        self.assertEqual(n, 1)
        event.refresh_from_db()
        self.assertEqual(event.status, EInvoiceOutbox.Status.PENDING)

    def test_drain_pending_dispatches_without_duplicate_docs(self):
        doc = EInvoiceDocument.objects.create(
            idempotency_key="rec-2", status=EInvoiceDocument.Status.QUEUED
        )
        event = enqueue_document_event(
            document=doc, event_type="submit", dispatch=False
        )
        # Count only; actual delay is on_commit/eager in tests.
        n = drain_pending_outbox(limit=10, dispatch=False)
        self.assertEqual(n, 1)

        process_einvoice_outbox_event.run(str(event.pk))
        process_einvoice_outbox_event.run(str(event.pk))
        doc.refresh_from_db()
        self.assertEqual(doc.status, EInvoiceDocument.Status.SUBMITTED)
        self.assertEqual(
            EInvoiceDocument.objects.filter(idempotency_key="rec-2").count(), 1
        )
