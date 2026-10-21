"""Safe attestation audit event recording (no file bodies / secrets)."""

from __future__ import annotations

from typing import Any

from attestation.models import AttestationAuditEvent


def record_attestation_audit(
    *,
    event_type: str,
    actor_type: str,
    actor_user=None,
    application=None,
    batch=None,
    metadata: dict[str, Any] | None = None,
) -> AttestationAuditEvent:
    safe_meta: dict[str, Any] = {}
    for key, value in (metadata or {}).items():
        # Never persist secrets or bulky payloads.
        if key.lower() in {
            "password",
            "token",
            "authorization",
            "file",
            "content",
            "body",
            "internal_notes",
        }:
            continue
        if isinstance(value, (str, int, float, bool)) or value is None:
            safe_meta[key] = value
        else:
            safe_meta[key] = str(value)[:200]
    return AttestationAuditEvent.objects.create(
        event_type=event_type,
        actor_type=actor_type,
        actor_user=actor_user if getattr(actor_user, "is_authenticated", False) else None,
        application=application,
        batch=batch,
        metadata=safe_meta,
    )
