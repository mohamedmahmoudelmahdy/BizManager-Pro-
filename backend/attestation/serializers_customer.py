"""Serializers for customer-profile attestation management APIs."""

from __future__ import annotations

from rest_framework import serializers


class CustomerAttestationEnableSerializer(serializers.Serializer):
    expected_applicant_count = serializers.IntegerField(
        required=False, min_value=1, max_value=100000, default=54
    )
    title = serializers.CharField(required=False, allow_blank=True, max_length=255)
    slug = serializers.SlugField(required=False, allow_blank=True, max_length=64)


class CustomerAttestationSetActiveSerializer(serializers.Serializer):
    is_active = serializers.BooleanField(required=True)


class CustomerAttestationHrUserCreateSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=128, write_only=True)
    email = serializers.EmailField(required=False, allow_blank=True)
