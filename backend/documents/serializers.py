from rest_framework import serializers
from .models import Document


class DocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Document
        fields = ["id", "customer", "file", "original_name", "uploaded_by", "created_at"]
        read_only_fields = ["id", "uploaded_by", "created_at"]
