"""ViewSets for activities, follow-ups, and assignments (Phase 2C.3)."""

from __future__ import annotations

from django.db.models import Exists, OuterRef, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import permission_required
from marketing.exceptions import AssignmentNotFoundError, MarketingBusinessError, raise_api_error
from marketing.models import LeadActivity, LeadAssignment, LeadFollowUp
from marketing import serializers_operations as ser
from marketing.services.assignments import (
    accept_assignment,
    cancel_assignment,
    complete_assignment,
    reject_assignment,
)
from marketing.services.operations_visibility import visible_leads_for


class _NoPutDeleteMixin:
    http_method_names = ["get", "post", "patch", "head", "options"]

    def destroy(self, request, *args, **kwargs):
        return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)


class LeadActivityViewSet(_NoPutDeleteMixin, viewsets.ModelViewSet):
    """Append-only activities: list, retrieve, create. No update/delete."""

    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [
                permission_required(
                    "marketing.view_leadactivity",
                    "marketing.manage_lead_activity",
                    any_of=True,
                    allow_admin_manager=True,
                )()
            ]
        if self.action == "create":
            return [
                permission_required(
                    "marketing.add_leadactivity",
                    "marketing.manage_lead_activity",
                    any_of=True,
                    allow_admin_manager=True,
                )()
            ]
        return [permission_required("marketing.view_leadactivity", allow_admin_manager=True)()]

    def get_queryset(self):
        visible_lead_ids = visible_leads_for(self.request.user).values("pk")
        qs = LeadActivity.objects.filter(lead_id__in=visible_lead_ids).select_related(
            "lead", "created_by"
        )
        params = self.request.query_params
        if params.get("lead"):
            qs = qs.filter(lead_id=params["lead"])
        if params.get("activity_type"):
            qs = qs.filter(activity_type=params["activity_type"])
        if params.get("actor"):
            qs = qs.filter(created_by_id=params["actor"])
        if params.get("occurred_after"):
            qs = qs.filter(occurred_at__date__gte=params["occurred_after"])
        if params.get("occurred_before"):
            qs = qs.filter(occurred_at__date__lte=params["occurred_before"])
        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(Q(subject__icontains=search) | Q(notes__icontains=search))
        ordering = (params.get("ordering") or "-occurred_at").strip()
        allowed = {"occurred_at", "-occurred_at", "created_at", "-created_at"}
        return qs.order_by(ordering if ordering in allowed else "-occurred_at")

    def get_serializer_class(self):
        if self.action == "create":
            return ser.LeadActivityCreateSerializer
        return ser.LeadActivityListSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.LeadActivityDetailSerializer(obj).data, status=status.HTTP_201_CREATED)


class LeadFollowUpViewSet(_NoPutDeleteMixin, viewsets.ModelViewSet):
    """Follow-ups: list, retrieve, create, PATCH update, complete action."""

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [
                permission_required(
                    "marketing.view_leadfollowup",
                    "marketing.manage_lead_activity",
                    any_of=True,
                    allow_admin_manager=True,
                )()
            ]
        if self.action == "create":
            return [
                permission_required(
                    "marketing.add_leadfollowup",
                    "marketing.manage_lead_activity",
                    any_of=True,
                    allow_admin_manager=True,
                )()
            ]
        if self.action in ("partial_update", "complete"):
            return [
                permission_required(
                    "marketing.change_leadfollowup",
                    "marketing.manage_lead_activity",
                    any_of=True,
                    allow_admin_manager=True,
                )()
            ]
        return [permission_required("marketing.view_leadfollowup", allow_admin_manager=True)()]

    def get_queryset(self):
        visible_lead_ids = visible_leads_for(self.request.user).values("pk")
        qs = LeadFollowUp.objects.filter(lead_id__in=visible_lead_ids).select_related(
            "lead", "assigned_to", "created_by", "completed_by"
        )
        params = self.request.query_params
        if params.get("lead"):
            qs = qs.filter(lead_id=params["lead"])
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        if params.get("assigned_to"):
            qs = qs.filter(assigned_to_id=params["assigned_to"])
        # Prefer scheduled_from/to (Phase 3.4E); keep due_after/before as aliases.
        scheduled_to = params.get("scheduled_to") or params.get("due_before")
        scheduled_from = params.get("scheduled_from") or params.get("due_after")
        if scheduled_to:
            qs = qs.filter(scheduled_for__date__lte=scheduled_to)
        if scheduled_from:
            qs = qs.filter(scheduled_for__date__gte=scheduled_from)
        if params.get("completed", "").lower() in ("1", "true", "yes"):
            qs = qs.filter(status=LeadFollowUp.Status.COMPLETED)
        if params.get("overdue", "").lower() in ("1", "true", "yes"):
            qs = qs.filter(
                status=LeadFollowUp.Status.PENDING,
                scheduled_for__lt=timezone.now(),
            )
        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(notes__icontains=search)
                | Q(lead__lead_number__icontains=search)
                | Q(lead__name__icontains=search)
                | Q(lead__raw_phone__icontains=search)
                | Q(lead__normalized_phone__icontains=search)
            )
        ordering = (params.get("ordering") or "scheduled_for").strip()
        allowed = {
            "scheduled_for",
            "-scheduled_for",
            "created_at",
            "-created_at",
            "updated_at",
            "-updated_at",
        }
        return qs.order_by(ordering if ordering in allowed else "scheduled_for")

    def get_serializer_class(self):
        if self.action == "create":
            return ser.LeadFollowUpCreateSerializer
        if self.action == "partial_update":
            return ser.LeadFollowUpUpdateSerializer
        if self.action == "complete":
            return ser.LeadFollowUpCompleteSerializer
        return ser.LeadFollowUpListSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.LeadFollowUpDetailSerializer(obj).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.LeadFollowUpDetailSerializer(obj).data)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        followup = self.get_object()
        serializer = ser.LeadFollowUpCompleteSerializer(
            data=request.data,
            context={"request": request, "followup": followup},
        )
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.LeadFollowUpDetailSerializer(obj).data)


class LeadAssignmentViewSet(_NoPutDeleteMixin, viewsets.ModelViewSet):
    """
    Assignment history: list/retrieve + transition actions.
    No generic PATCH/PUT/DELETE. History is append-only.
    """

    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permission_required("marketing.view_leadassignment", allow_admin_manager=True)()]
        if self.action in ("assign", "reassign", "cancel", "create"):
            return [permission_required("marketing.assign_lead", allow_admin_manager=True)()]
        if self.action in ("accept", "reject", "complete"):
            return [
                permission_required(
                    "marketing.change_leadassignment",
                    "marketing.assign_lead",
                    any_of=True,
                    allow_admin_manager=True,
                )()
            ]
        return [permission_required("marketing.view_leadassignment", allow_admin_manager=True)()]

    def get_queryset(self):
        qs = LeadAssignment.objects.select_related(
            "lead", "operations_employee", "assigned_by"
        ).all()
        # Transition actions resolve the row first; ownership is enforced in services.
        if self.action not in ("accept", "reject", "complete", "cancel"):
            visible_lead_ids = visible_leads_for(self.request.user).values("pk")
            qs = qs.filter(lead_id__in=visible_lead_ids)

        params = self.request.query_params
        if self.action in ("list",):
            if params.get("lead"):
                qs = qs.filter(lead_id=params["lead"])
            if params.get("status"):
                qs = qs.filter(status=params["status"])
            # Prefer assigned_to (Phase 3.4E); keep assigned_user as alias.
            assignee = params.get("assigned_to") or params.get("assigned_user")
            if assignee:
                qs = qs.filter(operations_employee_id=assignee)
            if params.get("active", "").lower() in ("1", "true", "yes"):
                qs = qs.filter(status__in=LeadAssignment.ACTIVE_STATUSES)
            if params.get("created_after"):
                qs = qs.filter(assigned_at__date__gte=params["created_after"])
            if params.get("created_before"):
                qs = qs.filter(assigned_at__date__lte=params["created_before"])
            search = (params.get("search") or "").strip()
            if search:
                qs = qs.filter(
                    Q(notes__icontains=search)
                    | Q(lead__lead_number__icontains=search)
                    | Q(lead__name__icontains=search)
                    | Q(lead__raw_phone__icontains=search)
                    | Q(lead__normalized_phone__icontains=search)
                )
            ordering = (params.get("ordering") or "-assigned_at").strip()
            allowed = {"assigned_at", "-assigned_at", "status", "-status"}
            return qs.order_by(ordering if ordering in allowed else "-assigned_at")
        return qs

    def get_serializer_class(self):
        if self.action in ("assign", "create"):
            return ser.LeadAssignmentAssignSerializer
        if self.action == "reassign":
            return ser.LeadAssignmentReassignSerializer
        return ser.LeadAssignmentListSerializer

    def create(self, request, *args, **kwargs):
        return self.assign(request)

    @action(detail=False, methods=["post"], url_path="assign")
    def assign(self, request):
        serializer = ser.LeadAssignmentAssignSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.LeadAssignmentDetailSerializer(obj).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="reassign")
    def reassign(self, request):
        serializer = ser.LeadAssignmentReassignSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.LeadAssignmentDetailSerializer(obj).data, status=status.HTTP_201_CREATED)

    def _transition(self, request, fn, *, with_notes: bool = False):
        assignment = self.get_object()
        serializer = ser.LeadAssignmentTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            kwargs = {"actor": request.user, "assignment_id": assignment.pk}
            if with_notes:
                kwargs["notes"] = serializer.validated_data.get("notes", "")
            obj = fn(**kwargs)
        except MarketingBusinessError as exc:
            raise_api_error(exc)
        except LeadAssignment.DoesNotExist:
            raise_api_error(AssignmentNotFoundError())
        return Response(ser.LeadAssignmentDetailSerializer(obj).data)

    @action(detail=True, methods=["post"], url_path="accept")
    def accept(self, request, pk=None):
        return self._transition(request, accept_assignment)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, pk=None):
        return self._transition(request, reject_assignment, with_notes=True)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        return self._transition(request, complete_assignment, with_notes=True)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        return self._transition(request, cancel_assignment, with_notes=True)
