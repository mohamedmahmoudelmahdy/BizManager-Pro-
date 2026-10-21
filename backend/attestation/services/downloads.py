"""Secure download helpers for attestation documents."""

from __future__ import annotations

import re
from urllib.parse import quote

from django.http import FileResponse

_UNSAFE_FILENAME = re.compile(r'[\r\n\x00"\\]')


def sanitize_download_filename(name: str | None, fallback: str = "document") -> str:
    text = (name or "").strip() or fallback
    text = _UNSAFE_FILENAME.sub("", text)
    text = text.replace("/", "_").replace("\\", "_")
    # Keep it short and ASCII-friendly for the quoted filename= parameter.
    ascii_name = text.encode("ascii", "ignore").decode("ascii").strip() or fallback
    return ascii_name[:180]


def build_secure_file_response(*, file_field, original_filename: str, content_type: str | None):
    """
    Stream a file with privacy-safe headers.

    - attachment disposition (no inline HTML/SVG execution risk)
    - nosniff
    - private, no-store cache
    """
    ctype = (content_type or "").strip() or "application/octet-stream"
    safe_name = sanitize_download_filename(original_filename)
    # RFC 5987 filename* for Unicode-capable clients.
    raw_name = (original_filename or safe_name).replace("\r", "").replace("\n", "")
    utf8_name = quote(raw_name)

    response = FileResponse(file_field.open("rb"), content_type=ctype, as_attachment=True)
    response["Content-Disposition"] = (
        f'attachment; filename="{safe_name}"; filename*=UTF-8\'\'{utf8_name}'
    )
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    response["Pragma"] = "no-cache"
    return response
