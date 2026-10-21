import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Loader2,
  Eye,
  XCircle,
  CheckSquare,
  Clock,
  Calendar,
  CheckCircle,
  AlertTriangle,
  Shield,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchChecks,
  cancelCheck,
  type CheckApi,
} from '@/app/lib/financialControlApi';
import { SectionHeader } from '@/app/components/financial-control/components/SectionHeader';
import { SectionCard } from '@/app/components/financial-control/components/SectionCard';
import { KpiCard } from '@/app/components/financial-control/components/KpiCard';
import { FinancialStatusBadge } from '@/app/components/financial-control/components/FinancialStatusBadge';
import { CurrencyAmount } from '@/app/components/financial-control/components/CurrencyAmount';
import { EmptyFinancialState } from '@/app/components/financial-control/components/EmptyFinancialState';
import { AddCheckModal } from '@/app/components/financial-control/modals/AddCheckModal';
import { DeductCheckModal } from '@/app/components/financial-control/modals/DeductCheckModal';
import { CHECK_STATUSES } from '@/app/components/financial-control/types/check';
import { fmtAed, num } from '@/app/components/financial-control/utils/format';
import { cn } from '@/app/components/ui/utils';

export function ChecksPage() {
  const { t, i18n } = useTranslation();
  const [checks, setChecks] = useState<CheckApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'table' | 'timeline'>('table');
  const [selected, setSelected] = useState<CheckApi | null>(null);
  const [deductTarget, setDeductTarget] = useState<CheckApi | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChecks(await fetchChecks());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return checks;
    return checks.filter((c) => c.status === statusFilter);
  }, [checks, statusFilter]);

  const pending = checks.filter((c) => c.status === 'pending' || c.status === 'due_soon');
  const dueSoon = checks.filter((c) => c.status === 'due_soon');
  const totalRisk = pending.reduce((s, c) => s + num(c.amount), 0);

  const handleCancel = async (c: CheckApi) => {
    if (!window.confirm(t('financialControl.checks.cancelConfirm'))) return;
    try {
      await cancelCheck(c.id);
      toast.success(t('financialControl.checks.cancelled'));
      load();
      setSelected(null);
    } catch (e: unknown) {
      toast.error((e as Error)?.message || t('financialControl.shell.loadError'));
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader title={t('financialControl.nav.checks')} subtitle={t('financialControl.checks.subtitle')}>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg"
        >
          <Plus className="size-4" />
          {t('financialControl.checks.addCheck')}
        </button>
      </SectionHeader>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <KpiCard label={t('financialControl.checks.pending')} value={String(pending.length)} icon={<CheckSquare className="size-4 text-slate-600" />} iconBg="bg-slate-50" />
        <KpiCard label={t('financialControl.status.due_soon')} value={String(dueSoon.length)} icon={<Clock className="size-4 text-orange-600" />} iconBg="bg-orange-50" warn={dueSoon.length > 0} />
        <KpiCard label={t('financialControl.checks.due30')} value={String(checks.filter((c) => c.days_until_due > 0 && c.days_until_due <= 30).length)} icon={<Calendar className="size-4 text-blue-600" />} iconBg="bg-blue-50" />
        <KpiCard label={t('financialControl.checks.deducted')} value={String(checks.filter((c) => c.status === 'deducted').length)} icon={<CheckCircle className="size-4 text-emerald-600" />} iconBg="bg-emerald-50" />
        <KpiCard label={t('financialControl.checks.bounced')} value={String(checks.filter((c) => c.status === 'bounced').length)} icon={<AlertTriangle className="size-4 text-red-600" />} iconBg="bg-red-50" warn={checks.filter((c) => c.status === 'bounced').length > 0} />
        <KpiCard label={t('financialControl.checks.riskExposure')} value={fmtAed(totalRisk, i18n.language)} icon={<Shield className="size-4 text-violet-600" />} iconBg="bg-violet-50" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-white border border-slate-200 rounded-lg p-1">
          {(['table', 'timeline'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setViewMode(m)}
              className={cn(
                'px-3 py-1.5 text-xs font-semibold rounded-md capitalize',
                viewMode === m ? 'bg-slate-900 text-white' : 'text-slate-500'
              )}
            >
              {t(`financialControl.checks.view.${m}`)}
            </button>
          ))}
        </div>
        <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">{t('financialControl.checks.filterAll')}</option>
          {CHECK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`financialControl.status.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyFinancialState message={t('financialControl.checks.empty')} />
      ) : viewMode === 'table' ? (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                  <th className="px-4 py-3 text-start">{t('financialControl.checks.dueDate')}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.checks.checkNo')}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.checks.payee')}</th>
                  <th className="px-4 py-3 text-end">{t('financialControl.ledger.amount')}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.checks.bankAccount')}</th>
                  <th className="px-4 py-3 text-start">{t('common.status', { defaultValue: 'Status' })}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.checks.risk')}</th>
                  <th className="px-4 py-3 text-end">{t('common.view')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 group">
                    <td className="px-4 py-3 text-xs">
                      <bdi>{c.due_date}</bdi>
                      {c.days_until_due > 0 && c.days_until_due <= 30 && (
                        <div className={cn('font-bold', c.days_until_due <= 7 ? 'text-red-500' : 'text-orange-500')}>
                          {c.days_until_due} {t('financialControl.checks.daysLeft')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{c.check_number}</td>
                    <td className="px-4 py-3 text-xs font-medium">{c.payee}</td>
                    <td className="px-4 py-3 text-end">
                      <CurrencyAmount value={c.amount} className="font-bold font-mono" />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{c.bank_account_name || '—'}</td>
                    <td className="px-4 py-3">
                      <FinancialStatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3">
                      <FinancialStatusBadge status={c.risk_level} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100">
                        <button type="button" onClick={() => setSelected(c)} className="p-1 rounded hover:bg-slate-100">
                          <Eye className="size-3.5 text-slate-400" />
                        </button>
                        {(c.status === 'pending' || c.status === 'due_soon') && (
                          <button
                            type="button"
                            onClick={() => setDeductTarget(c)}
                            className="px-2 py-1 bg-slate-900 text-white rounded text-xs font-semibold"
                          >
                            {t('financialControl.checks.markDeducted')}
                          </button>
                        )}
                        {c.status !== 'cancelled' && c.status !== 'deducted' && (
                          <button type="button" onClick={() => handleCancel(c)} className="p-1 rounded hover:bg-red-50">
                            <XCircle className="size-3.5 text-red-400" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : (
        <SectionCard title={t('financialControl.checks.timeline')}>
          <div className="p-4 space-y-2">
            {[...filtered]
              .sort((a, b) => a.due_date.localeCompare(b.due_date))
              .map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-xl border',
                    c.status === 'due_soon' ? 'border-orange-100 bg-orange-50' : 'border-slate-100'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{c.payee}</div>
                    <div className="text-xs text-slate-500">
                      {c.bank_account_name} · {c.check_number}
                    </div>
                  </div>
                  <div className="text-end">
                    <CurrencyAmount value={c.amount} className="font-bold text-sm" />
                    <FinancialStatusBadge status={c.status} />
                  </div>
                </div>
              ))}
          </div>
        </SectionCard>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setSelected(null)} />
          <div className="relative w-full max-w-md bg-white shadow-2xl h-full flex flex-col">
            <div className="p-5 border-b flex justify-between items-center">
              <div>
                <h3 className="font-bold">{t('financialControl.checks.checkNo')}</h3>
                <p className="text-xs font-mono text-slate-500">{selected.check_number}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="p-2 hover:bg-slate-100 rounded-lg">
                <XCircle className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <CurrencyAmount value={selected.amount} className="text-2xl font-bold" />
              <div className="flex gap-2">
                <FinancialStatusBadge status={selected.status} />
                <FinancialStatusBadge status={selected.risk_level} />
              </div>
              <p className="text-sm">
                <span className="text-slate-500">{t('financialControl.checks.payee')}: </span>
                {selected.payee}
              </p>
              <p className="text-sm">
                <span className="text-slate-500">{t('financialControl.checks.dueDate')}: </span>
                <bdi>{selected.due_date}</bdi>
              </p>
            </div>
            <div className="p-4 border-t flex flex-col gap-2">
              {(selected.status === 'pending' || selected.status === 'due_soon') && (
                <button
                  type="button"
                  onClick={() => {
                    setDeductTarget(selected);
                    setSelected(null);
                  }}
                  className="w-full py-2.5 bg-slate-900 text-white rounded-lg text-sm font-semibold"
                >
                  {t('financialControl.checks.markDeducted')}
                </button>
              )}
              {selected.status !== 'cancelled' && selected.status !== 'deducted' && (
                <button
                  type="button"
                  onClick={() => handleCancel(selected)}
                  className="py-2 border text-red-600 rounded-lg text-sm"
                >
                  {t('financialControl.checks.cancelCheck')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <AddCheckModal open={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} />
      <DeductCheckModal
        check={deductTarget}
        open={!!deductTarget}
        onClose={() => setDeductTarget(null)}
        onSuccess={load}
      />
    </div>
  );
}
