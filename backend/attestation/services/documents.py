"""Document validation and visibility defaults for attestation uploads."""

from __future__ import annotations

from attestation.exceptions import (
    AttestationFileTooLargeError,
    AttestationInvalidDocumentTypeError,
    AttestationInvalidFileTypeError,
)
from attestation.models import ApplicationDocument

from attestation.services.malware import MalwareScanError, scan_upload_if_configured


ALLOWED_CONTENT_TYPES = frozenset(
    {
        "application/pdf",
        "image/jpeg",
        "image/jpg",
        "image/png",
    }
)
ALLOWED_EXTENSIONS = frozenset({".pdf", ".jpg", ".jpeg", ".png"})
BLOCKED_EXTENSIONS = frozenset(
    {
        ".svg",
        ".html",
        ".htm",
        ".js",
        ".exe",
        ".bat",
        ".cmd",
        ".scr",
        ".zip",
        ".rar",
        ".7z",
        ".docm",
        ".xlsm",
        ".pptm",
    }
)
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MiB per file
# Passport + several degree cert/transcript pairs; keep under nginx/body caps.
MAX_SUBMISSION_TOTAL_BYTES = 45 * 1024 * 1024

DEFAULT_VISIBILITY = {
    ApplicationDocument.DocumentType.PASSPORT: ApplicationDocument.Visibility.APPLICANT_SUBMISSION,
    ApplicationDocument.DocumentType.DEGREE_CERTIFICATE: ApplicationDocument.Visibility.APPLICANT_SUBMISSION,
    ApplicationDocument.DocumentType.TRANSCRIPT: ApplicationDocument.Visibility.APPLICANT_SUBMISSION,
    ApplicationDocument.DocumentType.DATAFLOW_PAYMENT_PROOF: ApplicationDocument.Visibility.HR,
    ApplicationDocument.DocumentType.DATAFLOW_RESULT: ApplicationDocument.Visibility.HR,
    ApplicationDocument.DocumentType.MOHESR_PAYMENT_PROOF: ApplicationDocument.Visibility.HR,
    ApplicationDocument.DocumentType.FINAL_EQUIVALENCY: ApplicationDocument.Visibility.HR,
    ApplicationDocument.DocumentType.OTHER_INTERNAL: ApplicationDocument.Visibility.INTERNAL,
}

_SIGNATURES = (
    (b"%PDF", frozenset({".pdf"}), frozenset({"application/pdf"})),
    (b"\xff\xd8\xff", frozenset({".jpg", ".jpeg"}), frozenset({"image/jpeg", "image/jpg"})),
    (
        b"\x89PNG\r\n\x1a\n",
        frozenset({".png"}),
        frozenset({"image/png"}),
    ),
)


def default_visibility_for(document_type: str) -> str:
    try:
        return DEFAULT_VISIBILITY[document_type]
    except KeyError as exc:
        raise AttestationInvalidDocumentTypeError(
            details={"document_type": document_type}
        ) from exc


def _read_prefix(uploaded, nbytes: int = 16) -> bytes:
    handle = getattr(uploaded, "file", uploaded)
    pos = None
    try:
        if hasattr(handle, "tell"):
            pos = handle.tell()
        if hasattr(handle, "seek"):
            handle.seek(0)
        data = handle.read(nbytes) or b""
        return data
    finally:
        if pos is not None and hasattr(handle, "seek"):
            handle.seek(pos)


def validate_upload_file(uploaded) -> None:
    name = (getattr(uploaded, "name", "") or "").lower()
    content_type = (getattr(uploaded, "content_type", "") or "").lower().strip()
    size = int(getattr(uploaded, "size", 0) or 0)

    if size <= 0 or size > MAX_UPLOAD_BYTES:
        raise AttestationFileTooLargeError(
            details={"max_bytes": MAX_UPLOAD_BYTES, "size": size}
        )

    if any(name.endswith(ext) for ext in BLOCKED_EXTENSIONS):
        raise AttestationInvalidFileTypeError(
            details={"reason": "blocked_extension", "filename": name}
        )

    ext = ""
    if "." in name:
        ext = "." + name.rsplit(".", 1)[-1]
    if ext not in ALLOWED_EXTENSIONS:
        raise AttestationInvalidFileTypeError(
            details={
                "allowed_extensions": sorted(ALLOWED_EXTENSIONS),
                "filename": getattr(uploaded, "name", "") or "",
            }
        )

    # Do not trust empty or arbitrary MIME from the browser alone.
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        raise AttestationInvalidFileTypeError(
            details={
                "reason": "content_type",
                "content_type": content_type,
                "allowed_content_types": sorted(ALLOWED_CONTENT_TYPES),
            }
        )

    prefix = _read_prefix(uploaded)
    matched = False
    for signature, exts, mimes in _SIGNATURES:
        if prefix.startswith(signature):
            if ext not in exts:
                raise AttestationInvalidFileTypeError(
                    details={"reason": "signature_extension_mismatch", "extension": ext}
                )
            if content_type and content_type not in mimes:
                raise AttestationInvalidFileTypeError(
                    details={
                        "reason": "signature_mime_mismatch",
                        "content_type": content_type,
                    }
                )
            matched = True
            break
    if not matched:
        raise AttestationInvalidFileTypeError(
            details={"reason": "unrecognized_signature"}
        )

    try:
        scan_upload_if_configured(uploaded)
    except MalwareScanError as exc:
        raise AttestationInvalidFileTypeError(
            details={"reason": "malware_rejected"}
        ) from exc


def create_application_document(
    *,
    application,
    document_type: str,
    uploaded,
    degree=None,
    uploaded_by=None,
    visibility: str | None = None,
) -> ApplicationDocument:
    if document_type not in ApplicationDocument.DocumentType.values:
        raise AttestationInvalidDocumentTypeError(
            details={"document_type": document_type}
        )
    validate_upload_file(uploaded)
    original = (getattr(uploaded, "name", "") or "")[:255]
    # Prefer sniffed type over empty browser MIME.
    content_type = (getattr(uploaded, "content_type", "") or "").strip()
    if not content_type:
        lower = original.lower()
        if lower.endswith(".pdf"):
            content_type = "application/pdf"
        elif lower.endswith((".jpg", ".jpeg")):
            content_type = "image/jpeg"
        elif lower.endswith(".png"):
            content_type = "image/png"

    return ApplicationDocument.objects.create(
        application=application,
        degree=degree,
        document_type=document_type,
        visibility=visibility or default_visibility_for(document_type),
        file=uploaded,
        original_filename=original,
        content_type=content_type,
        size_bytes=int(getattr(uploaded, "size", 0) or 0),
        uploaded_by=uploaded_by,
    )
