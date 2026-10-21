import React, { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { FinancialControlLayout } from '@/app/components/financial-control/FinancialControlLayout';
const OverviewPage = lazy(() =>
  import('@/app/pages/financial-control/OverviewPage').then((m) => ({ default: m.OverviewPage }))
);
const PaymentMethodsPage = lazy(() =>
  import('@/app/pages/PaymentMethodsPage').then((m) => ({ default: m.PaymentMethodsPage }))
);
const PaymentMethodStatementPage = lazy(() =>
  import('@/app/pages/financial-control/PaymentMethodStatementPage').then((m) => ({
    default: m.PaymentMethodStatementPage,
  }))
);
const LedgerAccountsPage = lazy(() =>
  import('@/app/pages/financial-control/LedgerAccountsPage').then((m) => ({
    default: m.LedgerAccountsPage,
  }))
);
const LedgerProfilePage = lazy(() =>
  import('@/app/pages/financial-control/LedgerProfilePage').then((m) => ({
    default: m.LedgerProfilePage,
  }))
);
const ChecksPage = lazy(() =>
  import('@/app/pages/financial-control/ChecksPage').then((m) => ({ default: m.ChecksPage }))
);
const DebtsPage = lazy(() =>
  import('@/app/pages/financial-control/DebtsPage').then((m) => ({ default: m.DebtsPage }))
);
const ExpensesPage = lazy(() =>
  import('@/app/pages/financial-control/ExpensesPage').then((m) => ({ default: m.ExpensesPage }))
);
const TransfersPage = lazy(() =>
  import('@/app/pages/financial-control/TransfersPage').then((m) => ({ default: m.TransfersPage }))
);
const EmployeeFinancialsPage = lazy(() =>
  import('@/app/pages/financial-control/EmployeeFinancialsPage').then((m) => ({
    default: m.EmployeeFinancialsPage,
  }))
);
const ReportsPage = lazy(() =>
  import('@/app/pages/financial-control/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const ExcelImportPage = lazy(() =>
  import('@/app/pages/financial-control/ExcelImportPage').then((m) => ({ default: m.ExcelImportPage }))
);

function Loading() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="size-8 animate-spin text-slate-400" />
    </div>
  );
}

export function FinancialControlRoutes() {
  return (
    <Routes>
      <Route element={<FinancialControlLayout />}>
        <Route
          path="overview"
          element={
            <Suspense fallback={<Loading />}>
              <OverviewPage />
            </Suspense>
          }
        />
        <Route
          path="payment-methods"
          element={
            <Suspense fallback={<Loading />}>
              <PaymentMethodsPage />
            </Suspense>
          }
        />
        <Route
          path="payment-methods/:id"
          element={
            <Suspense fallback={<Loading />}>
              <PaymentMethodStatementPage />
            </Suspense>
          }
        />
        <Route
          path="ledger-accounts"
          element={
            <Suspense fallback={<Loading />}>
              <LedgerAccountsPage />
            </Suspense>
          }
        />
        <Route
          path="ledger-accounts/:accountId"
          element={
            <Suspense fallback={<Loading />}>
              <LedgerProfilePage />
            </Suspense>
          }
        />
        <Route
          path="checks"
          element={
            <Suspense fallback={<Loading />}>
              <ChecksPage />
            </Suspense>
          }
        />
        <Route
          path="expenses"
          element={
            <Suspense fallback={<Loading />}>
              <ExpensesPage />
            </Suspense>
          }
        />
        <Route
          path="employee-financials"
          element={
            <Suspense fallback={<Loading />}>
              <EmployeeFinancialsPage />
            </Suspense>
          }
        />
        <Route
          path="debts"
          element={
            <Suspense fallback={<Loading />}>
              <DebtsPage />
            </Suspense>
          }
        />
        <Route
          path="transfers"
          element={
            <Suspense fallback={<Loading />}>
              <TransfersPage />
            </Suspense>
          }
        />
        <Route
          path="reports"
          element={
            <Suspense fallback={<Loading />}>
              <ReportsPage />
            </Suspense>
          }
        />
        <Route
          path="excel-import"
          element={
            <Suspense fallback={<Loading />}>
              <ExcelImportPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
