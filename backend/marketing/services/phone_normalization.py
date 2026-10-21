"""Minimal phone normalization for Marketing CRM lead comparison.

Does not convert local UAE numbers (05…) to international (971…).
Country-code invention is out of scope.
"""

from __future__ import annotations

import re

from django.core.exceptions import ValidationError

# Spaces, hyphens, parentheses, dots, and similar formatting punctuation.
_FORMAT_CHARS = re.compile(r"[\s\-\(\)\.\[\]\{\}/\\_]")


class PhoneNormalizationError(ValidationError):
    """Raised when a phone value cannot be normalized to a digit comparison form."""


def normalize_phone(value: str | None) -> str:
    """
    Return a digit-preserving comparison form of a phone number.

    - Trims whitespace
    - Removes common formatting punctuation and spaces
    - Removes a leading '+'
    - Preserves all digits exactly (including a leading 0)
    - Rejects empty results, punctuation-only input, and alphabetic characters
    """
    if value is None:
        raise PhoneNormalizationError("Phone number is required.", code="phone_required")
    if not isinstance(value, str):
        raise PhoneNormalizationError("Phone number must be a string.", code="phone_type")

    text = value.strip()
    if not text:
        raise PhoneNormalizationError("Phone number is required.", code="phone_required")

    if re.search(r"[A-Za-z\u0600-\u06FF]", text):
        raise PhoneNormalizationError(
            "Phone number must not contain letters.",
            code="phone_letters",
        )

    cleaned = _FORMAT_CHARS.sub("", text)
    if cleaned.startswith("+"):
        cleaned = cleaned[1:]

    # Reject any remaining non-digit characters (unexpected symbols).
    if not cleaned.isdigit():
        raise PhoneNormalizationError(
            "Phone number contains invalid characters after normalization.",
            code="phone_invalid",
        )
    if not cleaned:
        raise PhoneNormalizationError(
            "Phone number has no digits after normalization.",
            code="phone_empty",
        )
    return cleaned
