import React from 'react';
import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  BookOpen,
  CreditCard,
  CheckSquare,
  Receipt,
  Users,
  Scale,
  ArrowLeftRight,
  BarChart3,
  FileSpreadsheet,
} from 'lucide-react';
import { cn } from '@/app/components/ui/utils';

const TABS = [
  { to: 'overview', labelKey: 'financialControl.nav.overview', icon: Activity },
  { to: 'payment-methods', labelKey: 'financialControl.nav.paymentMethods', icon: CreditCard },
  { to: 'ledger-accounts', labelKey: 'financialControl.nav.ledgerAccounts', icon: BookOpen },
  { to: 'checks', labelKey: 'financialControl.nav.checks', icon: CheckSquare },
  { to: 'expenses', labelKey: 'financialControl.nav.expenses', icon: Receipt },
  { to: 'employee-financials', labelKey: 'financialControl.nav.employeeFinancials', icon: Users },
  { to: 'debts', labelKey: 'financialControl.nav.debts', icon: Scale },
  { to: 'transfers', labelKey: 'financialControl.nav.transfers', icon: ArrowLeftRight },
  { to: 'reports', labelKey: 'financialControl.nav.reports', icon: BarChart3 },
  { to: 'excel-import', labelKey: 'financialControl.nav.excelImport', icon: FileSpreadsheet },
] as const;

export function FinancialControlLayout() {
  const { t } = useTranslation();
  const location = useLocation();

  if (location.pathname === '/financial-control' || location.pathname === '/financial-control/') {
    return <Navigate to="/financial-control/overview" replace />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('financialControl.title')}</h1>
        <p className="text-slate-500 mt-1">{t('financialControl.subtitle')}</p>
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {TABS.map(({ to, labelKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={`/financial-control/${to}`}
            end={to !== 'payment-methods'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              )
            }
          >
            <Icon className="size-4 flex-shrink-0" />
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
