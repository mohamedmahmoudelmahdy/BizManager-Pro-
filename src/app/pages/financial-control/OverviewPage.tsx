import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Wallet,
  CheckSquare,
  Receipt,
  Scale,
  Shield,
  Activity,
  Loader2,
  BookOpen,
  HandCoins,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  fetchFinancialAlerts,
  fetchFinancialOverview,
  type FinancialAlert,
  type FinancialOverview,
} from '@/app/lib/financialControlApi';
import { ApiError } from '@/app/lib/api';
import { KpiCard } from '@/app/components/financial-control/components/KpiCard';
import { SectionCard } from '@/app/components/financial-control/components/SectionCard';
import { FinancialStatusBadge } from '@/app/components/financial-control/components/FinancialStatusBadge';
import { fmtAedCompact } from '@/app/components/financial-control/utils/format';

export function OverviewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<FinancialOverview | null>(null);
  const [alerts, setAlerts] = useState<FinancialAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<{ status?: number; endpoint?: string; detail?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      setErrorInfo(null);
      try {
        const [ov, al] = await Promise.all([fetchFinancialOverview(), fetchFinancialAlerts()]);
        if (!cancelled) {
          setOverview(ov);
          setAlerts(al);
        }
      } catch (e) {
        if (!cancelled) {
          setError(true);
          if (e instanceof ApiError) {
            setErrorInfo({ status: e.status, endpoint: e.endpoint, detail: e.detail });
          } else if (e instanceof Error) {
            setErrorInfo({ detail: e.message });
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-16 gap-2 text-slate-500">
        <Loader2 className="size-6 animate-spin" />
        <span className="text-sm">{t('common.loading')}</span>
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-4 py-3 space-y-1">
        <p>{t('financialControl.shell.loadError')}</p>
        {errorInfo && (errorInfo.status || errorInfo.endpoint || errorInfo.detail) && (
          <p className="text-xs text-rose-400 font-mono break-all">
            {errorInfo.status ? `HTTP ${errorInfo.status}` : 'Network error'}
            {errorInfo.endpoint ? ` · ${errorInfo.endpoint}` : ''}
            {errorInfo.detail ? ` · ${errorInfo.detail}` : ''}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={t('financialControl.overview.totalCashBank')}
          value={fmtAedCompact(overview.total_cash_bank)}
          icon={<Wallet className="size-4 text-emerald-600" />}
          iconBg="bg-emerald-50"
        />
        <KpiCard
          label={t('financialControl.overview.pendingChecks')}
          value={fmtAedCompact(overview.pending_checks_total)}
          sub={String(overview.pending_checks_count)}
          icon={<CheckSquare className="size-4 text-orange-600" />}
          iconBg="bg-orange-50"
          warn={overview.pending_checks_count > 0}
          onClick={() => navigate('/financial-control/checks')}
        />
        <KpiCard
          label={t('financialControl.overview.monthExpenses')}
          value={fmtAedCompact(overview.month_expenses_total)}
          icon={<Receipt className="size-4 text-rose-600" />}
          iconBg="bg-rose-50"
          onClick={() => navigate('/financial-control/expenses')}
        />
        <KpiCard
          label={t('financialControl.overview.openDebts')}
          value={fmtAedCompact(overview.open_debts_total)}
          sub={String(overview.open_debts_count)}
          icon={<Scale className="size-4 text-violet-600" />}
          iconBg="bg-violet-50"
          onClick={() => navigate('/financial-control/debts')}
        />
        <KpiCard
          label={t('financialControl.advances.outstandingTotal')}
          value={fmtAedCompact(overview.employee_advances_total)}
          sub={String(overview.employee_advances_count)}
          icon={<HandCoins className="size-4 text-rose-600" />}
          iconBg="bg-rose-50"
          warn={overview.employee_advances_count > 0}
          onClick={() => navigate('/financial-control/employee-financials')}
        />
        <KpiCard
          label={t('financialControl.overview.netPosition')}
          value={fmtAedCompact(overview.net_business_position)}
          icon={<Activity className="size-4 text-indigo-600" />}
          iconBg="bg-indigo-50"
        />
        <KpiCard
          label={t('financialControl.overview.alerts')}
          value={String(overview.alerts_count)}
          icon={<Shield className="size-4 text-red-600" />}
          iconBg="bg-red-50"
          warn={overview.alerts_count > 0}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <SectionCard title={t('financialControl.overview.alerts')}>
            {alerts.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-400 text-center">
                {t('financialControl.overview.noAlerts')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                      <th className="px-4 py-3 text-start font-semibold">{t('financialControl.overview.alertType')}</th>
                      <th className="px-4 py-3 text-start font-semibold">{t('financialControl.overview.alertEntity')}</th>
                      <th className="px-4 py-3 text-start font-semibold">{t('financialControl.overview.alertDue')}</th>
                      <th className="px-4 py-3 text-end font-semibold">{t('financialControl.overview.alertAmount')}</th>
                      <th className="px-4 py-3 text-start font-semibold">{t('financialControl.overview.alertSeverity')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {alerts.slice(0, 12).map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-xs font-medium">{a.type.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-3 text-xs">{a.entity}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{a.due_date || '—'}</td>
                        <td className="px-4 py-3 text-end font-mono text-xs font-semibold">
                          {fmtAedCompact(a.amount)}
                        </td>
                        <td className="px-4 py-3">
                          <FinancialStatusBadge status={a.severity} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="space-y-3">
          <h3 className="font-semibold text-slate-900 text-sm px-1">
            {t('financialControl.overview.riskPanel')}
          </h3>
          {overview.risk_items.length === 0 ? (
            <p className="text-xs text-slate-400 px-1">{t('financialControl.overview.noRisks')}</p>
          ) : (
            overview.risk_items.map((r, i) => (
              <div
                key={i}
                className="rounded-xl border border-slate-100 bg-white p-3.5 text-xs shadow-sm"
              >
                <div className="font-semibold text-slate-900">{r.entity}</div>
                <div className="text-slate-500 mt-0.5">{r.description}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <SectionCard title={t('financialControl.overview.expenseTrend')}>
            <div className="p-4 h-[220px]">
              {overview.cashflow.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={overview.cashflow}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => fmtAedCompact(v)} />
                    <Area
                      type="monotone"
                      dataKey="expenses"
                      stroke="#EF4444"
                      fill="#FEE2E2"
                      fillOpacity={0.5}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-slate-400 text-center py-8">{t('financialControl.overview.noChart')}</p>
              )}
            </div>
          </SectionCard>
        </div>
        <div className="lg:col-span-2">
          <SectionCard title={t('financialControl.overview.ledgerSummary')}>
            <div className="divide-y divide-slate-50">
              {overview.ledger_accounts.length === 0 ? (
                <p className="px-4 py-6 text-sm text-slate-400 text-center">
                  {t('financialControl.ledger.empty')}
                </p>
              ) : (
                overview.ledger_accounts.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 text-start"
                    onClick={() => navigate(`/financial-control/ledger-accounts/${l.id}`)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <BookOpen className="size-3.5 text-slate-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">{l.name}</div>
                        <div className="text-xs text-slate-400">{l.account_type}</div>
                      </div>
                    </div>
                    <div className="text-end flex-shrink-0 ms-2">
                      <div className="text-sm font-bold font-mono">{fmtAedCompact(l.current_balance)}</div>
                      <FinancialStatusBadge status={l.status} />
                    </div>
                  </button>
                ))
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
