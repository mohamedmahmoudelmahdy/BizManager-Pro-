"""Celery application for BizManager Pro (broker = Redis DB 1 by default)."""

from __future__ import annotations

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("bizmanager")
app.config_from_object("django.conf:settings", namespace="CELERY")
# Deferred discovery after Django app registry is ready (worker / django.setup).
app.autodiscover_tasks(related_name="tasks")


@app.task(name="bizmanager.ping", bind=False)
def ping(payload: str = "pong") -> dict:
    """Harmless connectivity probe — no financial or invoice side effects."""
    # Side-channel marker so verification works without a Celery result backend.
    try:
        from django.core.cache import cache

        cache.set("bizmanager:verify:last_ping", payload, timeout=120)
    except Exception:  # noqa: BLE001 — probe must not crash the worker
        pass
    return {"ok": True, "echo": payload}
