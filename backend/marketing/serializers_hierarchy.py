"""Serializers for Marketing CRM campaign hierarchy and CampaignSpend (Phase 2C.2)."""

from __future__ import annotations

from rest_framework import serializers

from marketing.exceptions import MarketingBusinessError, raise_api_error
from marketing.models import (
    CampaignSpend,
    MarketingAdSet,
    MarketingAdvertisement,
    MarketingCampaign,
    MarketingChannel,
    MarketingPlatform,
)
from marketing.services.adsets import archive_adset, create_adset, update_adset
from marketing.services.advertisements import (
    archive_advertisement,
    create_advertisement,
    update_advertisement,
)
from marketing.services.campaign_spend import create_campaign_spend, update_campaign_spend
from marketing.services.campaigns import archive_campaign, create_campaign, update_campaign
from marketing.services.channels import archive_channel, create_channel, update_channel
from marketing.services.platforms import archive_platform, create_platform, update_platform


def _named_ref(obj) -> dict | None:
    if obj is None:
        return None
    data = {"id": obj.pk, "name": obj.name}
    if hasattr(obj, "code"):
        data["code"] = obj.code
    if hasattr(obj, "is_active"):
        data["is_active"] = obj.is_active
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


# ----- Channel -----


class ChannelListSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarketingChannel
        fields = ["id", "name", "code", "description", "is_active", "created_at", "updated_at"]
        read_only_fields = fields


class ChannelDetailSerializer(ChannelListSerializer):
    pass


class ChannelCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    code = serializers.SlugField(max_length=64)
    description = serializers.CharField(required=False, allow_blank=True, default="")

    def create(self, validated_data):
        try:
            return create_channel(actor=self.context["request"].user, **validated_data)
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return ChannelDetailSerializer(instance).data


class ChannelUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    code = serializers.SlugField(max_length=64, required=False)

    def update(self, instance, validated_data):
        updates = dict(validated_data)
        if "code" in self.initial_data:
            updates["code"] = self.initial_data["code"]
        try:
            return update_channel(
                channel=instance, actor=self.context["request"].user, updates=updates
            )
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return ChannelDetailSerializer(instance).data


class ChannelArchiveSerializer(serializers.Serializer):
    def save(self, **kwargs):
        try:
            return archive_channel(
                channel=self.context["entity"], actor=self.context["request"].user
            )
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return ChannelDetailSerializer(instance).data


# ----- Platform -----


class PlatformListSerializer(serializers.ModelSerializer):
    channel = serializers.SerializerMethodField()

    class Meta:
        model = MarketingPlatform
        fields = [
            "id",
            "name",
            "code",
            "description",
            "is_active",
            "channel",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_channel(self, obj):
        return _named_ref(obj.channel)


class PlatformDetailSerializer(PlatformListSerializer):
    pass


class PlatformCreateSerializer(serializers.Serializer):
    channel_id = serializers.UUIDField()
    name = serializers.CharField(max_length=255)
    code = serializers.SlugField(max_length=64)
    description = serializers.CharField(required=False, allow_blank=True, default="")

    def create(self, validated_data):
        try:
            return create_platform(actor=self.context["request"].user, **validated_data)
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return PlatformDetailSerializer(instance).data


class PlatformUpdateSerializer(serializers.Serializer):
    channel_id = serializers.UUIDField(required=False)
    name = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    code = serializers.SlugField(max_length=64, required=False)

    def update(self, instance, validated_data):
        updates = dict(validated_data)
        if "code" in self.initial_data:
            updates["code"] = self.initial_data["code"]
        try:
            return update_platform(
                platform=instance, actor=self.context["request"].user, updates=updates
            )
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return PlatformDetailSerializer(instance).data


class PlatformArchiveSerializer(serializers.Serializer):
    def save(self, **kwargs):
        try:
            return archive_platform(
                platform=self.context["entity"], actor=self.context["request"].user
            )
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return PlatformDetailSerializer(instance).data


# ----- Campaign -----


class CampaignListSerializer(serializers.ModelSerializer):
    platform = serializers.SerializerMethodField()
    channel = serializers.SerializerMethodField()
    created_by = serializers.SerializerMethodField()

    class Meta:
        model = MarketingCampaign
        fields = [
            "id",
            "name",
            "code",
            "description",
            "objective",
            "start_date",
            "end_date",
            "budget",
            "currency",
            "status",
            "is_active",
            "platform",
            "channel",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_platform(self, obj):
        return _named_ref(obj.platform)

    def get_channel(self, obj):
        if obj.platform_id and obj.platform:
            return _named_ref(obj.platform.channel)
        return None

    def get_created_by(self, obj):
        return _user_summary(obj.created_by)


class CampaignDetailSerializer(CampaignListSerializer):
    pass


class CampaignCreateSerializer(serializers.Serializer):
    platform_id = serializers.UUIDField()
    name = serializers.CharField(max_length=255)
    code = serializers.SlugField(max_length=64)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    objective = serializers.CharField(required=False, allow_blank=True, default="")
    start_date = serializers.DateField(required=False, allow_null=True)
    end_date = serializers.DateField(required=False, allow_null=True)
    budget = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )
    currency = serializers.CharField(required=False, default="AED", max_length=8)
    status = serializers.ChoiceField(
        choices=MarketingCampaign.Status.choices,
        required=False,
        default=MarketingCampaign.Status.DRAFT,
    )

    def create(self, validated_data):
        try:
            return create_campaign(actor=self.context["request"].user, **validated_data)
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return CampaignDetailSerializer(instance).data


class CampaignUpdateSerializer(serializers.Serializer):
    platform_id = serializers.UUIDField(required=False)
    name = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    objective = serializers.CharField(required=False, allow_blank=True)
    start_date = serializers.DateField(required=False, allow_null=True)
    end_date = serializers.DateField(required=False, allow_null=True)
    budget = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )
    currency = serializers.CharField(required=False, max_length=8)
    status = serializers.ChoiceField(choices=MarketingCampaign.Status.choices, required=False)
    code = serializers.SlugField(max_length=64, required=False)

    def update(self, instance, validated_data):
        updates = dict(validated_data)
        if "code" in self.initial_data:
            updates["code"] = self.initial_data["code"]
        try:
            return update_campaign(
                campaign=instance, actor=self.context["request"].user, updates=updates
            )
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return CampaignDetailSerializer(instance).data


class CampaignArchiveSerializer(serializers.Serializer):
    def save(self, **kwargs):
        try:
            return archive_campaign(
                campaign=self.context["entity"], actor=self.context["request"].user
            )
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return CampaignDetailSerializer(instance).data


# ----- Ad Set -----


class AdSetListSerializer(serializers.ModelSerializer):
    campaign = serializers.SerializerMethodField()

    class Meta:
        model = MarketingAdSet
        fields = [
            "id",
            "name",
            "external_reference",
            "budget",
            "start_date",
            "end_date",
            "is_active",
            "campaign",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_campaign(self, obj):
        return _named_ref(obj.campaign)


class AdSetDetailSerializer(AdSetListSerializer):
    pass


class AdSetCreateSerializer(serializers.Serializer):
    campaign_id = serializers.UUIDField()
    name = serializers.CharField(max_length=255)
    external_reference = serializers.CharField(required=False, allow_blank=True, default="")
    budget = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )
    start_date = serializers.DateField(required=False, allow_null=True)
    end_date = serializers.DateField(required=False, allow_null=True)

    def create(self, validated_data):
        try:
            return create_adset(actor=self.context["request"].user, **validated_data)
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return AdSetDetailSerializer(instance).data


class AdSetUpdateSerializer(serializers.Serializer):
    campaign_id = serializers.UUIDField(required=False)
    name = serializers.CharField(max_length=255, required=False)
    external_reference = serializers.CharField(required=False, allow_blank=True)
    budget = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )
    start_date = serializers.DateField(required=False, allow_null=True)
    end_date = serializers.DateField(required=False, allow_null=True)

    def update(self, instance, validated_data):
        try:
            return update_adset(
                ad_set=instance, actor=self.context["request"].user, updates=dict(validated_data)
            )
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return AdSetDetailSerializer(instance).data


class AdSetArchiveSerializer(serializers.Serializer):
    def save(self, **kwargs):
        try:
            return archive_adset(ad_set=self.context["entity"], actor=self.context["request"].user)
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return AdSetDetailSerializer(instance).data


# ----- Advertisement -----


class AdvertisementListSerializer(serializers.ModelSerializer):
    campaign = serializers.SerializerMethodField()
    ad_set = serializers.SerializerMethodField()

    class Meta:
        model = MarketingAdvertisement
        fields = [
            "id",
            "name",
            "external_reference",
            "creative_reference",
            "is_active",
            "campaign",
            "ad_set",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_campaign(self, obj):
        return _named_ref(obj.campaign)

    def get_ad_set(self, obj):
        return _named_ref(obj.ad_set)


class AdvertisementDetailSerializer(AdvertisementListSerializer):
    pass


class AdvertisementCreateSerializer(serializers.Serializer):
    campaign_id = serializers.UUIDField()
    ad_set_id = serializers.UUIDField(required=False, allow_null=True)
    name = serializers.CharField(max_length=255)
    external_reference = serializers.CharField(required=False, allow_blank=True, default="")
    creative_reference = serializers.CharField(required=False, allow_blank=True, default="")

    def create(self, validated_data):
        try:
            return create_advertisement(actor=self.context["request"].user, **validated_data)
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return AdvertisementDetailSerializer(instance).data


class AdvertisementUpdateSerializer(serializers.Serializer):
    campaign_id = serializers.UUIDField(required=False)
    ad_set_id = serializers.UUIDField(required=False, allow_null=True)
    name = serializers.CharField(max_length=255, required=False)
    external_reference = serializers.CharField(required=False, allow_blank=True)
    creative_reference = serializers.CharField(required=False, allow_blank=True)

    def update(self, instance, validated_data):
        try:
            return update_advertisement(
                advertisement=instance,
                actor=self.context["request"].user,
                updates=dict(validated_data),
            )
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return AdvertisementDetailSerializer(instance).data


class AdvertisementArchiveSerializer(serializers.Serializer):
    def save(self, **kwargs):
        try:
            return archive_advertisement(
                advertisement=self.context["entity"], actor=self.context["request"].user
            )
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return AdvertisementDetailSerializer(instance).data


# ----- CampaignSpend -----


class CampaignSpendListSerializer(serializers.ModelSerializer):
    campaign = serializers.SerializerMethodField()
    ad_set = serializers.SerializerMethodField()
    advertisement = serializers.SerializerMethodField()
    created_by = serializers.SerializerMethodField()

    class Meta:
        model = CampaignSpend
        fields = [
            "id",
            "spend_date",
            "amount",
            "currency",
            "description",
            "external_reference",
            "expense_id",
            "integration_status",
            "campaign",
            "ad_set",
            "advertisement",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_campaign(self, obj):
        return _named_ref(obj.campaign)

    def get_ad_set(self, obj):
        return _named_ref(obj.ad_set)

    def get_advertisement(self, obj):
        return _named_ref(obj.advertisement)

    def get_created_by(self, obj):
        return _user_summary(obj.created_by)


class CampaignSpendDetailSerializer(CampaignSpendListSerializer):
    class Meta(CampaignSpendListSerializer.Meta):
        fields = CampaignSpendListSerializer.Meta.fields + [
            "financial_reference",
            "integration_error",
            "integrated_at",
        ]
        read_only_fields = fields


class CampaignSpendCreateSerializer(serializers.Serializer):
    campaign_id = serializers.UUIDField()
    spend_date = serializers.DateField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)
    currency = serializers.CharField(required=False, default="AED", max_length=8)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    external_reference = serializers.CharField(required=False, allow_blank=True, default="")
    ad_set_id = serializers.UUIDField(required=False, allow_null=True)
    advertisement_id = serializers.UUIDField(required=False, allow_null=True)
    expense_id = serializers.UUIDField(required=False, allow_null=True)

    def create(self, validated_data):
        try:
            return create_campaign_spend(actor=self.context["request"].user, **validated_data)
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return CampaignSpendDetailSerializer(instance).data


class CampaignSpendUpdateSerializer(serializers.Serializer):
    campaign_id = serializers.UUIDField(required=False)
    spend_date = serializers.DateField(required=False)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
    currency = serializers.CharField(required=False, max_length=8)
    description = serializers.CharField(required=False, allow_blank=True)
    external_reference = serializers.CharField(required=False, allow_blank=True)
    ad_set_id = serializers.UUIDField(required=False, allow_null=True)
    advertisement_id = serializers.UUIDField(required=False, allow_null=True)
    expense_id = serializers.UUIDField(required=False, allow_null=True)
    integration_status = serializers.CharField(required=False)

    def update(self, instance, validated_data):
        updates = dict(validated_data)
        if "integration_status" in self.initial_data:
            updates["integration_status"] = self.initial_data["integration_status"]
        try:
            return update_campaign_spend(
                spend=instance, actor=self.context["request"].user, updates=updates
            )
        except MarketingBusinessError as exc:
            raise_api_error(exc)

    def to_representation(self, instance):
        return CampaignSpendDetailSerializer(instance).data
