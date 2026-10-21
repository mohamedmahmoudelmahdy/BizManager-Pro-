"""Invalidate soft dashboard cache after financially relevant mutations."""

from __future__ import annotations

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from dashboard.cache import bump_dashboard_summary_generation


def _bump(**kwargs):
    bump_dashboard_summary_generation()


def connect_dashboard_cache_invalidation() -> None:
    from expenses.models import Expense
    from payments.models import Payment, PaymentRefund
    from procedures.models import Procedure

    for model in (Payment, PaymentRefund, Procedure, Expense):
        post_save.connect(_bump, sender=model, dispatch_uid=f"dash_cache_save_{model._meta.label}")
        post_delete.connect(
            _bump, sender=model, dispatch_uid=f"dash_cache_delete_{model._meta.label}"
        )
