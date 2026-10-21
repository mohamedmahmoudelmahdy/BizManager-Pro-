"""Crash-safe recovery for e-invoicing outbox rows."""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from einvoicing.models import EInvoiceOutbox


def reclaim_stuck_processing(*, older_than_seconds: int = 900) -> int:
    """
    Return PROCESSING rows stuck after a worker crash back to PENDING.

    Default: 15 minutes. Safe because claim uses select_for_update(skip_locked).
    """
    cutoff = timezone.now() - timedelta(seconds=older_than_seconds)
    updated = EInvoiceOutbox.objects.filter(
        status=EInvoiceOutbox.Status.PROCESSING,
        available_at__lt=cutoff,
    ).update(
        status=EInvoiceOutbox.Status.PENDING,
        last_error="reclaimed_stuck_processing",
    )
    return int(updated)


def drain_pending_outbox(*, limit: int = 50, dispatch: bool = True) -> int:
    """
    Dispatch PENDING outbox events (recovery after broker outage / missed on_commit).

    Does not invent invoice submissions — only re-queues existing DB rows.
    """
    from einvoicing.services.outbox import _schedule_process_outbox

    ids = list(
        EInvoiceOutbox.objects.filter(status=EInvoiceOutbox.Status.PENDING)
        .order_by("available_at", "created_at")
        .values_list("pk", flat=True)[:limit]
    )
    if dispatch:
        for outbox_id in ids:
            # Schedule outside a long transaction; each delay is best-effort.
            _schedule_process_outbox(outbox_id)
    return len(ids)
