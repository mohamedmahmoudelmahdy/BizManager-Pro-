import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Loader2, Search, Eye, Receipt, Pencil, Trash2 } from 'lucide-react';
import { fetchExpenses, type ExpenseApi } from '@/app/lib/operationalFinanceApi';
import { useData } from '@/app/contexts/DataContext';
import { SectionHeader } from '@/app/components/financial-control/components/SectionHeader';
import { SectionCard } from '@/app/components/financial-control/components/SectionCard';
import { KpiCard } from '@/app/components/financial-control/components/KpiCard';
import { CurrencyAmount } from '@/app/components/financial-control/components/CurrencyAmount';
import { FinancialStatusBadge } from '@/app/components/financial-control/components/FinancialStatusBadge';
import { EmptyFinancialState } from '@/app/components/financial-control/components/EmptyFinancialState';
import { ExpenseDetailDrawer } from '@/app/components/financial-control/components/ExpenseDetailDrawer';
import { AddFcExpenseModal } from '@/app/components/financial-control/modals/AddFcExpenseModal';
import { EXPENSE_CATEGORIES, EXPENSE_SOURCE_TYPES } from '@/app/components/financial-control/types/expense';
import { fmtAed, num } from '@/app/components/financial-control/utils/format';

export function ExpensesPage() {
  const { t, i18n } = useTranslation();
  const { bankCards, employees } = useData();
  const [expenses, setExpenses] = useState<ExpenseApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [paidByFilter, setPaidByFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState<ExpenseApi | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Stable loader (no context-function deps) so the mount effect runs once
  // instead of re-firing every time DataContext re-renders.
  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const data = await fetchExpenses();
      if (mountedRef.current) setExpenses(data);
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return expenses.filter((e) => {
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
      if (paidByFilter !== 'all' && e.paid_by !== paidByFilter) return false;
      if (employeeFilter !== 'all' && String(e.assigned_employee) !== employeeFilter) return false;
      if (sourceFilter !== 'all' && e.linked_source_type !== sourceFilter) return false;
      if (dateFrom && e.date < dateFrom) return false;
      if (dateTo && e.date > dateTo) return false;
      if (
        q &&
        !e.notes?.toLowerCase().includes(q) &&
        !e.paid_by_name?.toLowerCase().includes(q) &&
        !e.employee_name?.toLowerCase().includes(q) &&
        !e.linked_source_label?.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [expenses, search, categoryFilter, paidByFilter, employeeFilter, sourceFilter, dateFrom, dateTo]);

  const monthPrefix = new Date().toISOString().slice(0, 7);
  const monthTotal = expenses
    .filter((e) => e.date.startsWith(monthPrefix))
    .reduce((s, e) => s + num(e.amount), 0);
  const payrollCount = expenses.filter((e) => e.linked_source_type === 'payroll' || e.payroll_type).length;

  // Full-page spinner only on the very first load; later refreshes keep the
  // existing table visible to avoid flicker.
  if (loading && expenses.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader title={t('financialControl.nav.expenses')} subtitle={t('financialControl.expenses.subtitle')}>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg"
        >
          <Plus className="size-4" />
          {t('financialControl.expenses.addExpense')}
        </button>
      </SectionHeader>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard label={t('financialControl.expenses.monthTotal')} value={fmtAed(monthTotal, i18n.language)} icon={<Receipt className="size-4 text-rose-600" />} iconBg="bg-rose-50" />
        <KpiCard label={t('financialControl.expenses.count')} value={String(expenses.length)} />
        <KpiCard label={t('financialControl.expenses.payrollLinked')} value={String(payrollCount)} />
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute start-3 top-2.5 size-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('financialControl.expenses.search')}
            className="w-full ps-9 pe-3 py-2 border rounded-lg text-sm"
          />
        </div>
        <input type="date" className="border rounded-lg px-2 py-2 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title={t('financialControl.expenses.dateFrom')} />
        <input type="date" className="border rounded-lg px-2 py-2 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title={t('financialControl.expenses.dateTo')} />
        <select className="border rounded-lg px-2 py-2 text-sm bg-white" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="all">{t('financialControl.expenses.allCategories')}</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`financialControl.expenses.categories.${c}`)}
            </option>
          ))}
        </select>
        <select className="border rounded-lg px-2 py-2 text-sm bg-white" value={paidByFilter} onChange={(e) => setPaidByFilter(e.target.value)}>
          <option value="all">{t('financialControl.expenses.allMethods')}</option>
          {bankCards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.bankName}
            </option>
          ))}
        </select>
        <select className="border rounded-lg px-2 py-2 text-sm bg-white" value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
          <option value="all">{t('financialControl.expenses.allEmployees')}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.userId || e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select className="border rounded-lg px-2 py-2 text-sm bg-white" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          {EXPENSE_SOURCE_TYPES.map((s) => (
            <option key={s} value={s}>
              {t(`financialControl.expenses.sources.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyFinancialState message={t('financialControl.expenses.empty')} />
      ) : (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                  <th className="px-4 py-3 text-start">{t('financialControl.expenses.date')}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.expenses.category')}</th>
                  <th className="px-4 py-3 text-end">{t('financialControl.ledger.amount')}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.expenses.paidBy')}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.expenses.employee')}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.expenses.source')}</th>
                  <th className="px-4 py-3 text-end">{t('common.view')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50 group">
                    <td className="px-4 py-3 text-xs"><bdi>{e.date}</bdi></td>
                    <td className="px-4 py-3 text-xs">{t(`financialControl.expenses.categories.${e.category}`, { defaultValue: e.category })}</td>
                    <td className="px-4 py-3 text-end">
                      <CurrencyAmount value={e.amount} className="font-bold font-mono" />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{e.paid_by_name || '—'}</td>
                    <td className="px-4 py-3 text-xs">{e.employee_name || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <FinancialStatusBadge status={e.linked_source_type || 'manual'} />
                        {e.linked_source_label && (
                          <span className="text-xs text-slate-400 truncate max-w-[140px]">{e.linked_source_label}</span>
                        )}
                        {e.payroll_type && (
                          <span className="text-xs text-violet-600">{t(`financialControl.expenses.payrollTypes.${e.payroll_type}`, { defaultValue: e.payroll_type })}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100">
                        <button type="button" onClick={() => setSelected(e)} className="p-1.5 rounded hover:bg-slate-100" title={t('common.view')}>
                          <Eye className="size-4 text-slate-400" />
                        </button>
                        <button type="button" disabled className="p-1.5 rounded opacity-40 cursor-not-allowed" title={t('financialControl.expenses.editDisabled')}>
                          <Pencil className="size-4 text-slate-300" />
                        </button>
                        <button type="button" disabled className="p-1.5 rounded opacity-40 cursor-not-allowed" title={t('financialControl.expenses.deleteDisabled')}>
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

      <ExpenseDetailDrawer expense={selected} onClose={() => setSelected(null)} />
      <AddFcExpenseModal open={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} />
    </div>
  );
}
