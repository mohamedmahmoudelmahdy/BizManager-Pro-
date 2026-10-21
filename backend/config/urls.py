from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path, include
from rest_framework import routers
from rest_framework_simplejwt.views import TokenRefreshView

from accounts.views_auth import ThrottledTokenObtainPairView

from accounts.views import UserViewSet, MeView, EmployeeProfileViewSet
from customers.views import CustomerFinancialAdjustmentViewSet, CustomerViewSet, CompanyEmployeeViewSet
from procedures.views import ProcedureViewSet, ProcedureCategoryViewSet
from payments.views import PaymentViewSet
from deposits.views import DepositViewSet
from banking.views import BankCardViewSet
from documents.views import DocumentViewSet, ZipDocumentsView
from expenses.views import ExpenseViewSet
from financial_control.views import (
    CheckPDCViewSet,
    DebtLiabilityViewSet,
    DebtPaymentViewSet,
    EmployeeAdvanceViewSet,
    FinancialControlAlertsView,
    FinancialControlOverviewView,
    FinancialControlReportsView,
    FinancialImportJobViewSet,
    LedgerAccountViewSet,
    LedgerEntryViewSet,
)
from dashboard.views import (
    CollectedProfitabilityReportView,
    DashboardAlertResolveView,
    DashboardSummaryView,
)

router = routers.DefaultRouter()
router.register(r"users", UserViewSet, basename="users")
router.register(r"employees", EmployeeProfileViewSet, basename="employees")
router.register(r"customers", CustomerViewSet, basename="customers")
router.register(r"customer-financial-adjustments", CustomerFinancialAdjustmentViewSet, basename="customer-financial-adjustments")
router.register(r"company-employees", CompanyEmployeeViewSet, basename="company-employees")
router.register(r"procedure-categories", ProcedureCategoryViewSet, basename="procedure-categories")
router.register(r"procedures", ProcedureViewSet, basename="procedures")
router.register(r"payments", PaymentViewSet, basename="payments")
router.register(r"deposits", DepositViewSet, basename="deposits")
router.register(r"bank-cards", BankCardViewSet, basename="bank-cards")
router.register(r"documents", DocumentViewSet, basename="documents")
router.register(r"expenses", ExpenseViewSet, basename="expenses")
router.register(r"ledger-accounts", LedgerAccountViewSet, basename="ledger-accounts")
router.register(r"ledger-entries", LedgerEntryViewSet, basename="ledger-entries")
router.register(r"checks", CheckPDCViewSet, basename="checks")
router.register(r"debts", DebtLiabilityViewSet, basename="debts")
router.register(r"debt-payments", DebtPaymentViewSet, basename="debt-payments")
router.register(r"financial-import/jobs", FinancialImportJobViewSet, basename="financial-import-jobs")
router.register(r"employee-advances", EmployeeAdvanceViewSet, basename="employee-advances")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/token/", ThrottledTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("api/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("api/me/", MeView.as_view(), name="me"),
    path("api/financial-control/overview/", FinancialControlOverviewView.as_view(), name="financial-control-overview"),
    path("api/financial-control/alerts/", FinancialControlAlertsView.as_view(), name="financial-control-alerts"),
    path("api/financial-control/reports/", FinancialControlReportsView.as_view(), name="financial-control-reports"),
    path("api/dashboard/alerts/resolve/", DashboardAlertResolveView.as_view(), name="dashboard-alerts-resolve"),
    path("api/dashboard/summary/", DashboardSummaryView.as_view(), name="dashboard-summary"),
    path(
        "api/reports/collected-profitability/",
        CollectedProfitabilityReportView.as_view(),
        name="reports-collected-profitability",
    ),
    path("api/documents/zip/<uuid:company_id>/", ZipDocumentsView.as_view(), name="documents-zip"),
    path("api/marketing/", include("marketing.urls")),
    path("api/", include("attestation.urls")),
    path("api/", include(router.urls)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
