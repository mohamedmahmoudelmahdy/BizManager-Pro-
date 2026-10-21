"""ViewSets for Marketing CRM campaign hierarchy and CampaignSpend (Phase 2C.2)."""

from __future__ import annotations

from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import permission_required
from marketing.models import (
    CampaignSpend,
    MarketingAdSet,
    MarketingAdvertisement,
    MarketingCampaign,
    MarketingChannel,
    MarketingPlatform,
)
from marketing import serializers_hierarchy as ser


class HierarchyViewSetMixin:
    """PATCH-only mutations; no PUT/DELETE; optional archive action."""

    http_method_names = ["get", "post", "patch", "head", "options"]

    def destroy(self, request, *args, **kwargs):
        return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)

    def _apply_active_filters(self, qs, *, active_field: str = "is_active"):
        params = self.request.query_params
        include_inactive = params.get("include_inactive", "").lower() in ("1", "true", "yes")
        inactive_only = params.get("inactive", "").lower() in ("1", "true", "yes")
        archived = params.get("archived", "").lower() in ("1", "true", "yes")

        if self.action in ("retrieve", "partial_update", "archive"):
            return qs

        if inactive_only or archived:
            return qs.filter(**{active_field: False})
        if not include_inactive:
            qs = qs.filter(**{active_field: True})
        return qs

    def _apply_search_ordering(self, qs, *, search_fields: list[str], default_ordering: str):
        params = self.request.query_params
        search = (params.get("search") or "").strip()
        if search and search_fields:
            q = Q()
            for field in search_fields:
                q |= Q(**{f"{field}__icontains": search})
            qs = qs.filter(q)

        ordering = (params.get("ordering") or default_ordering).strip()
        allowed = {
            "name",
            "-name",
            "created_at",
            "-created_at",
            "updated_at",
            "-updated_at",
            "code",
            "-code",
            "spend_date",
            "-spend_date",
            "amount",
            "-amount",
        }
        if ordering in allowed:
            qs = qs.order_by(ordering)
        else:
            qs = qs.order_by(default_ordering)
        return qs

    def _archive_response(self, request, archive_serializer_class, detail_serializer_class):
        entity = self.get_object()
        serializer = archive_serializer_class(
            data=request.data or {},
            context={"request": request, "entity": entity},
        )
        serializer.is_valid(raise_exception=True)
        archived = serializer.save()
        return Response(detail_serializer_class(archived).data)


class ChannelViewSet(HierarchyViewSetMixin, viewsets.ModelViewSet):
    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permission_required("marketing.view_marketingchannel", allow_admin_manager=True)()]
        if self.action == "create":
            return [permission_required("marketing.add_marketingchannel", allow_admin_manager=True)()]
        if self.action in ("partial_update", "archive"):
            return [permission_required("marketing.change_marketingchannel", allow_admin_manager=True)()]
        return [permission_required("marketing.view_marketingchannel", allow_admin_manager=True)()]

    def get_queryset(self):
        qs = MarketingChannel.objects.all()
        qs = self._apply_active_filters(qs)
        return self._apply_search_ordering(
            qs, search_fields=["name", "code", "description"], default_ordering="name"
        )

    def get_serializer_class(self):
        if self.action == "list":
            return ser.ChannelListSerializer
        if self.action == "create":
            return ser.ChannelCreateSerializer
        if self.action == "partial_update":
            return ser.ChannelUpdateSerializer
        if self.action == "archive":
            return ser.ChannelArchiveSerializer
        return ser.ChannelDetailSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.ChannelDetailSerializer(obj).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.ChannelDetailSerializer(obj).data)

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        return self._archive_response(request, ser.ChannelArchiveSerializer, ser.ChannelDetailSerializer)


class PlatformViewSet(HierarchyViewSetMixin, viewsets.ModelViewSet):
    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permission_required("marketing.view_marketingplatform", allow_admin_manager=True)()]
        if self.action == "create":
            return [permission_required("marketing.add_marketingplatform", allow_admin_manager=True)()]
        if self.action in ("partial_update", "archive"):
            return [permission_required("marketing.change_marketingplatform", allow_admin_manager=True)()]
        return [permission_required("marketing.view_marketingplatform", allow_admin_manager=True)()]

    def get_queryset(self):
        qs = MarketingPlatform.objects.select_related("channel").all()
        qs = self._apply_active_filters(qs)
        params = self.request.query_params
        if self.action == "list" and params.get("channel"):
            qs = qs.filter(channel_id=params["channel"])
        return self._apply_search_ordering(
            qs, search_fields=["name", "code", "description", "channel__name"], default_ordering="name"
        )

    def get_serializer_class(self):
        if self.action == "list":
            return ser.PlatformListSerializer
        if self.action == "create":
            return ser.PlatformCreateSerializer
        if self.action == "partial_update":
            return ser.PlatformUpdateSerializer
        if self.action == "archive":
            return ser.PlatformArchiveSerializer
        return ser.PlatformDetailSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.PlatformDetailSerializer(obj).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.PlatformDetailSerializer(obj).data)

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        return self._archive_response(
            request, ser.PlatformArchiveSerializer, ser.PlatformDetailSerializer
        )


class CampaignViewSet(HierarchyViewSetMixin, viewsets.ModelViewSet):
    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permission_required("marketing.view_marketingcampaign", allow_admin_manager=True)()]
        if self.action == "create":
            return [permission_required("marketing.add_marketingcampaign", allow_admin_manager=True)()]
        if self.action in ("partial_update", "archive"):
            return [permission_required("marketing.change_marketingcampaign", allow_admin_manager=True)()]
        return [permission_required("marketing.view_marketingcampaign", allow_admin_manager=True)()]

    def get_queryset(self):
        qs = MarketingCampaign.objects.select_related(
            "platform", "platform__channel", "created_by"
        ).all()
        qs = self._apply_active_filters(qs)
        params = self.request.query_params
        if self.action == "list":
            if params.get("platform"):
                qs = qs.filter(platform_id=params["platform"])
            if params.get("channel"):
                qs = qs.filter(platform__channel_id=params["channel"])
            if params.get("status"):
                qs = qs.filter(status=params["status"])
        return self._apply_search_ordering(
            qs,
            search_fields=["name", "code", "description", "platform__name"],
            default_ordering="-created_at",
        )

    def get_serializer_class(self):
        if self.action == "list":
            return ser.CampaignListSerializer
        if self.action == "create":
            return ser.CampaignCreateSerializer
        if self.action == "partial_update":
            return ser.CampaignUpdateSerializer
        if self.action == "archive":
            return ser.CampaignArchiveSerializer
        return ser.CampaignDetailSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.CampaignDetailSerializer(obj).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.CampaignDetailSerializer(obj).data)

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        return self._archive_response(
            request, ser.CampaignArchiveSerializer, ser.CampaignDetailSerializer
        )


class AdSetViewSet(HierarchyViewSetMixin, viewsets.ModelViewSet):
    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permission_required("marketing.view_marketingadset", allow_admin_manager=True)()]
        if self.action == "create":
            return [permission_required("marketing.add_marketingadset", allow_admin_manager=True)()]
        if self.action in ("partial_update", "archive"):
            return [permission_required("marketing.change_marketingadset", allow_admin_manager=True)()]
        return [permission_required("marketing.view_marketingadset", allow_admin_manager=True)()]

    def get_queryset(self):
        qs = MarketingAdSet.objects.select_related("campaign", "campaign__platform").all()
        qs = self._apply_active_filters(qs)
        params = self.request.query_params
        if self.action == "list" and params.get("campaign"):
            qs = qs.filter(campaign_id=params["campaign"])
        return self._apply_search_ordering(
            qs, search_fields=["name", "external_reference", "campaign__name"], default_ordering="name"
        )

    def get_serializer_class(self):
        if self.action == "list":
            return ser.AdSetListSerializer
        if self.action == "create":
            return ser.AdSetCreateSerializer
        if self.action == "partial_update":
            return ser.AdSetUpdateSerializer
        if self.action == "archive":
            return ser.AdSetArchiveSerializer
        return ser.AdSetDetailSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.AdSetDetailSerializer(obj).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.AdSetDetailSerializer(obj).data)

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        return self._archive_response(request, ser.AdSetArchiveSerializer, ser.AdSetDetailSerializer)


class AdvertisementViewSet(HierarchyViewSetMixin, viewsets.ModelViewSet):
    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [
                permission_required("marketing.view_marketingadvertisement", allow_admin_manager=True)()
            ]
        if self.action == "create":
            return [
                permission_required("marketing.add_marketingadvertisement", allow_admin_manager=True)()
            ]
        if self.action in ("partial_update", "archive"):
            return [
                permission_required(
                    "marketing.change_marketingadvertisement", allow_admin_manager=True
                )()
            ]
        return [
            permission_required("marketing.view_marketingadvertisement", allow_admin_manager=True)()
        ]

    def get_queryset(self):
        qs = MarketingAdvertisement.objects.select_related(
            "campaign", "ad_set", "campaign__platform"
        ).all()
        qs = self._apply_active_filters(qs)
        params = self.request.query_params
        if self.action == "list":
            if params.get("campaign"):
                qs = qs.filter(campaign_id=params["campaign"])
            if params.get("ad_set"):
                qs = qs.filter(ad_set_id=params["ad_set"])
        return self._apply_search_ordering(
            qs,
            search_fields=["name", "external_reference", "creative_reference", "campaign__name"],
            default_ordering="name",
        )

    def get_serializer_class(self):
        if self.action == "list":
            return ser.AdvertisementListSerializer
        if self.action == "create":
            return ser.AdvertisementCreateSerializer
        if self.action == "partial_update":
            return ser.AdvertisementUpdateSerializer
        if self.action == "archive":
            return ser.AdvertisementArchiveSerializer
        return ser.AdvertisementDetailSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.AdvertisementDetailSerializer(obj).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.AdvertisementDetailSerializer(obj).data)

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        return self._archive_response(
            request, ser.AdvertisementArchiveSerializer, ser.AdvertisementDetailSerializer
        )


class CampaignSpendViewSet(HierarchyViewSetMixin, viewsets.ModelViewSet):
    """
    CampaignSpend CRUD without archive (model has no inactivation field).
    No Expense/Financial Control posting.
    """

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permission_required("marketing.view_campaignspend", allow_admin_manager=True)()]
        if self.action == "create":
            return [permission_required("marketing.add_campaignspend", allow_admin_manager=True)()]
        if self.action == "partial_update":
            return [permission_required("marketing.change_campaignspend", allow_admin_manager=True)()]
        return [permission_required("marketing.view_campaignspend", allow_admin_manager=True)()]

    def get_queryset(self):
        qs = CampaignSpend.objects.select_related(
            "campaign",
            "ad_set",
            "advertisement",
            "created_by",
        ).all()
        # No is_active — skip active filters
        if self.action in ("retrieve", "partial_update"):
            return qs

        params = self.request.query_params
        if params.get("campaign"):
            qs = qs.filter(campaign_id=params["campaign"])
        if params.get("ad_set"):
            qs = qs.filter(ad_set_id=params["ad_set"])
        if params.get("advertisement"):
            qs = qs.filter(advertisement_id=params["advertisement"])
        if params.get("spend_date_after"):
            qs = qs.filter(spend_date__gte=params["spend_date_after"])
        if params.get("spend_date_before"):
            qs = qs.filter(spend_date__lte=params["spend_date_before"])

        return self._apply_search_ordering(
            qs,
            search_fields=["description", "external_reference", "campaign__name"],
            default_ordering="-spend_date",
        )

    def get_serializer_class(self):
        if self.action == "list":
            return ser.CampaignSpendListSerializer
        if self.action == "create":
            return ser.CampaignSpendCreateSerializer
        if self.action == "partial_update":
            return ser.CampaignSpendUpdateSerializer
        return ser.CampaignSpendDetailSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.CampaignSpendDetailSerializer(obj).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ser.CampaignSpendDetailSerializer(obj).data)
