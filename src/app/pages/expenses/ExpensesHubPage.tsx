import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, Plus, Receipt } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { ExpensePermissionGuard } from '@/app/components/expenses/ExpensePermissionGuard';
import { ExpenseCode, ExpenseStatusBadge } from '@/app/components/expenses/ExpenseBadges';
import { useExpensePermissions } from '@/app/hooks/useExpensePermissions';
import { useDebouncedValue } from '@/app/hooks/usePaginatedMarketingList';
import { expensesApi } from '@/app/lib/expenseApi';
import { formatExpenseErrorMessage } from '@/app/lib/expenseErrors';
import {
  expenseInputClass,
  expenseLabelClass,
  formatExpenseAmount,
  formatExpenseIsoDate,
  formatExpenseUserLabel,
} from '@/app/lib/expenseFormat';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_WORKFLOW_STATUSES,
  type ExpenseListParams,
  type ExpenseSummary,
} from '@/app/lib/expenseTypes';
import { cn } from '@/app/components/ui/utils';
import { Loader2, AlertTriangle, Inbox } from 'lucide-react';

type HubTab = 'mine' | 'review';

export function ExpensesHubPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const perms = useExpensePermissions();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTab: HubTab =
    searchParams.get('tab') === 'review' && perms.canReviewQueue ? 'review' : 'mine';
  const [tab, setTab] = useState<HubTab>(initialTab);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [statusFilter, setStatusFilter] = useState(
    searchParams.get('tab') === 'review' ? 'submitted' : ''
  );
  const [categoryFilter, setCategoryFilter] = useState('');
  const [ordering, setOrdering] = useState('-date');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ExpenseSummary[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (searchParams.get('tab') === 'review' && perms.canReviewQueue) {
      setTab('review');
      setStatusFilter((s) => s || 'submitted');
    }
  }, [searchParams, perms.canReviewQueue]);

  useEffect(() => {
    setPage(1);
  }, [tab, debouncedSearch, statusFilter, categoryFilter, ordering]);

  const params = useMemo((): ExpenseListParams => {
    const p: ExpenseListParams = {
      page,
      page_size: 20,
      search: debouncedSearch || undefined,
      ordering,
      category: categoryFilter || undefined,
      status: statusFilter || undefined,
    };
    if (tab === 'mine') {
      p.mine = true;
    }
    return p;
  }, [page, debouncedSearch, ordering, categoryFilter, statusFilter, tab]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await expensesApi.list(params, signal ? { signal } : undefined);
      setRows(res.results);
      setCount(res.count);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err);
      setRows([]);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const selectTab = (next: HubTab) => {
    setTab(next);
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'review') {
      nextParams.set('tab', 'review');
      setStatusFilter('submitted');
    } else {
      nextParams.delete('tab');
      setStatusFilter('');
    }
    setSearchParams(nextParams, { replace: true });
  };

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  return (
    <ExpensePermissionGuard>
      <section className="space-y-5" aria-labelledby="expenses-hub-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h2 id="expenses-hub-title" className="text-xl font-semibold text-slate-900 break-words">
              {t('expenses.employee.title')}
            </h2>
            <p className="text-sm text-slate-500 break-words max-w-2xl">
              {t('expenses.employee.description')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {perms.canRecordOperational ? (
              <Button type="button" variant="outline" asChild>
                <Link to="/expenses/operational">{t('expenses.employee.operationalLink')}</Link>
              </Button>
            ) : null}
            {perms.canAddOwn ? (
              <Button type="button" onClick={() => navigate('/expenses/new')}>
                <Plus className="size-4 me-2" />
                {t('expenses.employee.newClaim')}
              </Button>
            ) : null}
          </div>
        </div>

        {perms.canReviewQueue ? (
          <div className="flex gap-1 border-b border-slate-200" role="tablist">
            {(
              [
                { id: 'mine' as const, label: t('expenses.employee.tabs.mine') },
                { id: 'review' as const, label: t('expenses.employee.tabs.review') },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => selectTab(item.id)}
                className={cn(
                  'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  tab === item.id
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor="expense-search" className={expenseLabelClass}>
              {t('expenses.employee.filters.search')}
            </label>
            <input
              id="expense-search"
              className={expenseInputClass}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('expenses.employee.filters.searchPlaceholder')}
            />
          </div>
          <div className="w-full sm:w-44">
            <label htmlFor="expense-status" className={expenseLabelClass}>
              {t('expenses.employee.filters.status')}
            </label>
            <select
              id="expense-status"
              className={expenseInputClass}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">{t('expenses.employee.filters.allStatuses')}</option>
              {EXPENSE_WORKFLOW_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`expenses.status.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-44">
            <label htmlFor="expense-category" className={expenseLabelClass}>
              {t('expenses.employee.filters.category')}
            </label>
            <select
              id="expense-category"
              className={expenseInputClass}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">{t('expenses.employee.filters.allCategories')}</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`expenses.employee.categories.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-48">
            <label htmlFor="expense-ordering" className={expenseLabelClass}>
              {t('expenses.employee.filters.sort')}
            </label>
            <select
              id="expense-ordering"
              className={expenseInputClass}
              value={ordering}
              onChange={(e) => setOrdering(e.target.value)}
            >
              <option value="-date">{t('expenses.employee.sort.dateDesc')}</option>
              <option value="date">{t('expenses.employee.sort.dateAsc')}</option>
              <option value="-amount">{t('expenses.employee.sort.amountDesc')}</option>
              <option value="amount">{t('expenses.employee.sort.amountAsc')}</option>
              <option value="-created_at">{t('expenses.employee.sort.newest')}</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400" role="status">
            <Loader2 className="size-8 animate-spin" aria-hidden />
            <p className="text-sm">{t('common.loading')}</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-500" role="alert">
            <AlertTriangle className="size-8 text-amber-500" aria-hidden />
            <p className="text-sm text-center max-w-md">{formatExpenseErrorMessage(error, t)}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => load()}>
              {t('expenses.employee.retry')}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400" role="status">
            <Inbox className="size-8" aria-hidden />
            <p className="text-sm text-center max-w-md">
              {tab === 'review'
                ? t('expenses.employee.emptyReview')
                : t('expenses.employee.emptyMine')}
            </p>
            {perms.canAddOwn && tab === 'mine' ? (
              <Button type="button" variant="outline" size="sm" onClick={() => navigate('/expenses/new')}>
                <Plus className="size-4 me-2" />
                {t('expenses.employee.newClaim')}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-start font-semibold">{t('expenses.employee.table.number')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t('expenses.employee.table.date')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t('expenses.employee.table.category')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t('expenses.employee.table.merchant')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t('expenses.employee.table.amount')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t('expenses.employee.table.status')}</th>
                  {tab === 'review' ? (
                    <th className="px-4 py-3 text-start font-semibold">{t('expenses.employee.table.claimant')}</th>
                  ) : null}
                  <th className="px-4 py-3 text-end font-semibold">{t('expenses.employee.table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <ExpenseCode>{row.expense_number || row.id.slice(0, 8)}</ExpenseCode>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatExpenseIsoDate(row.date)}</td>
                    <td className="px-4 py-3">
                      {t(`expenses.employee.categories.${row.category}`, {
                        defaultValue: row.category,
                      })}
                    </td>
                    <td className="px-4 py-3 max-w-[10rem] truncate">{row.merchant || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap" dir="ltr">
                      {formatExpenseAmount(row.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <ExpenseStatusBadge status={row.workflow_status} />
                    </td>
                    {tab === 'review' ? (
                      <td className="px-4 py-3">
                        {formatExpenseUserLabel(row.expense_for_user || row.submitted_by)}
                      </td>
                    ) : null}
                    <td className="px-4 py-3 text-end">
                      <Button type="button" variant="ghost" size="sm" asChild>
                        <Link to={`/expenses/${row.id}`}>
                          <Eye className="size-4 me-1" />
                          {t('common.view')}
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && count > pageSize ? (
          <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
            <p>
              {t('expenses.employee.pagination', {
                page,
                totalPages,
                count,
              })}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('expenses.employee.prev')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t('expenses.employee.next')}
              </Button>
            </div>
          </div>
        ) : null}

        {perms.canAddOwn ? (
          <p className="text-xs text-slate-400 flex items-center gap-1.5">
            <Receipt className="size-3.5" aria-hidden />
            {t('expenses.employee.hint')}
          </p>
        ) : null}
      </section>
    </ExpensePermissionGuard>
  );
}
