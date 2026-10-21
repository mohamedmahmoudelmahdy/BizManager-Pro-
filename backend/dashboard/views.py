from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdminManagerEmployeeCashier, IsAdminOrManager
from dashboard.cache import get_cached_dashboard_summary, set_cached_dashboard_summary
from dashboard.services.alert_resolve import resolve_dashboard_alert
from dashboard.services.collected_profitability import build_collected_profitability
from dashboard.services.summary import build_dashboard_summary


class DashboardAlertResolveView(APIView):
    permission_classes = [IsAdminManagerEmployeeCashier]

    def post(self, request):
        try:
            result = resolve_dashboard_alert(user=request.user, payload=request.data)
        except PermissionDenied as exc:
            detail = exc.detail if hasattr(exc, "detail") else str(exc)
            return Response({"detail": detail}, status=403)
        except ValidationError as exc:
            return Response(exc.detail, status=400)
        return Response(result)


class DashboardSummaryView(APIView):
    """Admin/manager management KPIs for the main dashboard.

    Soft-cached (short TTL) for read acceleration only — not authoritative.
    """

    permission_classes = [IsAdminOrManager]

    def get(self, request):
        period = request.query_params.get("period") or None
        actor_id = request.user.pk
        cached = get_cached_dashboard_summary(actor_id=actor_id, period=period)
        if cached is not None:
            response = Response(cached)
            response["X-Cache"] = "HIT"
            return response
        payload = build_dashboard_summary(actor=request.user, period=period)
        set_cached_dashboard_summary(actor_id=actor_id, period=period, payload=payload)
        response = Response(payload)
        response["X-Cache"] = "MISS"
        return response


class CollectedProfitabilityReportView(APIView):
    """Reports & Analytics — hybrid procedure profitability + customer collections."""

    permission_classes = [IsAdminOrManager]

    def get(self, request):
        period = request.query_params.get("month") or request.query_params.get("period") or None
        try:
            payload = build_collected_profitability(period=period)
        except (ValueError, TypeError, IndexError) as exc:
            raise ValidationError({"month": "Invalid month. Use YYYY-MM."}) from exc
        return Response(payload)
