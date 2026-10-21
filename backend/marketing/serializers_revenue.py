"""Serializers for Marketing Revenue Attribution responses."""

from __future__ import annotations

from rest_framework import serializers


class NamedRefSerializer(serializers.Serializer):
    id = serializers.CharField(allow_null=True, required=False)
    name = serializers.CharField(allow_null=True, required=False)
    code = serializers.CharField(allow_null=True, required=False)


class RevenueFiltersOutSerializer(serializers.Serializer):
    date_from = serializers.CharField(allow_null=True)
    date_to = serializers.CharField(allow_null=True)
    conversion_date_from = serializers.CharField(allow_null=True)
    conversion_date_to = serializers.CharField(allow_null=True)
    channel_id = serializers.CharField(allow_null=True)
    platform_id = serializers.CharField(allow_null=True)
    campaign_id = serializers.CharField(allow_null=True)
    adset_id = serializers.CharField(allow_null=True)
    advertisement_id = serializers.CharField(allow_null=True)
    lead_id = serializers.CharField(allow_null=True, required=False)
    customer_id = serializers.CharField(allow_null=True, required=False)
    procedure_type_id = serializers.CharField(allow_null=True, required=False)
    include_archived = serializers.BooleanField(required=False)
    search = serializers.CharField(allow_null=True, required=False)
    ordering = serializers.CharField(allow_null=True, required=False)
    page = serializers.IntegerField(required=False)
    page_size = serializers.IntegerField(required=False)


class OverviewSummarySerializer(serializers.Serializer):
    leads = serializers.IntegerField()
    converted_customers = serializers.IntegerField()
    procedures = serializers.IntegerField()
    collected_revenue = serializers.CharField()
    net_profit = serializers.CharField()
    campaign_spend = serializers.CharField()
    marketing_contribution = serializers.CharField()
    roas = serializers.CharField(allow_null=True)
    marketing_roi = serializers.CharField(allow_null=True)
    customer_acquisition_cost = serializers.CharField(allow_null=True)
    average_customer_revenue = serializers.CharField(allow_null=True)
    average_customer_net_profit = serializers.CharField(allow_null=True)


class RevenueOverviewResponseSerializer(serializers.Serializer):
    filters = RevenueFiltersOutSerializer()
    summary = OverviewSummarySerializer()
    meta = serializers.DictField(required=False)


class ChannelRevenueRowSerializer(serializers.Serializer):
    channel = NamedRefSerializer()
    leads = serializers.IntegerField()
    converted_customers = serializers.IntegerField()
    procedures = serializers.IntegerField()
    collected_revenue = serializers.CharField()
    net_profit = serializers.CharField()
    campaign_spend = serializers.CharField()
    marketing_contribution = serializers.CharField()
    roas = serializers.CharField(allow_null=True)
    marketing_roi = serializers.CharField(allow_null=True)


class PaginatedRevenueSerializer(serializers.Serializer):
    filters = RevenueFiltersOutSerializer()
    count = serializers.IntegerField()
    page = serializers.IntegerField()
    page_size = serializers.IntegerField()
    results = serializers.ListField()
    meta = serializers.DictField(required=False)
