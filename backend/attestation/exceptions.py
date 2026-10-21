"""Structured Attestation API exceptions."""

from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.exceptions import APIException


class AttestationBusinessError(Exception):
    code: str = "attestation_error"
    http_status: int = status.HTTP_400_BAD_REQUEST

    def __init__(
        self,
        *,
        details: dict[str, Any] | None = None,
        message: str | None = None,
        http_status: int | None = None,
    ):
        self.details = details or {}
        self.message = message or self.code
        if http_status is not None:
            self.http_status = http_status
        super().__init__(self.message)


class AttestationBatchUnavailableError(AttestationBusinessError):
    code = "attestation_batch_unavailable"
    http_status = status.HTTP_404_NOT_FOUND


class AttestationSubmissionInvalidError(AttestationBusinessError):
    code = "attestation_submission_invalid"


class AttestationDegreeRequiredError(AttestationBusinessError):
    code = "attestation_degree_required"


class AttestationPassportRequiredError(AttestationBusinessError):
    code = "attestation_passport_required"


class AttestationCertificateRequiredError(AttestationBusinessError):
    code = "attestation_certificate_required"


class AttestationTranscriptRequiredError(AttestationBusinessError):
    code = "attestation_transcript_required"


class AttestationInvalidAcademicPeriodError(AttestationBusinessError):
    code = "attestation_invalid_academic_period"


class AttestationInvalidDocumentTypeError(AttestationBusinessError):
    code = "attestation_invalid_document_type"


class AttestationFileTooLargeError(AttestationBusinessError):
    code = "attestation_file_too_large"


class AttestationInvalidFileTypeError(AttestationBusinessError):
    code = "attestation_invalid_file_type"


class AttestationRateLimitedError(AttestationBusinessError):
    code = "attestation_rate_limited"
    http_status = status.HTTP_429_TOO_MANY_REQUESTS


class AttestationApplicationNotFoundError(AttestationBusinessError):
    code = "attestation_application_not_found"
    http_status = status.HTTP_404_NOT_FOUND


class AttestationInvalidTransitionError(AttestationBusinessError):
    code = "attestation_invalid_transition"


class AttestationDataflowDetailsRequiredError(AttestationBusinessError):
    code = "attestation_dataflow_details_required"


class AttestationMohesrDetailsRequiredError(AttestationBusinessError):
    code = "attestation_mohesr_details_required"


class AttestationFinalEquivalencyRequiredError(AttestationBusinessError):
    code = "attestation_final_equivalency_required"


class AttestationPermissionDeniedError(AttestationBusinessError):
    code = "permission_denied"
    http_status = status.HTTP_403_FORBIDDEN


class AttestationOperationNotPermittedError(AttestationBusinessError):
    code = "operation_not_permitted"
    http_status = status.HTTP_403_FORBIDDEN


class AttestationAPIException(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "attestation_error"
    default_code = "attestation_error"

    def __init__(
        self,
        *,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
        status_code: int | None = None,
    ):
        self.status_code = status_code or self.status_code
        self.detail = {
            "error": {
                "code": code,
                "message": message,
                "details": details or {},
            }
        }


def raise_api_error(exc: AttestationBusinessError) -> None:
    raise AttestationAPIException(
        code=exc.code,
        message=exc.message,
        details=exc.details,
        status_code=exc.http_status,
    )
