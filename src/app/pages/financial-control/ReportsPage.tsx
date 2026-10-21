import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2, FileBarChart } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { fetchFinancialReports, type FinancialReports } from '@/app/lib/financialControlApi';
import { SectionHeader } from '@/app/components/financial-control/components/SectionHeader';
import { SectionCard } from '@/app/components/financial-control/components/SectionCard';
import { KpiCard } from '@/app/components/financial-control/components/KpiCard';
import { CurrencyAmount } from '@/app/components/financial-control/components/CurrencyAmount';
import { FinancialStatusBadge } from '@/app/components/financial-control/components/FinancialStatusBadge';
import { fmtAed, fmtAedCompact } from '@/app/components/financial-control/utils/format';

function monthStartIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const [periodStart, setPeriodStart] = useState(monthStartIso());
  const [periodEnd, setPeriodEnd] = useState(todayIso());
  const [data, setData] = useState<FinancialReports | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchFinancialReports(periodStart, periodEnd));
    } finally {
      setLoading(false);
    }
  }, [periodStart, periodEnd]);

  useEffect(() => {
    load();
  }, [load]);

  const categoryChart = useMemo(
    () =>
      (data?.expenses_by_category ?? []).map((c) => ({
        name: t(`financialControl.expenses.categories.${c.category}`, { defaultValue: c.category }),
        total: c.total,
      })),
    [data, t]
  );

  const exportReport = () => {
    if (!data) return;
    const rows: string[][] = [
      ['Financial Control Report'],
      ['Period', `${data.period_start} to ${data.period_end}`],
      [],
      ['Summary', 'Value'],
      ['Total cash & bank', String(data.summary.total_cash_bank)],
      ['Period expenses', String(data.summary.period_expenses_total)],
      ['Payroll expenses', String(data.summary.payroll_expenses_total)],
      ['Transfer volume', String(data.summary.transfer_volume)],
      ['Pending checks', String(data.summary.pending_checks_total)],
      ['Open debts', String(data.summary.open_debts_total)],
      ['Net position', String(data.summary.net_position)],
      [],
      ['Expenses by category', 'Total', 'Count'],
      ...data.expenses_by_category.map((c) => [c.category, String(c.total), String(c.count)]),
    ];
    downloadCsv(`financial-report-${data.period_start}-${data.period_end}.csv`, rows);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-sm text-rose-600 bg-rose-50 border rounded-lg px-4 py-3">
        {t('financialControl.shell.loadError')}
      </p>
    );
  }

  const s = data.summary;

  return (
    <div className="space-y-5">
      <SectionHeader title={t('financialControl.nav.reports')} subtitle={t('financialControl.reports.subtitle')}>
        <button
          type="button"
          onClick={exportReport}
          className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm font-semibold hover:bg-slate-50"
        >
          <Download className="size-4" />
          {t('financialControl.reports.exportCsv')}
        </button>
      </SectionHeader>

      <div className="flex flex-wrap gap-2 items-center">
        <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        <span className="text-slate-400">—</span>
        <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        <p className="text-xs text-slate-500">{t('financialControl.reports.periodNote')}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label={t('financialControl.overview.totalCashBank')} value={fmtAedCompact(s.total_cash_bank)} />
        <KpiCard label={t('financialControl.reports.periodExpenses')} value={fmtAedCompact(s.period_expenses_total)} />
        <KpiCard label={t('financialControl.reports.netPosition')} value={fmtAedCompact(s.net_position)} />
        <KpiCard label={t('financialControl.reports.transfers')} value={fmtAedCompact(s.transfer_volume)} sub={String(s.transfer_count)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title={t('financialControl.reports.expensesByCategory')}>
          {categoryChart.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">{t('financialControl.reports.noData')}</p>
          ) : (
            <div className="h-64 px-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => fmtAed(v, i18n.language)} />
                  <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title={t('financialControl.reports.expenseTrend')}>
          {data.expense_trend.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">{t('financialControl.reports.noData')}</p>
          ) : (
            <div className="h-64 px-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.expense_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => fmtAed(v, i18n.language)} />
                  <Bar dataKey="total" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title={t('financialControl.reports.checksBreakdown')}>
          <table className="w-full text-sm">
            <tbody>
              {data.checks_by_status.map((c) => (
                <tr key={c.status} className="border-b border-slate-50">
                  <td className="px-4 py-2">
                    <FinancialStatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-2 text-end">{c.count}</td>
                  <td className="px-4 py-2 text-end font-mono">
                    <CurrencyAmount value={c.total} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>

        <SectionCard title={t('financialControl.reports.topDebts')}>
          {data.debts_top.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">{t('financialControl.reports.noData')}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {data.debts_top.map((d) => (
                  <tr key={d.id} className="border-b border-slate-50">
                    <td className="px-4 py-2">
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-slate-400">{d.creditor}</div>
                    </td>
                    <td className="px-4 py-2 text-end">
                      <CurrencyAmount value={d.remaining_balance} className="font-bold text-red-600" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      <SectionCard title={t('financialControl.reports.bankBalances')}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                <th className="px-4 py-3 text-start">{t('financialControl.reports.account')}</th>
                <th className="px-4 py-3 text-end">{t('financialControl.ledger.balance')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.bank_cards.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">{c.name}</td>
                  <td className="px-4 py-3 text-end">
                    <CurrencyAmount value={c.balance} className="font-bold" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <p className="text-xs text-slate-400 flex items-center gap-2">
        <FileBarChart className="size-3.5" />
        {t('financialControl.reports.liveDataNote')}
      </p>
    </div>
  );
}
