from django.urls import include, path
from rest_framework.routers import DefaultRouter

from attestation.views import (
    AttestationApplicationViewSet,
    AttestationDocumentDownloadView,
    PublicAttestationSubmitView,
)
from attestation.views_customer import (
    CustomerAttestationEnableView,
    CustomerAttestationHrUserActiveView,
    CustomerAttestationHrUsersView,
    CustomerAttestationSetActiveView,
    CustomerAttestationStatusView,
)
from attestation.views_hr import (
    HRAttestationApplicationViewSet,
    HRAttestationDocumentDownloadView,
    HRAttestationOverviewView,
)

router = DefaultRouter()
router.register(
    r"applications",
    AttestationApplicationViewSet,
    basename="attestation-applications",
)

hr_router = DefaultRouter()
hr_router.register(
    r"applications",
    HRAttestationApplicationViewSet,
    basename="hr-attestation-applications",
)

urlpatterns = [
    path(
        "public/attestation/<slug:public_slug>/applications/",
        PublicAttestationSubmitView.as_view(),
        name="public-attestation-submit",
    ),
    path(
        "customers/<uuid:customer_id>/attestation/",
        CustomerAttestationStatusView.as_view(),
        name="customer-attestation-status",
    ),
    path(
        "customers/<uuid:customer_id>/attestation/enable/",
        CustomerAttestationEnableView.as_view(),
        name="customer-attestation-enable",
    ),
    path(
        "customers/<uuid:customer_id>/attestation/set-active/",
        CustomerAttestationSetActiveView.as_view(),
        name="customer-attestation-set-active",
    ),
    path(
        "customers/<uuid:customer_id>/attestation/hr-users/",
        CustomerAttestationHrUsersView.as_view(),
        name="customer-attestation-hr-users",
    ),
    path(
        "customers/<uuid:customer_id>/attestation/hr-users/<uuid:user_id>/set-active/",
        CustomerAttestationHrUserActiveView.as_view(),
        name="customer-attestation-hr-user-active",
    ),
    path(
        "attestation/documents/<uuid:document_id>/download/",
        AttestationDocumentDownloadView.as_view(),
        name="attestation-document-download",
    ),
    path("attestation/", include(router.urls)),
    path(
        "hr/attestation/overview/",
        HRAttestationOverviewView.as_view(),
        name="hr-attestation-overview",
    ),
    path(
        "hr/attestation/documents/<uuid:document_id>/download/",
        HRAttestationDocumentDownloadView.as_view(),
        name="hr-attestation-document-download",
    ),
    path("hr/attestation/", include(hr_router.urls)),
]
