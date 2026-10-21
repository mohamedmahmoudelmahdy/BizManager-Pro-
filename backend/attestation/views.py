"""Public and internal attestation API views."""

from __future__ import annotations

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import permission_required
from attestation.exceptions import AttestationBusinessError, raise_api_error
from attestation.models import AttestationAuditEvent
from attestation.serializers import (
    InternalApplicationDetailSerializer,
    InternalApplicationListSerializer,
    InternalApplicationNotesUpdateSerializer,
    PublicSubmissionResponseSerializer,
)
from attestation.services.audit import record_attestation_audit
from attestation.services.downloads import build_secure_file_response
from attestation.services.submit import submit_public_application
from attestation.services.workflow import (
    applications_queryset,
    complete_application,
    ensure_attestation_perm,
    filter_applications,
    get_application_for_staff,
    get_document_for_download,
    save_dataflow_details,
    save_mohesr_details,
    set_dataflow_in_progress,
    set_mohesr_in_progress,
    update_internal_notes,
)
from attestation.throttles import AttestationPublicSubmitThrottle


def _detail_response(request, application):
    return Response(
        InternalApplicationDetailSerializer(
            application, context={"request": request}
        ).data
    )


class PublicAttestationSubmitView(APIView):
    """
    Unauthenticated submission-only endpoint.

    POST /api/public/attestation/<public_slug>/applications/
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]
    throttle_classes = [AttestationPublicSubmitThrottle]

    def post(self, request, public_slug: str):
        try:
            payload = submit_public_application(
                public_slug=public_slug,
                data=request.data,
                files=request.FILES,
                idempotency_key=request.headers.get("Idempotency-Key"),
            )
        except AttestationBusinessError as exc:
            raise_api_error(exc)
        return Response(
            PublicSubmissionResponseSerializer(payload).data,
            status=status.HTTP_201_CREATED,
        )

    def get(self, request, *args, **kwargs):
        return Response(
            {
                "error": {
                    "code": "operation_not_permitted",
                    "message": "operation_not_permitted",
                    "details": {"reason": "public_read_disabled"},
                }
            },
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )


class AttestationApplicationViewSet(viewsets.ViewSet):
    """Authenticated internal list/detail/workflow endpoints."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def list(self, request):
        try:
            ensure_attestation_perm(
                request.user,
                "view_attestationapplication",
                "process_attestationapplication",
                any_of=True,
            )
            qs = filter_applications(
                applications_queryset(),
                search=request.query_params.get("search"),
                status=request.query_params.get("status"),
                batch_id=request.query_params.get("batch"),
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
            }
            if ordering in allowed:
                qs = qs.order_by(ordering)
            page = self.paginate_queryset(qs)
            if page is not None:
                ser = InternalApplicationListSerializer(page, many=True)
                return self.get_paginated_response(ser.data)
            return Response(InternalApplicationListSerializer(qs, many=True).data)
        except AttestationBusinessError as exc:
            raise_api_error(exc)

    def retrieve(self, request, pk=None):
        try:
            application = get_application_for_staff(
                actor=request.user, application_id=pk
            )
            return _detail_response(request, application)
        except AttestationBusinessError as exc:
            raise_api_error(exc)

    def partial_update(self, request, pk=None):
        """Update internal notes only (status changes use dedicated actions)."""
        try:
            ser = InternalApplicationNotesUpdateSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            application = update_internal_notes(
                actor=request.user,
                application_id=pk,
                notes=ser.validated_data["internal_notes"],
            )
            return _detail_response(request, application)
        except AttestationBusinessError as exc:
            raise_api_error(exc)

    @action(detail=True, methods=["post"], url_path="save-dataflow")
    def save_dataflow(self, request, pk=None):
        try:
            application = save_dataflow_details(
                actor=request.user,
                application_id=pk,
                reference=request.data.get("dataflow_reference"),
                submitted_at=request.data.get("dataflow_submitted_at"),
                payment_proof=request.FILES.get("dataflow_payment_proof"),
                result_file=request.FILES.get("dataflow_result"),
            )
            return _detail_response(request, application)
        except AttestationBusinessError as exc:
            raise_api_error(exc)

    @action(detail=True, methods=["post"], url_path="set-dataflow")
    def set_dataflow(self, request, pk=None):
        try:
            # Allow saving details in the same call before transitioning.
            if any(
                k in request.data or k in request.FILES
                for k in (
                    "dataflow_reference",
                    "dataflow_submitted_at",
                    "dataflow_payment_proof",
                    "dataflow_result",
                )
            ):
                save_dataflow_details(
                    actor=request.user,
                    application_id=pk,
                    reference=request.data.get("dataflow_reference"),
                    submitted_at=request.data.get("dataflow_submitted_at"),
                    payment_proof=request.FILES.get("dataflow_payment_proof"),
                    result_file=request.FILES.get("dataflow_result"),
                )
            application = set_dataflow_in_progress(
                actor=request.user, application_id=pk
            )
            return _detail_response(request, application)
        except AttestationBusinessError as exc:
            raise_api_error(exc)

    @action(detail=True, methods=["post"], url_path="save-mohesr")
    def save_mohesr(self, request, pk=None):
        try:
            application = save_mohesr_details(
                actor=request.user,
                application_id=pk,
                reference=request.data.get("mohesr_reference"),
                submitted_at=request.data.get("mohesr_submitted_at"),
                payment_proof=request.FILES.get("mohesr_payment_proof"),
            )
            return _detail_response(request, application)
        except AttestationBusinessError as exc:
            raise_api_error(exc)

    @action(detail=True, methods=["post"], url_path="set-mohesr")
    def set_mohesr(self, request, pk=None):
        try:
            if any(
                k in request.data or k in request.FILES
                for k in (
                    "mohesr_reference",
                    "mohesr_submitted_at",
                    "mohesr_payment_proof",
                )
            ):
                save_mohesr_details(
                    actor=request.user,
                    application_id=pk,
                    reference=request.data.get("mohesr_reference"),
                    submitted_at=request.data.get("mohesr_submitted_at"),
                    payment_proof=request.FILES.get("mohesr_payment_proof"),
                )
            application = set_mohesr_in_progress(
                actor=request.user, application_id=pk
            )
            return _detail_response(request, application)
        except AttestationBusinessError as exc:
            raise_api_error(exc)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        try:
            application = complete_application(
                actor=request.user,
                application_id=pk,
                equivalency_file=request.FILES.get("final_equivalency"),
            )
            return _detail_response(request, application)
        except AttestationBusinessError as exc:
            raise_api_error(exc)

    # Pagination helpers for ViewSet without GenericViewSet
    @property
    def paginator(self):
        if not hasattr(self, "_paginator"):
            from rest_framework.pagination import PageNumberPagination

            self._paginator = PageNumberPagination()
        return self._paginator

    def paginate_queryset(self, queryset):
        if self.paginator is None:
            return None
        return self.paginator.paginate_queryset(queryset, self.request, view=self)

    def get_paginated_response(self, data):
        return self.paginator.get_paginated_response(data)


class AttestationDocumentDownloadView(APIView):
    permission_classes = [
        IsAuthenticated,
        permission_required(
            "attestation.view_attestationapplication",
            "attestation.process_attestationapplication",
            any_of=True,
            allow_admin_manager=True,
        ),
    ]

    def get(self, request, document_id):
        try:
            document = get_document_for_download(
                actor=request.user, document_id=document_id
            )
        except AttestationBusinessError as exc:
            raise_api_error(exc)

        record_attestation_audit(
            event_type=AttestationAuditEvent.EventType.DOCUMENT_DOWNLOADED_INTERNAL,
            actor_type=AttestationAuditEvent.ActorType.INTERNAL,
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
