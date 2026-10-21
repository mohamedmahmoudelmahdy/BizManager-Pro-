"""Shared helpers for campaign hierarchy mutation services."""

from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError

from marketing.exceptions import (
    CampaignBudgetInvalidError,
    CampaignDatesInvalidError,
    EntityAlreadyArchivedError,
    ImmutableFieldError,
)
from marketing.services.lead_support import ensure_permission  # noqa: F401 — re-export


def reject_immutable_keys(updates: dict, immutable: frozenset[str]) -> None:
    present = sorted(k for k in updates if k in immutable)
    if present:
        raise ImmutableFieldError(details={"fields": present})


def map_model_validation_error(exc: DjangoValidationError) -> None:
    """Map model.clean() date/budget errors to stable codes; re-raise others."""
    message_dict = getattr(exc, "message_dict", None) or {}
    if "end_date" in message_dict or "start_date" in message_dict:
        raise CampaignDatesInvalidError(
            details={
                "fields": {
                    k: [str(m) for m in v]
                    for k, v in message_dict.items()
                    if k in ("start_date", "end_date")
                }
            }
        ) from exc
    if "budget" in message_dict or "amount" in message_dict:
        raise CampaignBudgetInvalidError(
            details={
                "fields": {
                    k: [str(m) for m in v]
                    for k, v in message_dict.items()
                    if k in ("budget", "amount")
                }
            }
        ) from exc
    raise exc


def map_unique_validation_error(
    exc: DjangoValidationError,
    error_cls: type,
    *,
    details: dict | None = None,
) -> None:
    """
    If ``exc`` looks like a uniqueness failure, raise ``error_cls``.
    Otherwise return without raising so the caller can map other errors.
    """
    message_dict = getattr(exc, "message_dict", None) or {}
    unique_hints = ("unique", "already exists", "must be unique")
    for msgs in message_dict.values():
        text = " ".join(str(m).lower() for m in msgs)
        if any(h in text for h in unique_hints):
            raise error_cls(details=details or {"fields": list(message_dict.keys())}) from exc
    if hasattr(exc, "messages"):
        text = " ".join(str(m).lower() for m in exc.messages)
        if any(h in text for h in unique_hints):
            raise error_cls(details=details or {}) from exc


def raise_if_inactive(entity: Any, *, entity_type: str) -> None:
    if getattr(entity, "is_active", True) is False:
        raise EntityAlreadyArchivedError(
            details={
                "entity_type": entity_type,
                "id": str(entity.pk),
            }
        )


def integrity_duplicate(exc: IntegrityError, error_cls: type, *, details: dict | None = None):
    raise error_cls(details=details or {}) from exc
