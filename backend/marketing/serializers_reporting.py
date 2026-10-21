"""Response serializers for Marketing reporting APIs (Phase 3.3A)."""

from __future__ import annotations

from rest_framework import serializers


class ReportFiltersOutSerializer(serializers.Serializer):
    date_from = serializers.DateField()
    date_to = serializers.DateField()
    channel_id = serializers.UUIDField(allow_null=True, required=False)
    platform_id = serializers.UUIDField(allow_null=True, required=False)
    campaign_id = serializers.UUIDField(allow_null=True, required=False)
    adset_id = serializers.UUIDField(allow_null=True, required=False)
    advertisement_id = serializers.UUIDField(allow_null=True, required=False)
    status = serializers.CharField(allow_null=True, required=False)
    outcome = serializers.CharField(allow_null=True, required=False, allow_blank=True)
    assigned_to = serializers.IntegerField(allow_null=True, required=False)
    include_archived = serializers.BooleanField()


class CodeCountSerializer(serializers.Serializer):
    code = serializers.CharField(allow_null=True)
    count = serializers.IntegerField()


class OverviewLeadsSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    active = serializers.IntegerField()
    converted_cohort = serializers.IntegerField()
    conversion_events = serializers.IntegerField()
    lost = serializers.IntegerField()
    conversion_rate = serializers.CharField(allow_null=True)
    average_time_to_conversion_hours = serializers.CharField(allow_null=True)


class OverviewSpendSerializer(serializers.Serializer):
    total = serializers.CharField()
    cost_per_lead = serializers.CharField(allow_null=True)
    cost_per_conversion = serializers.CharField(allow_null=True)


class OverviewFollowupsSerializer(serializers.Serializer):
    pending = serializers.IntegerField()
    overdue = serializers.IntegerField()
    due_today = serializers.IntegerField()
    due_next_7_days = serializers.IntegerField()
    completed = serializers.IntegerField()
    cancelled = serializers.IntegerField()


class OverviewAssignmentsSerializer(serializers.Serializer):
    unassigned_leads = serializers.IntegerField()
    pending = serializers.IntegerField()
    accepted = serializers.IntegerField()
    active_total = serializers.IntegerField()


class OverviewBreakdownsSerializer(serializers.Serializer):
    status = CodeCountSerializer(many=True)
    outcome = CodeCountSerializer(many=True)


class OverviewResponseSerializer(serializers.Serializer):
    filters = ReportFiltersOutSerializer()
    meta = serializers.DictField()
    leads = OverviewLeadsSerializer()
    breakdowns = OverviewBreakdownsSerializer()
    spend = OverviewSpendSerializer()
    followups = OverviewFollowupsSerializer()
    assignments = OverviewAssignmentsSerializer()


class LeadTrendPointSerializer(serializers.Serializer):
    period = serializers.CharField()
    created = serializers.IntegerField()
    converted = serializers.IntegerField()
    lost = serializers.IntegerField()


class LeadTrendsResponseSerializer(serializers.Serializer):
    filters = ReportFiltersOutSerializer()
    interval = serializers.ChoiceField(choices=["day", "week", "month"])
    meta = serializers.DictField()
    series = LeadTrendPointSerializer(many=True)


class HierarchyRefSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()


class CampaignPerformanceRowSerializer(serializers.Serializer):
    campaign_id = serializers.UUIDField()
    campaign_code = serializers.CharField()
    campaign_name = serializers.CharField()
    is_active = serializers.BooleanField()
    platform = HierarchyRefSerializer()
    channel = HierarchyRefSerializer()
    leads_created = serializers.IntegerField()
    converted_leads = serializers.IntegerField()
    conversion_rate = serializers.CharField(allow_null=True)
    spend = serializers.CharField()
    cost_per_lead = serializers.CharField(allow_null=True)
    cost_per_conversion = serializers.CharField(allow_null=True)


class CampaignPerformanceResponseSerializer(serializers.Serializer):
    filters = ReportFiltersOutSerializer()
    meta = serializers.DictField()
    count = serializers.IntegerField()
    page = serializers.IntegerField()
    page_size = serializers.IntegerField()
    results = CampaignPerformanceRowSerializer(many=True)


class AssigneeWorkloadSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    display_name = serializers.CharField()
    pending = serializers.IntegerField()
    overdue = serializers.IntegerField(required=False)
    completed = serializers.IntegerField(required=False)
    total = serializers.IntegerField(required=False)
    accepted = serializers.IntegerField(required=False)
    active_total = serializers.IntegerField(required=False)
    completed_in_range = serializers.IntegerField(required=False)
    rejected = serializers.IntegerField(required=False)
    cancelled = serializers.IntegerField(required=False)
    reassigned = serializers.IntegerField(required=False)


class FollowupWorkloadResponseSerializer(serializers.Serializer):
    filters = ReportFiltersOutSerializer()
    meta = serializers.DictField()
    summary = serializers.DictField()
    by_status = CodeCountSerializer(many=True)
    by_assignee = AssigneeWorkloadSerializer(many=True)


class AssignmentWorkloadResponseSerializer(serializers.Serializer):
    filters = ReportFiltersOutSerializer()
    meta = serializers.DictField()
    summary = serializers.DictField()
    by_status = CodeCountSerializer(many=True)
    by_assignee = AssigneeWorkloadSerializer(many=True)
