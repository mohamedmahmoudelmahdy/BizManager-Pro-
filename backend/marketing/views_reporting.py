"""Read-only Marketing CRM reporting API views (Phase 3.3A)."""

from __future__ import annotations

from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import permission_required
from marketing.exceptions import MarketingBusinessError, raise_api_error
from marketing.serializers_reporting import (
    AssignmentWorkloadResponseSerializer,
    CampaignPerformanceResponseSerializer,
    FollowupWorkloadResponseSerializer,
    LeadTrendsResponseSerializer,
    OverviewResponseSerializer,
)
from marketing.services.reporting import (
    build_assignment_workload_report,
    build_campaign_performance_report,
    build_followup_workload_report,
    build_lead_trends_report,
    build_overview_report,
)


class _ReportAPIView(APIView):
    """GET-only reporting base. Mutations return 405 via http_method_names."""

    http_method_names = ["get", "head", "options"]

    def _run(self, builder, request, serializer_class):
        try:
            payload = builder(request.user, request.query_params.dict())
        except MarketingBusinessError as exc:
            raise_api_error(exc)
        out = serializer_class(data=payload)
        out.is_valid(raise_exception=True)
        return Response(out.data)


class OverviewReportView(_ReportAPIView):
    permission_classes = [
        permission_required(
            "marketing.view_marketing_dashboard",
            "marketing.view_marketing_report",
            any_of=True,
            allow_admin_manager=True,
        )
    ]

    def get(self, request):
        return self._run(build_overview_report, request, OverviewResponseSerializer)


class LeadTrendsReportView(_ReportAPIView):
    permission_classes = [
        permission_required("marketing.view_marketing_report", allow_admin_manager=True)
    ]

    def get(self, request):
        return self._run(build_lead_trends_report, request, LeadTrendsResponseSerializer)


class CampaignPerformanceReportView(_ReportAPIView):
    permission_classes = [
        permission_required("marketing.view_marketing_report", allow_admin_manager=True)
    ]

    def get(self, request):
        return self._run(
            build_campaign_performance_report, request, CampaignPerformanceResponseSerializer
        )


class FollowupWorkloadReportView(_ReportAPIView):
    permission_classes = [
        permission_required("marketing.view_marketing_report", allow_admin_manager=True)
    ]

    def get(self, request):
        return self._run(
            build_followup_workload_report, request, FollowupWorkloadResponseSerializer
        )


class AssignmentWorkloadReportView(_ReportAPIView):
    permission_classes = [
        permission_required("marketing.view_marketing_report", allow_admin_manager=True)
    ]

    def get(self, request):
        return self._run(
            build_assignment_workload_report, request, AssignmentWorkloadResponseSerializer
        )
