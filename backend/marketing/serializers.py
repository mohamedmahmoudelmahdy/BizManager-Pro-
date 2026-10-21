"""Lead serializers for Marketing CRM Phase 2C.1."""

from __future__ import annotations

from rest_framework import serializers

from marketing.exceptions import MarketingBusinessError, raise_api_error
from marketing.models import Lead
from marketing.services.lead_archive import archive_lead
from marketing.services.lead_create import create_lead
from marketing.services.lead_update import update_lead
from marketing.services.lead_support import coerce_uuid


class NamedRefSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    code = serializers.CharField(required=False, allow_blank=True)


class UserSummarySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()
    first_name = serializers.CharField(allow_blank=True)
    last_name = serializers.CharField(allow_blank=True)


class CustomerSummarySerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    company_name = serializers.CharField(allow_blank=True)
    phone = serializers.CharField(allow_blank=True)
    type = serializers.CharField()


class CustomerPhoneMatchSerializer(serializers.Serializer):
    customer_id = serializers.UUIDField()
    matched_field = serializers.CharField()
    matched_raw_value = serializers.CharField()
    normalized_value = serializers.CharField()
    display_name = serializers.CharField()
    phone = serializers.CharField(allow_blank=True)
    phone_secondary = serializers.CharField(allow_blank=True)
    customer_type = serializers.CharField()


def _named_ref(obj) -> dict | None:
    if obj is None:
        return None
    data = {"id": obj.pk, "name": obj.name}
    if hasattr(obj, "code"):
        data["code"] = obj.code
    return data


def _user_summary(user) -> dict | None:
    if user is None:
        return None
    return {
        "id": user.pk,
        "username": user.username,
        "first_name": user.first_name or "",
        "last_name": user.last_name or "",
    }


def _customer_summary(customer) -> dict | None:
    if customer is None:
        return None
    return {
        "id": customer.pk,
        "name": customer.name,
        "company_name": customer.company_name or "",
        "phone": customer.phone or "",
        "type": customer.type,
    }


class LeadListSerializer(serializers.ModelSerializer):
    channel = serializers.SerializerMethodField()
    platform = serializers.SerializerMethodField()
    campaign = serializers.SerializerMethodField()
    marketing_owner = serializers.SerializerMethodField()
    linked_customer = serializers.SerializerMethodField()
    created_by = serializers.SerializerMethodField()
    last_contacted_by = serializers.SerializerMethodField()
    last_contacted_at = serializers.DateTimeField(read_only=True, allow_null=True, required=False)

    class Meta:
        model = Lead
        fields = [
            "id",
            "lead_number",
            "name",
            "raw_phone",
            "normalized_phone",
            "email",
            "status",
            "outcome",
            "channel",
            "platform",
            "campaign",
            "marketing_owner",
            "linked_customer",
            "created_by",
            "last_contacted_by",
            "last_contacted_at",
            "created_at",
            "updated_at",
            "archived_at",
        ]
        read_only_fields = fields

    def get_channel(self, obj):
        return _named_ref(obj.channel)

    def get_platform(self, obj):
        return _named_ref(obj.platform)

    def get_campaign(self, obj):
        return _named_ref(obj.campaign)

    def get_marketing_owner(self, obj):
        return _user_summary(obj.marketing_owner)

    def get_linked_customer(self, obj):
        return _customer_summary(obj.linked_customer)

    def get_created_by(self, obj):
        return _user_summary(obj.created_by)

    def get_last_contacted_by(self, obj):
        uid = getattr(obj, "_last_contacted_by_id", None)
        if uid is None:
            return None
        users_by_id = self.context.get("users_by_id") or {}
        user = users_by_id.get(uid)
        if user is None:
            from django.contrib.auth import get_user_model

            User = get_user_model()
            user = User.objects.filter(pk=uid).first()
        return _user_summary(user)


class LeadDetailSerializer(LeadListSerializer):
    ad_set = serializers.SerializerMethodField()
    advertisement = serializers.SerializerMethodField()
    archived_by = serializers.SerializerMethodField()
    converted_by = serializers.SerializerMethodField()

    class Meta(LeadListSerializer.Meta):
        fields = LeadListSerializer.Meta.fields + [
            "notes",
            "ad_set",
            "advertisement",
            "converted_at",
            "converted_by",
            "archived_by",
            "archive_reason",
        ]
        read_only_fields = fields

    def get_ad_set(self, obj):
        return _named_ref(obj.ad_set)

    def get_advertisement(self, obj):
        return _named_ref(obj.advertisement)

    def get_archived_by(self, obj):
        return _user_summary(obj.archived_by)

    def get_converted_by(self, obj):
        return _user_summary(obj.converted_by)


class LeadCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    raw_phone = serializers.CharField(max_length=50)
    selected_customer_id = serializers.UUIDField(required=False, allow_null=True)
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    status = serializers.ChoiceField(
        choices=Lead.Status.choices,
        required=False,
        default=Lead.Status.NEW,
    )
    outcome = serializers.ChoiceField(
        choices=Lead.Outcome.choices,
        required=False,
        allow_blank=True,
        default="",
    )
    channel_id = serializers.UUIDField(required=False, allow_null=True)
    platform_id = serializers.UUIDField(required=False, allow_null=True)
    campaign_id = serializers.UUIDField(required=False, allow_null=True)
    ad_set_id = serializers.UUIDField(required=False, allow_null=True)
    advertisement_id = serializers.UUIDField(required=False, allow_null=True)
    marketing_owner_id = serializers.IntegerField(required=False, allow_null=True)

    def validate_status(self, value):
        if value in (Lead.Status.ARCHIVED, Lead.Status.CONVERTED):
            raise serializers.ValidationError("invalid_status_for_create")
        return value

    def create(self, validated_data):
        actor = self.context["request"].user
        try:
            return create_lead(actor=actor, **validated_data)
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return LeadDetailSerializer(instance, context=self.context).data


class LeadUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False)
    raw_phone = serializers.CharField(max_length=50, required=False)
    selected_customer_id = serializers.UUIDField(required=False, allow_null=True)
    clear_linked_customer = serializers.BooleanField(required=False, default=False)
    email = serializers.EmailField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=Lead.Status.choices, required=False)
    outcome = serializers.ChoiceField(
        choices=Lead.Outcome.choices,
        required=False,
        allow_blank=True,
    )
    channel_id = serializers.UUIDField(required=False, allow_null=True)
    platform_id = serializers.UUIDField(required=False, allow_null=True)
    campaign_id = serializers.UUIDField(required=False, allow_null=True)
    ad_set_id = serializers.UUIDField(required=False, allow_null=True)
    advertisement_id = serializers.UUIDField(required=False, allow_null=True)
    marketing_owner_id = serializers.IntegerField(required=False, allow_null=True)

    # Reject client attempts to set immutable fields if present in payload.
    lead_number = serializers.CharField(required=False)
    normalized_phone = serializers.CharField(required=False)
    created_by = serializers.IntegerField(required=False)
    converted_at = serializers.DateTimeField(required=False)
    converted_by = serializers.IntegerField(required=False)
    archived_at = serializers.DateTimeField(required=False)
    archived_by = serializers.IntegerField(required=False)
    archive_reason = serializers.CharField(required=False)

    def update(self, instance, validated_data):
        actor = self.context["request"].user
        selected = validated_data.pop("selected_customer_id", None)
        # Pass through any immutable keys that arrived so the service can reject them.
        immutable_probe = {}
        for key in (
            "lead_number",
            "normalized_phone",
            "created_by",
            "converted_at",
            "converted_by",
            "archived_at",
            "archived_by",
            "archive_reason",
        ):
            if key in self.initial_data:
                immutable_probe[key] = self.initial_data[key]
                validated_data.pop(key, None)

        updates = {**immutable_probe, **validated_data}
        try:
            return update_lead(
                lead=instance,
                actor=actor,
                updates=updates,
                selected_customer_id=coerce_uuid(selected) if selected is not None else None,
            )
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return LeadDetailSerializer(instance, context=self.context).data


class LeadArchiveSerializer(serializers.Serializer):
    reason = serializers.CharField(allow_blank=True)

    def save(self, **kwargs):
        lead = self.context["lead"]
        actor = self.context["request"].user
        try:
            return archive_lead(
                lead=lead,
                actor=actor,
                reason=self.validated_data.get("reason", ""),
            )
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return LeadDetailSerializer(instance, context=self.context).data
