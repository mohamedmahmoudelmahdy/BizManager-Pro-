import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Loader2, Search, ArrowRightLeft, Eye, Pencil, Trash2 } from 'lucide-react';
import { fetchDeposits, type DepositApi } from '@/app/lib/operationalFinanceApi';
import { useData } from '@/app/contexts/DataContext';
import { SectionHeader } from '@/app/components/financial-control/components/SectionHeader';
import { SectionCard } from '@/app/components/financial-control/components/SectionCard';
import { KpiCard } from '@/app/components/financial-control/components/KpiCard';
import { CurrencyAmount } from '@/app/components/financial-control/components/CurrencyAmount';
import { FinancialStatusBadge } from '@/app/components/financial-control/components/FinancialStatusBadge';
import { EmptyFinancialState } from '@/app/components/financial-control/components/EmptyFinancialState';
import { AddTransferModal } from '@/app/components/financial-control/modals/AddTransferModal';
import { fmtAed, num } from '@/app/components/financial-control/utils/format';

export function TransfersPage() {
  const { t, i18n } = useTranslation();
  const { bankCards, refreshBankCards } = useData();
  const [transfers, setTransfers] = useState<DepositApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fromFilter, setFromFilter] = useState('all');
  const [toFilter, setToFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [detail, setDetail] = useState<DepositApi | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTransfers(await fetchDeposits());
      await refreshBankCards();
    } finally {
      setLoading(false);
    }
  }, [refreshBankCards]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return transfers.filter((tr) => {
      if (fromFilter !== 'all' && tr.from_method !== fromFilter) return false;
      if (toFilter !== 'all' && tr.to_method !== toFilter) return false;
      if (dateFrom && tr.date < dateFrom) return false;
      if (dateTo && tr.date > dateTo) return false;
      if (
        q &&
        !tr.notes?.toLowerCase().includes(q) &&
        !tr.from_method_name?.toLowerCase().includes(q) &&
        !tr.to_method_name?.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [transfers, search, fromFilter, toFilter, dateFrom, dateTo]);

  const monthPrefix = new Date().toISOString().slice(0, 7);
  const monthVolume = transfers
    .filter((tr) => tr.date.startsWith(monthPrefix))
    .reduce((s, tr) => s + num(tr.amount), 0);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader title={t('financialControl.nav.transfers')} subtitle={t('financialControl.transfers.subtitle')}>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg"
        >
          <Plus className="size-4" />
          {t('financialControl.transfers.addTransfer')}
        </button>
      </SectionHeader>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard label={t('financialControl.transfers.count')} value={String(transfers.length)} icon={<ArrowRightLeft className="size-4 text-blue-600" />} iconBg="bg-blue-50" />
        <KpiCard label={t('financialControl.transfers.monthVolume')} value={fmtAed(monthVolume, i18n.language)} />
        <KpiCard label={t('financialControl.transfers.statusNote')} value={t('financialControl.transfers.posted')} />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute start-3 top-2.5 size-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('financialControl.transfers.search')}
            className="w-full ps-9 pe-3 py-2 border rounded-lg text-sm"
          />
        </div>
        <input type="date" className="border rounded-lg px-2 py-2 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" className="border rounded-lg px-2 py-2 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <select className="border rounded-lg px-2 py-2 text-sm bg-white" value={fromFilter} onChange={(e) => setFromFilter(e.target.value)}>
          <option value="all">{t('financialControl.transfers.allFrom')}</option>
          {bankCards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.bankName}
            </option>
          ))}
        </select>
        <select className="border rounded-lg px-2 py-2 text-sm bg-white" value={toFilter} onChange={(e) => setToFilter(e.target.value)}>
          <option value="all">{t('financialControl.transfers.allTo')}</option>
          {bankCards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.bankName}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyFinancialState message={t('financialControl.transfers.empty')} />
      ) : (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                  <th className="px-4 py-3 text-start">{t('financialControl.expenses.date')}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.transfers.from')}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.transfers.to')}</th>
                  <th className="px-4 py-3 text-end">{t('financialControl.ledger.amount')}</th>
                  <th className="px-4 py-3 text-center">{t('common.status', { defaultValue: 'Status' })}</th>
                  <th className="px-4 py-3 text-end">{t('common.view')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((tr) => (
                  <tr key={tr.id} className="hover:bg-slate-50 group">
                    <td className="px-4 py-3 text-xs"><bdi>{tr.date}</bdi></td>
                    <td className="px-4 py-3 text-xs font-medium">{tr.from_method_name}</td>
                    <td className="px-4 py-3 text-xs font-medium">{tr.to_method_name}</td>
                    <td className="px-4 py-3 text-end">
                      <CurrencyAmount value={tr.amount} className="font-bold font-mono" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <FinancialStatusBadge status="posted" />
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => setDetail(tr)} className="p-1.5 rounded hover:bg-slate-100">
                          <Eye className="size-4 text-slate-400" />
                        </button>
                        <button type="button" disabled className="p-1.5 rounded opacity-40 cursor-not-allowed" title={t('financialControl.transfers.editDisabled')}>
                          <Pencil className="size-4 text-slate-300" />
                        </button>
                        <button type="button" disabled className="p-1.5 rounded opacity-40 cursor-not-allowed" title={t('financialControl.transfers.deleteDisabled')}>
                          <Trash2 className="size-4 text-slate-300" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setDetail(null)} />
          <div className="relative w-full max-w-md bg-white shadow-2xl h-full flex flex-col p-5 space-y-4">
            <h3 className="font-bold">{t('financialControl.transfers.detailTitle')}</h3>
            <CurrencyAmount value={detail.amount} className="text-2xl font-bold" />
            <div className="text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">{t('financialControl.transfers.from')}</span>
                <span className="font-medium">{detail.from_method_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('financialControl.transfers.to')}</span>
                <span className="font-medium">{detail.to_method_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('financialControl.expenses.date')}</span>
                <bdi>{detail.date}</bdi>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('common.status', { defaultValue: 'Status' })}</span>
                <FinancialStatusBadge status="posted" />
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('financialControl.ledger.notes')}</span>
                <span>{detail.notes || '—'}</span>
              </div>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              {t('financialControl.transfers.editDisabled')}
            </p>
          </div>
        </div>
      )}

      <AddTransferModal open={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} />
    </div>
  );
}
