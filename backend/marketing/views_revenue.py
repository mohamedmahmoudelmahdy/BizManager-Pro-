"""Read-only Marketing Revenue Attribution API views (Phase 4.1)."""

from __future__ import annotations

from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import permission_required
from marketing.exceptions import MarketingBusinessError, raise_api_error
from marketing.serializers_revenue import (
    PaginatedRevenueSerializer,
    RevenueOverviewResponseSerializer,
)
from marketing.services.revenue_attribution import (
    build_campaigns_revenue,
    build_channels_revenue,
    build_customers_revenue,
    build_leads_revenue,
    build_overview_revenue,
    build_platforms_revenue,
    build_procedure_types_revenue,
)


class _RevenueAPIView(APIView):
    """GET-only. Mutations return 405 via http_method_names."""

    http_method_names = ["get", "head", "options"]

    def _run(self, builder, request, serializer_class):
        try:
            payload = builder(request.user, request.query_params.dict())
        except MarketingBusinessError as exc:
            raise_api_error(exc)
        out = serializer_class(data=payload)
        out.is_valid(raise_exception=True)
        return Response(out.data)


class RevenueOverviewView(_RevenueAPIView):
    permission_classes = [
        permission_required(
            "marketing.view_marketing_dashboard",
            "marketing.view_marketing_report",
            any_of=True,
            allow_admin_manager=True,
        )
    ]

    def get(self, request):
        return self._run(build_overview_revenue, request, RevenueOverviewResponseSerializer)


class RevenueChannelsView(_RevenueAPIView):
    permission_classes = [
        permission_required("marketing.view_marketing_report", allow_admin_manager=True)
    ]

    def get(self, request):
        return self._run(build_channels_revenue, request, PaginatedRevenueSerializer)


class RevenuePlatformsView(_RevenueAPIView):
    permission_classes = [
        permission_required("marketing.view_marketing_report", allow_admin_manager=True)
    ]

    def get(self, request):
        return self._run(build_platforms_revenue, request, PaginatedRevenueSerializer)


class RevenueCampaignsView(_RevenueAPIView):
    permission_classes = [
        permission_required("marketing.view_marketing_report", allow_admin_manager=True)
    ]

    def get(self, request):
        return self._run(build_campaigns_revenue, request, PaginatedRevenueSerializer)


class RevenueLeadsView(_RevenueAPIView):
    permission_classes = [
        permission_required("marketing.view_marketing_report", allow_admin_manager=True)
    ]

    def get(self, request):
        return self._run(build_leads_revenue, request, PaginatedRevenueSerializer)


class RevenueCustomersView(_RevenueAPIView):
    permission_classes = [
        permission_required("marketing.view_marketing_report", allow_admin_manager=True)
    ]

    def get(self, request):
        return self._run(build_customers_revenue, request, PaginatedRevenueSerializer)


class RevenueProcedureTypesView(_RevenueAPIView):
    permission_classes = [
        permission_required("marketing.view_marketing_report", allow_admin_manager=True)
    ]

    def get(self, request):
        return self._run(build_procedure_types_revenue, request, PaginatedRevenueSerializer)
