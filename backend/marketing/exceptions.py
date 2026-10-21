"""Structured Marketing CRM business exceptions and DRF mapping."""

from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.exceptions import APIException


class MarketingBusinessError(Exception):
    """Language-neutral business error. ``code`` is the API contract."""

    code: str = "marketing_error"
    http_status: int = status.HTTP_400_BAD_REQUEST

    def __init__(self, *, details: dict[str, Any] | None = None, message: str | None = None, http_status: int | None = None):
        self.details = details or {}
        # Message mirrors code so clients never rely on English prose.
        self.message = message or self.code
        if http_status is not None:
            self.http_status = http_status
        super().__init__(self.message)


class InvalidPhoneError(MarketingBusinessError):
    code = "invalid_phone"
    http_status = status.HTTP_400_BAD_REQUEST


class DuplicateLeadPhoneError(MarketingBusinessError):
    code = "duplicate_lead_phone"
    http_status = status.HTTP_409_CONFLICT


class MatchingCustomerFoundError(MarketingBusinessError):
    code = "matching_customer_found"
    http_status = status.HTTP_409_CONFLICT


class InvalidCustomerLinkError(MarketingBusinessError):
    code = "invalid_customer_link"
    http_status = status.HTTP_400_BAD_REQUEST


class InvalidCampaignHierarchyError(MarketingBusinessError):
    code = "invalid_campaign_hierarchy"
    http_status = status.HTTP_400_BAD_REQUEST


class LeadAlreadyArchivedError(MarketingBusinessError):
    code = "lead_already_archived"
    http_status = status.HTTP_409_CONFLICT


class ArchiveReasonRequiredError(MarketingBusinessError):
    code = "archive_reason_required"
    http_status = status.HTTP_400_BAD_REQUEST


class ImmutableFieldError(MarketingBusinessError):
    code = "immutable_field"
    http_status = status.HTTP_400_BAD_REQUEST


class MarketingPermissionDeniedError(MarketingBusinessError):
    code = "permission_denied"
    http_status = status.HTTP_403_FORBIDDEN


class InvalidOutcomeError(MarketingBusinessError):
    code = "invalid_outcome"
    http_status = status.HTTP_400_BAD_REQUEST


# --- Phase 2C.2: campaign hierarchy ---


class DuplicateChannelError(MarketingBusinessError):
    code = "duplicate_channel"
    http_status = status.HTTP_409_CONFLICT


class DuplicatePlatformError(MarketingBusinessError):
    code = "duplicate_platform"
    http_status = status.HTTP_409_CONFLICT


class DuplicateCampaignError(MarketingBusinessError):
    code = "duplicate_campaign"
    http_status = status.HTTP_409_CONFLICT


class DuplicateAdSetError(MarketingBusinessError):
    code = "duplicate_adset"
    http_status = status.HTTP_409_CONFLICT


class DuplicateAdvertisementError(MarketingBusinessError):
    code = "duplicate_advertisement"
    http_status = status.HTTP_409_CONFLICT


class InvalidPlatformChannelError(MarketingBusinessError):
    code = "invalid_platform_channel"
    http_status = status.HTTP_400_BAD_REQUEST


class InvalidCampaignPlatformError(MarketingBusinessError):
    code = "invalid_campaign_platform"
    http_status = status.HTTP_400_BAD_REQUEST


class InvalidAdSetCampaignError(MarketingBusinessError):
    code = "invalid_adset_campaign"
    http_status = status.HTTP_400_BAD_REQUEST


class InvalidAdvertisementHierarchyError(MarketingBusinessError):
    code = "invalid_advertisement_hierarchy"
    http_status = status.HTTP_400_BAD_REQUEST


class CampaignDatesInvalidError(MarketingBusinessError):
    code = "campaign_dates_invalid"
    http_status = status.HTTP_400_BAD_REQUEST


class CampaignBudgetInvalidError(MarketingBusinessError):
    code = "campaign_budget_invalid"
    http_status = status.HTTP_400_BAD_REQUEST


class CampaignHasChildrenError(MarketingBusinessError):
    code = "campaign_has_children"
    http_status = status.HTTP_409_CONFLICT


class EntityHasChildrenError(MarketingBusinessError):
    code = "entity_has_children"
    http_status = status.HTTP_409_CONFLICT


class EntityAlreadyArchivedError(MarketingBusinessError):
    code = "entity_already_archived"
    http_status = status.HTTP_409_CONFLICT


# --- Phase 2C.3: activities, follow-ups, assignments ---


class AssignmentNotFoundError(MarketingBusinessError):
    code = "assignment_not_found"
    http_status = status.HTTP_404_NOT_FOUND


class DuplicateActiveAssignmentError(MarketingBusinessError):
    code = "duplicate_active_assignment"
    http_status = status.HTTP_409_CONFLICT


class InvalidAssignmentTransitionError(MarketingBusinessError):
    code = "invalid_assignment_transition"
    http_status = status.HTTP_400_BAD_REQUEST


class AssignmentNotOwnedError(MarketingBusinessError):
    code = "assignment_not_owned"
    http_status = status.HTTP_403_FORBIDDEN


class AssignmentAlreadyCompletedError(MarketingBusinessError):
    code = "assignment_already_completed"
    http_status = status.HTTP_409_CONFLICT


class FollowUpCompletedError(MarketingBusinessError):
    code = "followup_completed"
    http_status = status.HTTP_409_CONFLICT


class FollowUpInvalidDateError(MarketingBusinessError):
    code = "followup_invalid_date"
    http_status = status.HTTP_400_BAD_REQUEST


class ActivityInvalidError(MarketingBusinessError):
    code = "activity_invalid"
    http_status = status.HTTP_400_BAD_REQUEST


class OperationNotPermittedError(MarketingBusinessError):
    code = "operation_not_permitted"
    http_status = status.HTTP_403_FORBIDDEN


# --- Phase 2C.4: lead conversion ---


class InvalidConversionModeError(MarketingBusinessError):
    code = "invalid_conversion_mode"
    http_status = status.HTTP_400_BAD_REQUEST


class LeadAlreadyConvertedError(MarketingBusinessError):
    code = "lead_already_converted"
    http_status = status.HTTP_409_CONFLICT


class LeadNotConvertibleError(MarketingBusinessError):
    code = "lead_not_convertible"
    http_status = status.HTTP_400_BAD_REQUEST


class CustomerMatchNotFoundError(MarketingBusinessError):
    code = "customer_match_not_found"
    http_status = status.HTTP_404_NOT_FOUND


class CustomerCreationFailedError(MarketingBusinessError):
    code = "customer_creation_failed"
    http_status = status.HTTP_400_BAD_REQUEST


class ConversionFailedError(MarketingBusinessError):
    code = "conversion_failed"
    http_status = status.HTTP_400_BAD_REQUEST


# --- Phase 3.3A: reporting ---


class InvalidReportDateRangeError(MarketingBusinessError):
    code = "invalid_report_date_range"
    http_status = status.HTTP_400_BAD_REQUEST


class InvalidReportingIntervalError(MarketingBusinessError):
    code = "invalid_reporting_interval"
    http_status = status.HTTP_400_BAD_REQUEST


class InvalidReportFilterError(MarketingBusinessError):
    code = "invalid_report_filter"
    http_status = status.HTTP_400_BAD_REQUEST


class InvalidReportHierarchyError(MarketingBusinessError):
    code = "invalid_report_hierarchy"
    http_status = status.HTTP_400_BAD_REQUEST


class ReportDateRangeTooLargeError(MarketingBusinessError):
    code = "report_date_range_too_large"
    http_status = status.HTTP_400_BAD_REQUEST


class ReportPermissionDeniedError(MarketingBusinessError):
    code = "report_permission_denied"
    http_status = status.HTTP_403_FORBIDDEN


class ReportingUnavailableError(MarketingBusinessError):
    code = "reporting_unavailable"
    http_status = status.HTTP_503_SERVICE_UNAVAILABLE


# --- Phase 4.1: revenue attribution ---


class InvalidRevenueDateRangeError(MarketingBusinessError):
    code = "invalid_revenue_date_range"
    http_status = status.HTTP_400_BAD_REQUEST


class InvalidRevenueFilterError(MarketingBusinessError):
    code = "invalid_revenue_filter"
    http_status = status.HTTP_400_BAD_REQUEST


class InvalidRevenueHierarchyError(MarketingBusinessError):
    code = "invalid_revenue_hierarchy"
    http_status = status.HTTP_400_BAD_REQUEST


class CustomerAlreadyAttributedError(MarketingBusinessError):
    code = "customer_already_attributed"
    http_status = status.HTTP_409_CONFLICT


class FinancialDataUnavailableError(MarketingBusinessError):
    code = "financial_data_unavailable"
    http_status = status.HTTP_503_SERVICE_UNAVAILABLE


class FinancialAttributionUnavailableError(MarketingBusinessError):
    code = "financial_attribution_unavailable"
    http_status = status.HTTP_503_SERVICE_UNAVAILABLE


class RevenuePermissionDeniedError(MarketingBusinessError):
    code = "revenue_permission_denied"
    http_status = status.HTTP_403_FORBIDDEN


class MarketingAPIException(APIException):
    """DRF exception carrying the stable Marketing CRM error envelope."""

    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "marketing_error"
    default_code = "marketing_error"

    def __init__(self, *, code: str, message: str, details: dict[str, Any] | None = None, status_code: int | None = None):
        self.status_code = status_code or self.status_code
        self.detail = {
            "error": {
                "code": code,
                "message": message,
                "details": details or {},
            }
        }


def raise_api_error(exc: MarketingBusinessError) -> None:
    """Raise a DRF exception from a typed business error."""
    raise MarketingAPIException(
        code=exc.code,
        message=exc.message,
        details=exc.details,
        status_code=exc.http_status,
    )
