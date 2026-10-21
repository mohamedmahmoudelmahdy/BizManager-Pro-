"""Serializers for activities, follow-ups, and assignments (Phase 2C.3)."""

from __future__ import annotations

from rest_framework import serializers

from marketing.exceptions import MarketingBusinessError, raise_api_error
from marketing.models import LeadActivity, LeadAssignment, LeadFollowUp
from marketing.services.activities import create_activity
from marketing.services.assignments import (
    accept_assignment,
    assign_lead,
    cancel_assignment,
    complete_assignment,
    reassign_lead,
    reject_assignment,
)
from marketing.services.followups import complete_followup, create_followup, update_followup


def _user_summary(user) -> dict | None:
    if user is None:
        return None
    return {
        "id": user.pk,
        "username": user.username,
        "first_name": user.first_name or "",
        "last_name": user.last_name or "",
    }


def _lead_summary(lead) -> dict | None:
    if lead is None:
        return None
    return {
        "id": lead.pk,
        "lead_number": lead.lead_number,
        "name": lead.name,
        "status": lead.status,
        "raw_phone": getattr(lead, "raw_phone", "") or "",
    }


# ----- Activities -----


class LeadActivityListSerializer(serializers.ModelSerializer):
    lead = serializers.SerializerMethodField()
    created_by = serializers.SerializerMethodField()

    class Meta:
        model = LeadActivity
        fields = [
            "id",
            "lead",
            "activity_type",
            "subject",
            "notes",
            "occurred_at",
            "due_at",
            "completed_at",
            "created_by",
            "created_at",
            "metadata",
        ]
        read_only_fields = fields

    def get_lead(self, obj):
        return _lead_summary(obj.lead)

    def get_created_by(self, obj):
        return _user_summary(obj.created_by)


class LeadActivityDetailSerializer(LeadActivityListSerializer):
    pass


class LeadActivityCreateSerializer(serializers.Serializer):
    lead_id = serializers.UUIDField()
    activity_type = serializers.ChoiceField(choices=LeadActivity.ActivityType.choices)
    subject = serializers.CharField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    occurred_at = serializers.DateTimeField(required=False)
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    metadata = serializers.JSONField(required=False)

    def create(self, validated_data):
        try:
            return create_activity(actor=self.context["request"].user, **validated_data)
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return LeadActivityDetailSerializer(instance).data


# ----- Follow-ups -----


class LeadFollowUpListSerializer(serializers.ModelSerializer):
    lead = serializers.SerializerMethodField()
    assigned_to = serializers.SerializerMethodField()
    created_by = serializers.SerializerMethodField()
    completed_by = serializers.SerializerMethodField()
    is_overdue = serializers.SerializerMethodField()

    class Meta:
        model = LeadFollowUp
        fields = [
            "id",
            "lead",
            "assigned_to",
            "scheduled_for",
            "status",
            "completed_at",
            "completed_by",
            "notes",
            "created_by",
            "created_at",
            "updated_at",
            "is_overdue",
        ]
        read_only_fields = fields

    def get_lead(self, obj):
        return _lead_summary(obj.lead)

    def get_assigned_to(self, obj):
        return _user_summary(obj.assigned_to)

    def get_created_by(self, obj):
        return _user_summary(obj.created_by)

    def get_completed_by(self, obj):
        return _user_summary(obj.completed_by)

    def get_is_overdue(self, obj):
        from django.utils import timezone

        return (
            obj.status == LeadFollowUp.Status.PENDING
            and obj.scheduled_for is not None
            and obj.scheduled_for < timezone.now()
        )


class LeadFollowUpDetailSerializer(LeadFollowUpListSerializer):
    pass


class LeadFollowUpCreateSerializer(serializers.Serializer):
    lead_id = serializers.UUIDField()
    scheduled_for = serializers.DateTimeField()
    assigned_to_id = serializers.IntegerField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def create(self, validated_data):
        try:
            return create_followup(actor=self.context["request"].user, **validated_data)
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return LeadFollowUpDetailSerializer(instance).data


class LeadFollowUpUpdateSerializer(serializers.Serializer):
    scheduled_for = serializers.DateTimeField(required=False)
    assigned_to_id = serializers.IntegerField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=LeadFollowUp.Status.choices, required=False)

    def update(self, instance, validated_data):
        try:
            return update_followup(
                followup=instance,
                actor=self.context["request"].user,
                updates=dict(validated_data),
            )
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return LeadFollowUpDetailSerializer(instance).data


class LeadFollowUpCompleteSerializer(serializers.Serializer):
    notes = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def save(self, **kwargs):
        try:
            return complete_followup(
                followup=self.context["followup"],
                actor=self.context["request"].user,
                notes=self.validated_data.get("notes"),
            )
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return LeadFollowUpDetailSerializer(instance).data


# ----- Assignments -----


class LeadAssignmentListSerializer(serializers.ModelSerializer):
    lead = serializers.SerializerMethodField()
    operations_employee = serializers.SerializerMethodField()
    assigned_by = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()

    class Meta:
        model = LeadAssignment
        fields = [
            "id",
            "lead",
            "operations_employee",
            "assigned_by",
            "assigned_at",
            "accepted_at",
            "rejected_at",
            "completed_at",
            "status",
            "notes",
            "is_active",
        ]
        read_only_fields = fields

    def get_lead(self, obj):
        return _lead_summary(obj.lead)

    def get_operations_employee(self, obj):
        return _user_summary(obj.operations_employee)

    def get_assigned_by(self, obj):
        return _user_summary(obj.assigned_by)

    def get_is_active(self, obj):
        return obj.status in LeadAssignment.ACTIVE_STATUSES


class LeadAssignmentDetailSerializer(LeadAssignmentListSerializer):
    pass


class LeadAssignmentAssignSerializer(serializers.Serializer):
    lead_id = serializers.UUIDField()
    operations_employee_id = serializers.IntegerField()
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def create(self, validated_data):
        try:
            return assign_lead(actor=self.context["request"].user, **validated_data)
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return LeadAssignmentDetailSerializer(instance).data


class LeadAssignmentReassignSerializer(serializers.Serializer):
    lead_id = serializers.UUIDField()
    operations_employee_id = serializers.IntegerField()
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def create(self, validated_data):
        try:
            return reassign_lead(actor=self.context["request"].user, **validated_data)
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return LeadAssignmentDetailSerializer(instance).data


class LeadAssignmentTransitionSerializer(serializers.Serializer):
    notes = serializers.CharField(required=False, allow_blank=True, default="")
