import React, { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth, homePathForRole, type UserRole } from '@/app/contexts/AuthContext';
import { DataProvider } from '@/app/contexts/DataContext';
import { Toaster } from '@/app/components/ui/sonner';
import { Sidebar } from '@/app/components/layout/Sidebar';
import { TopBar } from '@/app/components/layout/TopBar';
import { LoginPage } from '@/app/pages/LoginPage';
import { Loader2 } from 'lucide-react';
import { EXPENSE_MODULE_ENTRY_PERMISSIONS } from '@/app/lib/expensePermissions';
import { ATTESTATION_MODULE_ENTRY_PERMISSIONS } from '@/app/lib/attestationPermissions';
import { HRPortalLayout } from '@/app/pages/hr/HRPortalLayout';
import { HRAttestationDashboardPage } from '@/app/pages/hr/HRAttestationDashboardPage';
import { HRAttestationDetailPage } from '@/app/pages/hr/HRAttestationDetailPage';
import { PublicAttestationApplyPage } from '@/app/pages/public/PublicAttestationApplyPage';

const DashboardPage = lazy(() =>
  import('@/app/pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const CustomersPage = lazy(() =>
  import('@/app/pages/CustomersPage').then((m) => ({ default: m.CustomersPage }))
);
const ProceduresPage = lazy(() =>
  import('@/app/pages/ProceduresPage').then((m) => ({ default: m.ProceduresPage }))
);
const PaymentsPage = lazy(() =>
  import('@/app/pages/PaymentsPage').then((m) => ({ default: m.PaymentsPage }))
);
const CustomerFinancialsPage = lazy(() =>
  import('@/app/pages/CustomerFinancialsPage').then((m) => ({ default: m.CustomerFinancialsPage }))
);
const CustomerProfilePage = lazy(() =>
  import('@/app/pages/CustomerProfilePage').then((m) => ({ default: m.CustomerProfilePage }))
);
const EmployeeLogPage = lazy(() =>
  import('@/app/pages/EmployeeLogPage').then((m) => ({ default: m.EmployeeLogPage }))
);
const ExpensesPage = lazy(() =>
  import('@/app/pages/ExpensesPage').then((m) => ({ default: m.ExpensesPage }))
);
const ExpensesHubPage = lazy(() =>
  import('@/app/pages/expenses/ExpensesHubPage').then((m) => ({ default: m.ExpensesHubPage }))
);
const ExpenseFormPage = lazy(() =>
  import('@/app/pages/expenses/ExpenseFormPage').then((m) => ({ default: m.ExpenseFormPage }))
);
const ExpenseDetailPage = lazy(() =>
  import('@/app/pages/expenses/ExpenseDetailPage').then((m) => ({ default: m.ExpenseDetailPage }))
);
const ReportsPage = lazy(() =>
  import('@/app/pages/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const SettingsPage = lazy(() =>
  import('@/app/pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);
const CompanyProfilePage = lazy(() =>
  import('@/app/pages/CompanyProfilePage').then((m) => ({ default: m.CompanyProfilePage }))
);
const AttestationWorkspacePage = lazy(() =>
  import('@/app/pages/attestation/AttestationWorkspacePage').then((m) => ({
    default: m.AttestationWorkspacePage,
  }))
);
const AttestationApplicationDetailPage = lazy(() =>
  import('@/app/pages/attestation/AttestationApplicationDetailPage').then((m) => ({
    default: m.AttestationApplicationDetailPage,
  }))
);

const FinancialControlRoutes = lazy(() =>
  import('@/app/pages/financial-control/FinancialControlRoutes').then((m) => ({
    default: m.FinancialControlRoutes,
  }))
);

const MarketingRoutes = lazy(() =>
  import('@/app/pages/marketing/MarketingRoutes').then((m) => ({
    default: m.MarketingRoutes,
  }))
);

function RouteFallback() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="size-8 animate-spin text-slate-400" />
    </div>
  );
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <>{children}</> : <Navigate to="/" replace />;
}

function RoleRoute({ children, roles }: { children: React.ReactNode; roles: UserRole[] }) {
  const { user, loading, isAuthorized } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (!isAuthorized(roles)) return <Navigate to={homePathForRole(user.role)} replace />;
  return <>{children}</>;
}

/** Role allow-list + optional permission gate (admin/manager bypass). */
function PermissionRoute({
  children,
  roles,
  anyOfPermissions,
}: {
  children: React.ReactNode;
  roles: UserRole[];
  anyOfPermissions?: readonly string[];
}) {
  const { user, loading, isAuthorized, hasAnyPermission } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (!isAuthorized(roles)) return <Navigate to={homePathForRole(user.role)} replace />;
  if (
    anyOfPermissions?.length &&
    !hasAnyPermission([...anyOfPermissions], { allowAdminManager: true })
  ) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }
  return <>{children}</>;
}

/** Blocks Marketers from non-Marketing modules; other roles pass through. */
function NonMarketerRoute({ children }: { children: React.ReactNode }) {
  return (
    <RoleRoute roles={['admin', 'manager', 'employee', 'cashier']}>
      {children}
    </RoleRoute>
  );
}

function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, loading } = useAuth();

  if (loading) return null;
  if (user?.role === 'hr_client') {
    return <Navigate to="/hr/attestation" replace />;
  }

  return (
    <div className="h-screen flex overflow-hidden bg-slate-50">
      <Sidebar isCollapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} />
      
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <TopBar />
        
        <main className="flex-1 min-h-0 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto w-full min-w-0">
            <Routes>
              <Route
                path="/dashboard"
                element={
                  <NonMarketerRoute>
                    <LazyPage>
                      <DashboardPage />
                    </LazyPage>
                  </NonMarketerRoute>
                }
              />
              <Route
                path="/customers"
                element={
                  <NonMarketerRoute>
                    <LazyPage>
                      <CustomersPage />
                    </LazyPage>
                  </NonMarketerRoute>
                }
              />
              <Route
                path="/customers/financials"
                element={
                  <RoleRoute roles={['admin', 'manager', 'employee', 'cashier']}>
                    <LazyPage>
                      <CustomerFinancialsPage />
                    </LazyPage>
                  </RoleRoute>
                }
              />
              <Route
                path="/customers/:id"
                element={
                  <NonMarketerRoute>
                    <LazyPage>
                      <CustomerProfilePage />
                    </LazyPage>
                  </NonMarketerRoute>
                }
              />
              <Route
                path="/procedures"
                element={
                  <NonMarketerRoute>
                    <LazyPage>
                      <ProceduresPage />
                    </LazyPage>
                  </NonMarketerRoute>
                }
              />
              <Route
                path="/payments"
                element={
                  <NonMarketerRoute>
                    <LazyPage>
                      <PaymentsPage />
                    </LazyPage>
                  </NonMarketerRoute>
                }
              />
              <Route path="/financials" element={<Navigate to="/customers/financials" replace />} />
              <Route path="/payment-methods" element={<Navigate to="/financial-control/payment-methods" replace />} />
              <Route
                path="/financial-control/*"
                element={
                  <RoleRoute roles={['admin', 'manager', 'cashier']}>
                    <LazyPage>
                      <FinancialControlRoutes />
                    </LazyPage>
                  </RoleRoute>
                }
              />
              <Route
                path="/marketing/*"
                element={
                  <ProtectedRoute>
                    <LazyPage>
                      <MarketingRoutes />
                    </LazyPage>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/employee-log"
                element={
                  <RoleRoute roles={['admin', 'manager']}>
                    <LazyPage>
                      <EmployeeLogPage />
                    </LazyPage>
                  </RoleRoute>
                }
              />
              <Route
                path="/expenses"
                element={
                  <PermissionRoute
                    roles={['admin', 'manager', 'employee']}
                    anyOfPermissions={EXPENSE_MODULE_ENTRY_PERMISSIONS}
                  >
                    <LazyPage>
                      <ExpensesHubPage />
                    </LazyPage>
                  </PermissionRoute>
                }
              />
              <Route
                path="/expenses/new"
                element={
                  <PermissionRoute
                    roles={['admin', 'manager', 'employee']}
                    anyOfPermissions={EXPENSE_MODULE_ENTRY_PERMISSIONS}
                  >
                    <LazyPage>
                      <ExpenseFormPage />
                    </LazyPage>
                  </PermissionRoute>
                }
              />
              <Route
                path="/expenses/operational"
                element={
                  <RoleRoute roles={['admin', 'manager']}>
                    <LazyPage>
                      <ExpensesPage />
                    </LazyPage>
                  </RoleRoute>
                }
              />
              <Route
                path="/expenses/review"
                element={<Navigate to="/expenses?tab=review" replace />}
              />
              <Route
                path="/expenses/:expenseId/edit"
                element={
                  <PermissionRoute
                    roles={['admin', 'manager', 'employee']}
                    anyOfPermissions={EXPENSE_MODULE_ENTRY_PERMISSIONS}
                  >
                    <LazyPage>
                      <ExpenseFormPage />
                    </LazyPage>
                  </PermissionRoute>
                }
              />
              <Route
                path="/expenses/:expenseId"
                element={
                  <PermissionRoute
                    roles={['admin', 'manager', 'employee']}
                    anyOfPermissions={EXPENSE_MODULE_ENTRY_PERMISSIONS}
                  >
                    <LazyPage>
                      <ExpenseDetailPage />
                    </LazyPage>
                  </PermissionRoute>
                }
              />
              <Route
                path="/attestation"
                element={
                  <PermissionRoute
                    roles={['admin', 'manager', 'employee']}
                    anyOfPermissions={ATTESTATION_MODULE_ENTRY_PERMISSIONS}
                  >
                    <LazyPage>
                      <AttestationWorkspacePage />
                    </LazyPage>
                  </PermissionRoute>
                }
              />
              <Route
                path="/attestation/applications"
                element={<Navigate to="/attestation" replace />}
              />
              <Route
                path="/attestation/applications/:applicationId"
                element={
                  <PermissionRoute
                    roles={['admin', 'manager', 'employee']}
                    anyOfPermissions={ATTESTATION_MODULE_ENTRY_PERMISSIONS}
                  >
                    <LazyPage>
                      <AttestationApplicationDetailPage />
                    </LazyPage>
                  </PermissionRoute>
                }
              />
              <Route
                path="/reports"
                element={
                  <RoleRoute roles={['admin', 'manager']}>
                    <LazyPage>
                      <ReportsPage />
                    </LazyPage>
                  </RoleRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <RoleRoute roles={['admin']}>
                    <LazyPage>
                      <SettingsPage />
                    </LazyPage>
                  </RoleRoute>
                }
              />
              <Route
                path="*"
                element={<Navigate to={homePathForRole(user?.role)} replace />}
              />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DataProvider>
          <Routes>
            <Route path="/" element={<LoginPage />} />
            <Route
              path="/attestation/apply/:customerSlug"
              element={<PublicAttestationApplyPage />}
            />
            <Route
              path="/attestation/apply"
              element={<PublicAttestationApplyPage />}
            />
            <Route
              path="/customers/company/:companyId"
              element={
                <LazyPage>
                  <CompanyProfilePage />
                </LazyPage>
              }
            />
            <Route path="/hr" element={<HRPortalLayout />}>
              <Route index element={<Navigate to="/hr/attestation" replace />} />
              <Route path="attestation" element={<HRAttestationDashboardPage />} />
              <Route path="attestation/:applicationId" element={<HRAttestationDetailPage />} />
            </Route>
            <Route path="/*" element={<AppLayout />} />
          </Routes>
          <Toaster />
        </DataProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
