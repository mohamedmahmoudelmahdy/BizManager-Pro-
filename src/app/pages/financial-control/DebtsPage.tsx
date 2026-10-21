import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Loader2,
  Search,
  Scale,
  AlertTriangle,
  CheckCircle,
  Calendar,
  Eye,
  Banknote,
  Pencil,
} from 'lucide-react';
import { fetchDebts, fetchDebtPayments, type DebtApi, type DebtPaymentApi } from '@/app/lib/financialControlApi';
import { SectionHeader } from '@/app/components/financial-control/components/SectionHeader';
import { SectionCard } from '@/app/components/financial-control/components/SectionCard';
import { KpiCard } from '@/app/components/financial-control/components/KpiCard';
import { FinancialStatusBadge } from '@/app/components/financial-control/components/FinancialStatusBadge';
import { CurrencyAmount } from '@/app/components/financial-control/components/CurrencyAmount';
import { EmptyFinancialState } from '@/app/components/financial-control/components/EmptyFinancialState';
import { AddDebtModal } from '@/app/components/financial-control/modals/AddDebtModal';
import { PayDebtModal } from '@/app/components/financial-control/modals/PayDebtModal';
import { fmtAed, num } from '@/app/components/financial-control/utils/format';
import { cn } from '@/app/components/ui/utils';

export function DebtsPage() {
  const { t, i18n } = useTranslation();
  const [debts, setDebts] = useState<DebtApi[]>([]);
  const [payments, setPayments] = useState<DebtPaymentApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [selected, setSelected] = useState<DebtApi | null>(null);
  const [payTarget, setPayTarget] = useState<DebtApi | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editDebt, setEditDebt] = useState<DebtApi | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p] = await Promise.all([fetchDebts(), fetchDebtPayments()]);
      setDebts(d);
      setPayments(p);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return debts.filter((d) => {
      const matchSearch =
        !q || d.name.toLowerCase().includes(q) || d.creditor.toLowerCase().includes(q);
      const matchStatus = statusFilter === 'all' || d.display_status === statusFilter;
      const matchRisk = riskFilter === 'all' || d.risk_level === riskFilter;
      return matchSearch && matchStatus && matchRisk;
    });
  }, [debts, search, statusFilter, riskFilter]);

  const openDebts = debts.filter((d) => d.display_status !== 'paid');
  const totalRemaining = openDebts.reduce((s, d) => s + num(d.remaining_balance), 0);
  const overdue = debts.filter((d) => d.display_status === 'overdue');
  const monthStart = new Date();
  monthStart.setDate(1);
  const paidMonth = payments
    .filter((p) => new Date(p.payment_date) >= monthStart)
    .reduce((s, p) => s + num(p.amount), 0);
  const upcomingInstallments = openDebts.reduce((s, d) => s + num(d.installment_amount), 0);

  const debtPayments = selected
    ? payments.filter((p) => p.debt === selected.id)
    : [];

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (selected) {
    return (
      <div className="space-y-5">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← {t('financialControl.debts.backToList')}
        </button>
        <SectionHeader title={selected.name} subtitle={selected.creditor}>
          {selected.display_status !== 'paid' && (
            <button
              type="button"
              onClick={() => setPayTarget(selected)}
              className="px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg"
            >
              {t('financialControl.debts.payDebt')}
            </button>
          )}
        </SectionHeader>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label={t('financialControl.debts.remaining')} value={fmtAed(num(selected.remaining_balance), i18n.language)} />
          <KpiCard label={t('financialControl.debts.originalAmount')} value={fmtAed(num(selected.original_amount), i18n.language)} />
          <KpiCard label={t('financialControl.debts.paidProgress')} value={`${selected.paid_percent}%`} />
          <KpiCard label={t('financialControl.checks.risk')} value={selected.risk_level} />
        </div>
        <SectionCard title={t('financialControl.debts.paymentHistory')}>
          {debtPayments.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">{t('financialControl.debts.noPayments')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                    <th className="px-4 py-3 text-start">{t('financialControl.debts.paymentDate')}</th>
                    <th className="px-4 py-3 text-end">{t('financialControl.ledger.amount')}</th>
                    <th className="px-4 py-3 text-start">{t('financialControl.debts.payFrom')}</th>
                    <th className="px-4 py-3 text-start">{t('financialControl.debts.refNo')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {debtPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3">{p.payment_date}</td>
                      <td className="px-4 py-3 text-end">
                        <CurrencyAmount value={p.amount} className="font-bold" />
                      </td>
                      <td className="px-4 py-3 text-xs">{p.payment_method_name}</td>
                      <td className="px-4 py-3 text-xs">{p.reference_number || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
        <PayDebtModal
          debt={payTarget}
          open={!!payTarget}
          onClose={() => setPayTarget(null)}
          onSuccess={() => {
            load();
            setSelected(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader title={t('financialControl.nav.debts')} subtitle={t('financialControl.debts.subtitle')}>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg"
        >
          <Plus className="size-4" />
          {t('financialControl.debts.addLiability')}
        </button>
      </SectionHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label={t('financialControl.debts.openDebt')} value={fmtAed(totalRemaining, i18n.language)} icon={<Scale className="size-4 text-rose-600" />} iconBg="bg-rose-50" />
        <KpiCard label={t('financialControl.debts.overdue')} value={String(overdue.length)} sub={fmtAed(overdue.reduce((s, d) => s + num(d.remaining_balance), 0), i18n.language)} icon={<AlertTriangle className="size-4 text-red-600" />} iconBg="bg-red-50" warn={overdue.length > 0} />
        <KpiCard label={t('financialControl.debts.paidMonth')} value={fmtAed(paidMonth, i18n.language)} icon={<CheckCircle className="size-4 text-emerald-600" />} iconBg="bg-emerald-50" />
        <KpiCard label={t('financialControl.debts.upcoming')} value={fmtAed(upcomingInstallments, i18n.language)} icon={<Calendar className="size-4 text-blue-600" />} iconBg="bg-blue-50" />
      </div>

      {overdue.length > 0 && (
        <div className="space-y-2">
          {overdue.map((d) => (
            <div key={d.id} className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle className="size-4 text-red-600" />
              <div className="flex-1 text-sm font-semibold text-red-700">{d.name}</div>
              <button type="button" onClick={() => setPayTarget(d)} className="px-2.5 py-1 bg-red-600 text-white text-xs font-semibold rounded-lg">
                {t('financialControl.debts.payDebt')}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute start-3 top-2.5 size-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('financialControl.debts.search')}
            className="w-full ps-9 pe-4 py-2 border border-slate-200 rounded-lg text-sm"
          />
        </div>
        <select className="border rounded-lg px-3 py-2 text-sm bg-white" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">{t('financialControl.debts.filterStatus')}</option>
          <option value="active">{t('financialControl.status.active')}</option>
          <option value="overdue">{t('financialControl.debts.overdue')}</option>
          <option value="partially_paid">{t('financialControl.debts.partiallyPaid')}</option>
          <option value="paid">{t('financialControl.debts.paidStatus')}</option>
        </select>
        <select className="border rounded-lg px-3 py-2 text-sm bg-white" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}>
          <option value="all">{t('financialControl.checks.risk')}</option>
          <option value="low">{t('financialControl.status.low')}</option>
          <option value="medium">{t('financialControl.status.medium')}</option>
          <option value="high">{t('financialControl.status.high')}</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyFinancialState message={t('financialControl.debts.empty')} />
      ) : (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                  <th className="px-4 py-3 text-start">{t('financialControl.debts.debtName')}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.debts.creditor')}</th>
                  <th className="px-4 py-3 text-end">{t('financialControl.debts.remaining')}</th>
                  <th className="px-4 py-3 text-center">{t('financialControl.debts.progress')}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.debts.nextPayment')}</th>
                  <th className="px-4 py-3 text-center">{t('common.status', { defaultValue: 'Status' })}</th>
                  <th className="px-4 py-3 text-end">{t('common.view')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50 cursor-pointer group" onClick={() => setSelected(d)}>
                    <td className="px-4 py-3 font-semibold text-xs">{d.name}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{d.creditor}</td>
                    <td className="px-4 py-3 text-end">
                      <CurrencyAmount value={d.remaining_balance} className="font-bold text-red-600" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${d.paid_percent}%` }} />
                        </div>
                        <span className="text-xs w-8">{d.paid_percent}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">{d.next_payment_date || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <FinancialStatusBadge status={d.display_status} />
                    </td>
                    <td className="px-4 py-3 text-end" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => setSelected(d)} className="p-1.5 rounded hover:bg-slate-100">
                          <Eye className="size-4 text-slate-400" />
                        </button>
                        {d.display_status !== 'paid' && (
                          <button type="button" onClick={() => setPayTarget(d)} className="p-1.5 rounded hover:bg-slate-100">
                            <Banknote className="size-4 text-slate-400" />
                          </button>
                        )}
                        <button type="button" onClick={() => setEditDebt(d)} className="p-1.5 rounded hover:bg-slate-100">
                          <Pencil className="size-4 text-slate-400" />
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

      <AddDebtModal open={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} />
      <AddDebtModal open={!!editDebt} editDebt={editDebt} onClose={() => setEditDebt(null)} onSuccess={load} />
      <PayDebtModal debt={payTarget} open={!!payTarget} onClose={() => setPayTarget(null)} onSuccess={load} />
    </div>
  );
}
