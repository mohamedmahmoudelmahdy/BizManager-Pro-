from django.db import IntegrityError, transaction
from django.test import TestCase

from einvoicing.models import EInvoiceDocument, EInvoiceOutbox
from einvoicing.services.outbox import enqueue_document_event
from einvoicing.tasks import process_einvoice_outbox_event


class EInvoiceOutboxFoundationTests(TestCase):
    def test_idempotency_key_unique(self):
        EInvoiceDocument.objects.create(idempotency_key="inv-1", status="draft")
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                EInvoiceDocument.objects.create(idempotency_key="inv-1", status="draft")

    def test_outbox_process_is_idempotent(self):
        doc = EInvoiceDocument.objects.create(
            idempotency_key="inv-2",
            status=EInvoiceDocument.Status.QUEUED,
        )
        # Persist outbox without requiring a live broker; invoke task synchronously.
        event = enqueue_document_event(
            document=doc, event_type="submit", dispatch=False
        )
        result = process_einvoice_outbox_event.run(str(event.pk))
        self.assertEqual(result["status"], "done")

        event.refresh_from_db()
        doc.refresh_from_db()
        self.assertEqual(event.status, EInvoiceOutbox.Status.DONE)
        self.assertEqual(doc.status, EInvoiceDocument.Status.SUBMITTED)

        # Second delivery of same outbox id is a no-op.
        result2 = process_einvoice_outbox_event.run(str(event.pk))
        self.assertEqual(result2["status"], "skipped")

    def test_duplicate_source_constraint(self):
        EInvoiceDocument.objects.create(
            idempotency_key="inv-3",
            source_type="payment",
            source_id="pay-1",
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                EInvoiceDocument.objects.create(
                    idempotency_key="inv-4",
                    source_type="payment",
                    source_id="pay-1",
                )
