from django.urls import path
from rest_framework.routers import DefaultRouter

from marketing.views import LeadViewSet
from marketing.views_hierarchy import (
    AdSetViewSet,
    AdvertisementViewSet,
    CampaignSpendViewSet,
    CampaignViewSet,
    ChannelViewSet,
    PlatformViewSet,
)
from marketing.views_operations import (
    LeadActivityViewSet,
    LeadAssignmentViewSet,
    LeadFollowUpViewSet,
)
from marketing.views_reporting import (
    AssignmentWorkloadReportView,
    CampaignPerformanceReportView,
    FollowupWorkloadReportView,
    LeadTrendsReportView,
    OverviewReportView,
)
from marketing.views_revenue import (
    RevenueCampaignsView,
    RevenueChannelsView,
    RevenueCustomersView,
    RevenueLeadsView,
    RevenueOverviewView,
    RevenuePlatformsView,
    RevenueProcedureTypesView,
)

router = DefaultRouter()
router.register(r"leads", LeadViewSet, basename="marketing-leads")
router.register(r"channels", ChannelViewSet, basename="marketing-channels")
router.register(r"platforms", PlatformViewSet, basename="marketing-platforms")
router.register(r"campaigns", CampaignViewSet, basename="marketing-campaigns")
router.register(r"adsets", AdSetViewSet, basename="marketing-adsets")
router.register(r"advertisements", AdvertisementViewSet, basename="marketing-advertisements")
router.register(r"campaign-spend", CampaignSpendViewSet, basename="marketing-campaign-spend")
router.register(r"activities", LeadActivityViewSet, basename="marketing-activities")
router.register(r"followups", LeadFollowUpViewSet, basename="marketing-followups")
router.register(r"assignments", LeadAssignmentViewSet, basename="marketing-assignments")

urlpatterns = [
    path("reports/overview/", OverviewReportView.as_view(), name="marketing-reports-overview"),
    path(
        "reports/lead-trends/",
        LeadTrendsReportView.as_view(),
        name="marketing-reports-lead-trends",
    ),
    path(
        "reports/campaign-performance/",
        CampaignPerformanceReportView.as_view(),
        name="marketing-reports-campaign-performance",
    ),
    path(
        "reports/followup-workload/",
        FollowupWorkloadReportView.as_view(),
        name="marketing-reports-followup-workload",
    ),
    path(
        "reports/assignment-workload/",
        AssignmentWorkloadReportView.as_view(),
        name="marketing-reports-assignment-workload",
    ),
    path("revenue/overview/", RevenueOverviewView.as_view(), name="marketing-revenue-overview"),
    path("revenue/channels/", RevenueChannelsView.as_view(), name="marketing-revenue-channels"),
    path("revenue/platforms/", RevenuePlatformsView.as_view(), name="marketing-revenue-platforms"),
    path("revenue/campaigns/", RevenueCampaignsView.as_view(), name="marketing-revenue-campaigns"),
    path("revenue/leads/", RevenueLeadsView.as_view(), name="marketing-revenue-leads"),
    path("revenue/customers/", RevenueCustomersView.as_view(), name="marketing-revenue-customers"),
    path(
        "revenue/procedure-types/",
        RevenueProcedureTypesView.as_view(),
        name="marketing-revenue-procedure-types",
    ),
] + router.urls
