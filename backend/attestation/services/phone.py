"""Phone handling for attestation applicants (reuse marketing normalizer)."""

from __future__ import annotations

from marketing.services.phone_normalization import (
    PhoneNormalizationError,
    normalize_phone,
)

from attestation.exceptions import AttestationSubmissionInvalidError


def normalize_applicant_phone(raw: str | None) -> tuple[str, str]:
    """
    Return (raw_trimmed, normalized_digits).

    Normalized form is for search only — not unique.
    """
    if raw is None or not str(raw).strip():
        raise AttestationSubmissionInvalidError(
            details={"field": "phone", "reason": "required"},
            message="attestation_submission_invalid",
        )
    text = str(raw).strip()
    try:
        normalized = normalize_phone(text)
    except PhoneNormalizationError as exc:
        raise AttestationSubmissionInvalidError(
            details={"field": "phone", "reason": getattr(exc, "code", "invalid")},
        ) from exc
    return text, normalized
