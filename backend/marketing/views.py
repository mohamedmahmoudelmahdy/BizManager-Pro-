"""Lead ViewSet for Marketing CRM Phase 2C.1."""

from __future__ import annotations

from django.db.models import Exists, OuterRef, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import permission_required
from marketing.exceptions import MarketingBusinessError, raise_api_error
from marketing.models import Lead, LeadAssignment
from marketing.serializers import (
    LeadArchiveSerializer,
    LeadCreateSerializer,
    LeadDetailSerializer,
    LeadListSerializer,
    LeadUpdateSerializer,
)
from marketing.serializers_conversion import LeadConvertSerializer
from marketing.services.lead_contact import (
    annotate_last_contact,
    apply_outcome_filter,
    contact_user_ids_from_leads,
    load_users_by_ids,
)
from marketing.services.lead_convert import list_lead_customer_matches
from marketing.services.operations_visibility import visible_leads_for


class LeadViewSet(viewsets.ModelViewSet):
    """
    Core Lead APIs: list, create, retrieve, update, archive, convert.

    DELETE is disabled. CSV import remains out of scope.
    Operations CRM visibility is enforced via ``visible_leads_for``.
    """

    # PATCH only: serializers/services are partial-update. PUT is not full-replace.
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permission_required("marketing.view_lead", allow_admin_manager=True)()]
        if self.action == "create":
            return [permission_required("marketing.add_lead", allow_admin_manager=True)()]
        if self.action in ("partial_update", "archive"):
            return [permission_required("marketing.change_lead", allow_admin_manager=True)()]
        if self.action == "convert":
            return [permission_required("marketing.convert_lead", allow_admin_manager=True)()]
        if self.action == "customer_matches":
            return [permission_required("marketing.view_lead", allow_admin_manager=True)()]
        return [permission_required("marketing.view_lead", allow_admin_manager=True)()]

    def get_queryset(self):
        qs = Lead.objects.select_related(
            "channel",
            "platform",
            "campaign",
            "ad_set",
            "advertisement",
            "marketing_owner",
            "linked_customer",
            "created_by",
            "archived_by",
            "converted_by",
        ).all()
        qs = visible_leads_for(self.request.user, base_qs=qs)
        qs = annotate_last_contact(qs)

        # Detail/mutation actions must resolve archived leads (list filters apply only to list).
        if getattr(self, "action", None) in (
            "retrieve",
            "partial_update",
            "archive",
            "convert",
            "customer_matches",
        ):
            return qs

        params = self.request.query_params

        # Archived excluded by default unless include_archived / status=archived / archived=true.
        include_archived = params.get("include_archived", "").lower() in ("1", "true", "yes")
        archived_only = params.get("archived", "").lower() in ("1", "true", "yes")
        status_filter = params.get("status")

        if archived_only or status_filter == Lead.Status.ARCHIVED:
            qs = qs.filter(status=Lead.Status.ARCHIVED)
        elif not include_archived and status_filter != Lead.Status.ARCHIVED:
            qs = qs.exclude(status=Lead.Status.ARCHIVED)
            if status_filter:
                qs = qs.filter(status=status_filter)
        elif status_filter:
            qs = qs.filter(status=status_filter)

        try:
            qs = apply_outcome_filter(qs, params.get("outcome"))
        except MarketingBusinessError as exc:
            raise_api_error(exc)

        if params.get("channel"):
            qs = qs.filter(channel_id=params["channel"])
        if params.get("platform"):
            qs = qs.filter(platform_id=params["platform"])
        if params.get("campaign"):
            qs = qs.filter(campaign_id=params["campaign"])
        if params.get("ad_set"):
            qs = qs.filter(ad_set_id=params["ad_set"])
        if params.get("advertisement"):
            qs = qs.filter(advertisement_id=params["advertisement"])
        if params.get("owner"):
            qs = qs.filter(marketing_owner_id=params["owner"])
        if params.get("customer"):
            qs = qs.filter(linked_customer_id=params["customer"])
        if params.get("created_after"):
            qs = qs.filter(created_at__date__gte=params["created_after"])
        if params.get("created_before"):
            qs = qs.filter(created_at__date__lte=params["created_before"])

        assignment_state = (params.get("assignment_state") or "").strip().lower()
        if assignment_state in ("unassigned", "assigned"):
            has_active = Exists(
                LeadAssignment.objects.filter(
                    lead_id=OuterRef("pk"),
                    status__in=LeadAssignment.ACTIVE_STATUSES,
                )
            )
            qs = qs.annotate(_has_active_assignment=has_active)
            if assignment_state == "unassigned":
                qs = qs.filter(_has_active_assignment=False)
            else:
                qs = qs.filter(_has_active_assignment=True)

        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(lead_number__icontains=search)
                | Q(name__icontains=search)
                | Q(raw_phone__icontains=search)
                | Q(normalized_phone__icontains=search)
                | Q(email__icontains=search)
                | Q(campaign__name__icontains=search)
                | Q(linked_customer__name__icontains=search)
                | Q(linked_customer__company_name__icontains=search)
            )

        ordering = (params.get("ordering") or "-created_at").strip()
        allowed_ordering = {
            "created_at",
            "-created_at",
            "updated_at",
            "-updated_at",
            "lead_number",
            "-lead_number",
            "status",
            "-status",
        }
        if ordering in allowed_ordering:
            qs = qs.order_by(ordering)
        else:
            qs = qs.order_by("-created_at")

        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return LeadListSerializer
        if self.action == "create":
            return LeadCreateSerializer
        if self.action == "partial_update":
            return LeadUpdateSerializer
        if self.action == "archive":
            return LeadArchiveSerializer
        if self.action == "convert":
            return LeadConvertSerializer
        return LeadDetailSerializer

    def _users_context_for(self, leads) -> dict:
        context = self.get_serializer_context()
        context["users_by_id"] = load_users_by_ids(contact_user_ids_from_leads(leads))
        return context

    def _annotated_lead(self, lead: Lead) -> Lead:
        annotated = self.get_queryset().filter(pk=lead.pk).first()
        return annotated or lead

    def _detail_response(self, lead: Lead, *, status_code: int = status.HTTP_200_OK) -> Response:
        annotated = self._annotated_lead(lead)
        serializer = LeadDetailSerializer(
            annotated,
            context=self._users_context_for([annotated]),
        )
        return Response(serializer.data, status=status_code)

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        leads = page if page is not None else list(queryset)
        serializer = self.get_serializer(leads, many=True, context=self._users_context_for(leads))
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(
            instance,
            context=self._users_context_for([instance]),
        )
        return Response(serializer.data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lead = serializer.save()
        return self._detail_response(lead, status_code=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        lead = serializer.save()
        return self._detail_response(lead)

    def destroy(self, request, *args, **kwargs):
        return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        lead = self.get_object()
        serializer = LeadArchiveSerializer(
            data=request.data,
            context={"request": request, "lead": lead},
        )
        serializer.is_valid(raise_exception=True)
        archived = serializer.save()
        return self._detail_response(archived)

    @action(detail=True, methods=["post"], url_path="convert")
    def convert(self, request, pk=None):
        lead = self.get_object()
        serializer = LeadConvertSerializer(
            data=request.data,
            context={"request": request, "lead": lead},
        )
        serializer.is_valid(raise_exception=True)
        converted = serializer.save()
        return self._detail_response(converted)

    @action(detail=True, methods=["get"], url_path="customer-matches")
    def customer_matches(self, request, pk=None):
        """Read-only phone matches for conversion UX. No mutation."""
        lead = self.get_object()
        try:
            matches = list_lead_customer_matches(actor=request.user, lead=lead)
        except MarketingBusinessError as exc:
            raise_api_error(exc)
        return Response({"matches": matches})
