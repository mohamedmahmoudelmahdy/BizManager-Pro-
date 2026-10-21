"""HR-facing attestation serializers — never inherit internal detail serializer."""

from __future__ import annotations

from rest_framework import serializers

from attestation.models import (
    ApplicationDegree,
    ApplicationDocument,
    ApplicationStatusHistory,
    AttestationApplication,
)
from attestation.services.hr_portal import HR_VISIBLE_VISIBILITIES


class HRDegreeSerializer(serializers.ModelSerializer):
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
        ]
        read_only_fields = fields


class HRDocumentSerializer(serializers.ModelSerializer):
    download_path = serializers.SerializerMethodField()

    class Meta:
        model = ApplicationDocument
        fields = [
            "id",
            "degree",
            "document_type",
            "original_filename",
            "content_type",
            "size_bytes",
            "uploaded_at",
            "download_path",
        ]
        read_only_fields = fields

    def get_download_path(self, obj):
        return f"/api/hr/attestation/documents/{obj.pk}/download/"


class HRStatusHistorySerializer(serializers.ModelSerializer):
    """Stage + timestamp only — no staff identity, no internal notes."""

    class Meta:
        model = ApplicationStatusHistory
        fields = ["id", "from_status", "to_status", "changed_at"]
        read_only_fields = fields


class HRBatchSummarySerializer(serializers.Serializer):
    id = serializers.UUIDField()
    title = serializers.CharField()
    expected_applicant_count = serializers.IntegerField(allow_null=True)
    is_active = serializers.BooleanField()


class HRApplicationListSerializer(serializers.ModelSerializer):
    degree_count = serializers.SerializerMethodField()
    documents_summary = serializers.SerializerMethodField()

    class Meta:
        model = AttestationApplication
        fields = [
            "id",
            "reference_number",
            "full_name",
            "phone",
            "degree_count",
            "documents_summary",
            "status",
            "dataflow_reference",
            "mohesr_reference",
            "submitted_at",
            "updated_at",
            "completed_at",
        ]
        read_only_fields = fields

    def get_degree_count(self, obj):
        if hasattr(obj, "_prefetched_objects_cache") and "degrees" in obj._prefetched_objects_cache:
            return len(obj.degrees.all())
        return obj.degrees.count()

    def get_documents_summary(self, obj):
        docs = [
            d
            for d in obj.documents.all()
            if d.visibility in HR_VISIBLE_VISIBILITIES
        ]
        count = len(docs)
        has_passport = any(d.document_type == "passport" for d in docs)
        has_degree_docs = any(
            d.document_type in ("degree_certificate", "transcript") for d in docs
        )
        return {
            "count": count,
            "label": "complete" if has_passport and has_degree_docs else "partial",
            "has_passport": has_passport,
            "has_degree_documents": has_degree_docs,
        }


class HRApplicationDetailSerializer(serializers.ModelSerializer):
    degrees = HRDegreeSerializer(many=True, read_only=True)
    documents = serializers.SerializerMethodField()
    status_history = serializers.SerializerMethodField()
    batch = serializers.SerializerMethodField()

    class Meta:
        model = AttestationApplication
        fields = [
            "id",
            "reference_number",
            "full_name",
            "phone",
            "status",
            "degrees",
            "documents",
            "dataflow_reference",
            "dataflow_submitted_at",
            "mohesr_reference",
            "mohesr_submitted_at",
            "submitted_at",
            "updated_at",
            "completed_at",
            "status_history",
            "batch",
        ]
        read_only_fields = fields

    def get_documents(self, obj):
        docs = [
            d
            for d in obj.documents.all()
            if d.visibility in HR_VISIBLE_VISIBILITIES
        ]
        return HRDocumentSerializer(docs, many=True).data

    def get_status_history(self, obj):
        history = list(obj.status_history.all())
        return HRStatusHistorySerializer(history, many=True).data

    def get_batch(self, obj):
        batch = obj.batch
        return HRBatchSummarySerializer(
            {
                "id": batch.id,
                "title": batch.title,
                "expected_applicant_count": batch.expected_applicant_count,
                "is_active": batch.is_active,
            }
        ).data
