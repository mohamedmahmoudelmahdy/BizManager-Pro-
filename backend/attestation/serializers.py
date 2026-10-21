"""Attestation serializers with clear Internal / Public / HR boundaries."""

from __future__ import annotations

from rest_framework import serializers

from attestation.models import (
    ApplicationDegree,
    ApplicationDocument,
    ApplicationStatusHistory,
    AttestationApplication,
    AttestationBatch,
)


class ApplicationDegreeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ApplicationDegree
        fields = [
            "id",
            "study_location",
            "university",
            "degree_level",
            "major",
            "start_year",
            "completion_year",
            "final_grade",
            "sort_order",
            "created_at",
        ]
        read_only_fields = fields


class InternalApplicationDocumentSerializer(serializers.ModelSerializer):
    """Never exposes raw storage paths — only download endpoint id."""

    download_path = serializers.SerializerMethodField()

    class Meta:
        model = ApplicationDocument
        fields = [
            "id",
            "degree",
            "document_type",
            "visibility",
            "original_filename",
            "content_type",
            "size_bytes",
            "uploaded_at",
            "download_path",
        ]
        read_only_fields = fields

    def get_download_path(self, obj):
        return f"/api/attestation/documents/{obj.pk}/download/"


class ApplicationStatusHistorySerializer(serializers.ModelSerializer):
    changed_by_username = serializers.SerializerMethodField()

    class Meta:
        model = ApplicationStatusHistory
        fields = [
            "id",
            "from_status",
            "to_status",
            "changed_by",
            "changed_by_username",
            "actor_source",
            "internal_note",
            "changed_at",
        ]
        read_only_fields = fields

    def get_changed_by_username(self, obj):
        if obj.changed_by_id and obj.changed_by:
            return obj.changed_by.username
        return None


class AttestationBatchSummarySerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    procedure_id = serializers.UUIDField(source="linked_procedure_id", read_only=True)

    class Meta:
        model = AttestationBatch
        fields = [
            "id",
            "title",
            "public_slug",
            "expected_applicant_count",
            "is_active",
            "customer",
            "customer_name",
            "procedure_id",
        ]
        read_only_fields = fields


class InternalApplicationListSerializer(serializers.ModelSerializer):
    batch_title = serializers.CharField(source="batch.title", read_only=True)
    batch_expected_count = serializers.IntegerField(
        source="batch.expected_applicant_count", read_only=True, allow_null=True
    )
    degree_count = serializers.SerializerMethodField()

    class Meta:
        model = AttestationApplication
        fields = [
            "id",
            "reference_number",
            "full_name",
            "phone",
            "status",
            "batch",
            "batch_title",
            "batch_expected_count",
            "dataflow_reference",
            "mohesr_reference",
            "submitted_at",
            "updated_at",
            "completed_at",
            "degree_count",
        ]
        read_only_fields = fields

    def get_degree_count(self, obj):
        if hasattr(obj, "_prefetched_objects_cache") and "degrees" in obj._prefetched_objects_cache:
            return len(obj.degrees.all())
        return obj.degrees.count()


class InternalApplicationDetailSerializer(serializers.ModelSerializer):
    """
    Full internal staff view.

    Includes internal_notes only when the actor may view/edit notes.
    Do NOT reuse for HR (see HRApplicationSerializer).
    """

    degrees = ApplicationDegreeSerializer(many=True, read_only=True)
    documents = InternalApplicationDocumentSerializer(many=True, read_only=True)
    status_history = ApplicationStatusHistorySerializer(many=True, read_only=True)
    batch = AttestationBatchSummarySerializer(read_only=True)

    class Meta:
        model = AttestationApplication
        fields = [
            "id",
            "reference_number",
            "full_name",
            "phone",
            "phone_normalized",
            "status",
            "internal_notes",
            "dataflow_reference",
            "dataflow_submitted_at",
            "mohesr_reference",
            "mohesr_submitted_at",
            "submitted_at",
            "completed_at",
            "created_at",
            "updated_at",
            "batch",
            "degrees",
            "documents",
            "status_history",
        ]
        read_only_fields = [
            "id",
            "reference_number",
            "phone_normalized",
            "status",
            "submitted_at",
            "completed_at",
            "created_at",
            "updated_at",
            "batch",
            "degrees",
            "documents",
            "status_history",
            "dataflow_reference",
            "dataflow_submitted_at",
            "mohesr_reference",
            "mohesr_submitted_at",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        actor = getattr(request, "user", None) if request is not None else None
        if actor is None or not actor.is_authenticated:
            data["internal_notes"] = ""
            return data
        from attestation.services.workflow import user_has_attestation_perm

        may_see_notes = (
            user_has_attestation_perm(actor, "view_internal_notes")
            or user_has_attestation_perm(actor, "process_attestationapplication")
            or user_has_attestation_perm(actor, "change_attestationapplication")
        )
        if not may_see_notes:
            data["internal_notes"] = ""
        return data


class InternalApplicationNotesUpdateSerializer(serializers.Serializer):
    internal_notes = serializers.CharField(allow_blank=True, required=True)


class PublicSubmissionResponseSerializer(serializers.Serializer):
    reference_number = serializers.CharField()
    status = serializers.CharField()
    submitted_at = serializers.CharField()
    message_code = serializers.CharField()


class HRApplicationSerializer(serializers.Serializer):
    """
    Deprecated stub — Phase C uses serializers_hr.HRApplicationDetailSerializer.

    Kept only to avoid import breakage; do not wire this to HR views.
    """

    id = serializers.UUIDField()
    reference_number = serializers.CharField()
    full_name = serializers.CharField()
    phone = serializers.CharField()
    status = serializers.CharField()
    submitted_at = serializers.DateTimeField()
    completed_at = serializers.DateTimeField(allow_null=True)
    dataflow_reference = serializers.CharField()
    mohesr_reference = serializers.CharField()
    degrees = ApplicationDegreeSerializer(many=True)
    documents = InternalApplicationDocumentSerializer(many=True)
