"""Read-only HR attestation portal API."""

from __future__ import annotations

from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import permission_required
from attestation.exceptions import AttestationBusinessError, raise_api_error
from attestation.models import AttestationAuditEvent
from attestation.serializers_hr import (
    HRApplicationDetailSerializer,
    HRApplicationListSerializer,
)
from attestation.services.audit import record_attestation_audit
from attestation.services.downloads import build_secure_file_response
from attestation.services.hr_portal import (
    build_hr_overview,
    ensure_hr_portal_access,
    filter_hr_applications,
    get_hr_application,
    get_hr_document_for_download,
    hr_applications_queryset,
)


class HRAttestationOverviewView(APIView):
    permission_classes = [
        IsAuthenticated,
        permission_required(
            "attestation.view_hr_attestation_portal",
            "attestation.view_hr_attestationapplication",
            any_of=True,
            allow_admin_manager=False,
        ),
    ]

    def get(self, request):
        try:
            return Response(build_hr_overview(user=request.user))
        except AttestationBusinessError as exc:
            raise_api_error(exc)


class HRAttestationApplicationViewSet(viewsets.ViewSet):
    """Read-only list/detail for HR portal. Mutations return 405."""

    permission_classes = [
        IsAuthenticated,
        permission_required(
            "attestation.view_hr_attestation_portal",
            "attestation.view_hr_attestationapplication",
            any_of=True,
            allow_admin_manager=False,
        ),
    ]
    http_method_names = ["get", "head", "options"]

    def list(self, request):
        try:
            profile = ensure_hr_portal_access(request.user)
            qs = hr_applications_queryset(profile.customer_id)
            qs = filter_hr_applications(
                qs,
                search=request.query_params.get("search"),
                status=request.query_params.get("status"),
                submitted_from=request.query_params.get("submitted_from"),
                submitted_to=request.query_params.get("submitted_to"),
            )
            ordering = request.query_params.get("ordering") or "-submitted_at"
            allowed = {
                "submitted_at",
                "-submitted_at",
                "full_name",
                "-full_name",
                "status",
                "-status",
                "reference_number",
                "-reference_number",
                "updated_at",
                "-updated_at",
            }
            if ordering in allowed:
                qs = qs.order_by(ordering)
            page = self.paginate_queryset(qs)
            if page is not None:
                ser = HRApplicationListSerializer(page, many=True)
                return self.get_paginated_response(ser.data)
            return Response(HRApplicationListSerializer(qs, many=True).data)
        except AttestationBusinessError as exc:
            raise_api_error(exc)

    def retrieve(self, request, pk=None):
        try:
            application = get_hr_application(user=request.user, application_id=pk)
            return Response(HRApplicationDetailSerializer(application).data)
        except AttestationBusinessError as exc:
            raise_api_error(exc)

    @property
    def paginator(self):
        if not hasattr(self, "_paginator"):
            from rest_framework.pagination import PageNumberPagination

            self._paginator = PageNumberPagination()
        return self._paginator

    def paginate_queryset(self, queryset):
        return self.paginator.paginate_queryset(queryset, self.request, view=self)

    def get_paginated_response(self, data):
        return self.paginator.get_paginated_response(data)


class HRAttestationDocumentDownloadView(APIView):
    permission_classes = [
        IsAuthenticated,
        permission_required(
            "attestation.download_hr_attestationdocument",
            allow_admin_manager=False,
        ),
    ]

    def get(self, request, document_id):
        try:
            document = get_hr_document_for_download(
                user=request.user, document_id=document_id
            )
        except AttestationBusinessError as exc:
            raise_api_error(exc)

        record_attestation_audit(
            event_type=AttestationAuditEvent.EventType.DOCUMENT_DOWNLOADED_HR,
            actor_type=AttestationAuditEvent.ActorType.HR,
            actor_user=request.user,
            application=document.application,
            batch=document.application.batch,
            metadata={
                "document_id": str(document.pk),
                "document_type": document.document_type,
            },
        )
        return build_secure_file_response(
            file_field=document.file,
            original_filename=document.original_filename,
            content_type=document.content_type,
        )
