"""Serializers for Customer Financial transfer actions."""

from rest_framework import serializers


class ProcedureTransferSerializer(serializers.Serializer):
    target_customer_id = serializers.UUIDField()
    reason = serializers.CharField(max_length=2000, trim_whitespace=True)
    transfer_linked_payments = serializers.BooleanField(required=False, default=True)


class PaymentTransferSerializer(serializers.Serializer):
    target_customer_id = serializers.UUIDField()
    reason = serializers.CharField(max_length=2000, trim_whitespace=True)
    target_procedure_id = serializers.UUIDField(required=False, allow_null=True)
