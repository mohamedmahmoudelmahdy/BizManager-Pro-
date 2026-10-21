"""Lead conversion request serializer (Phase 2C.4)."""

from __future__ import annotations

from rest_framework import serializers

from marketing.exceptions import MarketingBusinessError, raise_api_error
from marketing.serializers import LeadDetailSerializer
from marketing.services.lead_convert import (
    MODE_CREATE_CUSTOMER,
    MODE_LINK_EXISTING,
    VALID_MODES,
    convert_lead_atomic,
)


class LeadConvertSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=sorted(VALID_MODES))
    customer_id = serializers.UUIDField(required=False, allow_null=True)
    customer = serializers.DictField(required=False, allow_null=True)

    def validate(self, attrs):
        mode = attrs.get("mode")
        customer_id = attrs.get("customer_id")
        customer = attrs.get("customer")

        has_id = customer_id is not None
        has_payload = customer is not None

        if has_id and has_payload:
            raise serializers.ValidationError(
                {"non_field_errors": ["conflicting_customer_id_and_customer"]}
            )

        if mode == MODE_LINK_EXISTING:
            if has_payload:
                raise serializers.ValidationError(
                    {"customer": ["not_allowed_for_link_existing_customer"]}
                )
            # customer_id may be omitted so the service can return matching_customer_found
        elif mode == MODE_CREATE_CUSTOMER:
            if has_id:
                raise serializers.ValidationError(
                    {"customer_id": ["not_allowed_for_create_customer"]}
                )
            # customer payload optional; service fills defaults from Lead
        return attrs

    def save(self, **kwargs):
        lead = self.context["lead"]
        actor = self.context["request"].user
        try:
            return convert_lead_atomic(
                lead=lead,
                actor=actor,
                mode=self.validated_data["mode"],
                customer_id=self.validated_data.get("customer_id"),
                customer_data=self.validated_data.get("customer"),
            )
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return LeadDetailSerializer(instance, context=self.context).data
