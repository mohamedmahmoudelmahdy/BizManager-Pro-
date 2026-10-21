import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Eye, Inbox, Loader2 } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { AttestationStatusBadge, AttestationCode } from '@/app/components/attestation/AttestationBadges';
import { useDebouncedValue } from '@/app/hooks/usePaginatedMarketingList';
import { hrAttestationApi } from '@/app/lib/hrAttestationApi';
import { formatAttestationErrorMessage } from '@/app/lib/attestationErrors';
import {
  attestationInputClass,
  attestationLabelClass,
  formatAttestationDateTime,
} from '@/app/lib/attestationFormat';
import type {
  HRApplicationSummary,
  HRAttestationStatus,
  HROverviewResponse,
} from '@/app/lib/hrAttestationTypes';
import { cn } from '@/app/components/ui/utils';

export function HRAttestationDashboardPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const debouncedSearch = useDebouncedValue(search);
  const [statusFilter, setStatusFilter] = useState<HRAttestationStatus | ''>(
    (searchParams.get('status') as HRAttestationStatus) || ''
  );
  const [submittedFrom, setSubmittedFrom] = useState(searchParams.get('submitted_from') || '');
  const [submittedTo, setSubmittedTo] = useState(searchParams.get('submitted_to') || '');
  const [ordering, setOrdering] = useState(searchParams.get('ordering') || '-updated_at');
  const [page, setPage] = useState(Number(searchParams.get('page') || '1') || 1);

  const [overview, setOverview] = useState<HROverviewResponse | null>(null);
  const [rows, setRows] = useState<HRApplicationSummary[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedSearch) next.set('search', debouncedSearch);
    if (statusFilter) next.set('status', statusFilter);
    if (submittedFrom) next.set('submitted_from', submittedFrom);
    if (submittedTo) next.set('submitted_to', submittedTo);
    if (ordering) next.set('ordering', ordering);
    if (page > 1) next.set('page', String(page));
    setSearchParams(next, { replace: true });
  }, [
    debouncedSearch,
    statusFilter,
    submittedFrom,
    submittedTo,
    ordering,
    page,
    setSearchParams,
  ]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, submittedFrom, submittedTo, ordering]);

  const listParams = useMemo(
    () => ({
      page,
      search: debouncedSearch || undefined,
      status: statusFilter || undefined,
      submitted_from: submittedFrom || undefined,
      submitted_to: submittedTo || undefined,
      ordering,
    }),
    [page, debouncedSearch, statusFilter, submittedFrom, submittedTo, ordering]
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const init = signal ? { signal } : undefined;
        const [ov, list] = await Promise.all([
          hrAttestationApi.getOverview(init),
          hrAttestationApi.listApplications(listParams, init),
        ]);
        setOverview(ov);
        setRows(list.results);
        setCount(list.count);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [listParams]
  );

  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const expected = overview?.batch?.expected_applicant_count ?? null;
  const completed = overview?.summary.completed ?? 0;
  const progressPct =
    expected && expected > 0 ? Math.min(100, Math.round((completed / expected) * 100)) : null;

  const statusChips: Array<{ id: '' | HRAttestationStatus; label: string; value: number }> = [
    { id: '', label: t('hrPortal.attestation.filters.all'), value: overview?.summary.submitted ?? 0 },
    {
      id: 'documents_received',
      label: t('attestation.status.documents_received'),
      value: overview?.summary.documents_received ?? 0,
    },
    {
      id: 'dataflow_in_progress',
      label: t('attestation.status.dataflow_in_progress'),
      value: overview?.summary.dataflow_in_progress ?? 0,
    },
    {
      id: 'mohesr_in_progress',
      label: t('attestation.status.mohesr_in_progress'),
      value: overview?.summary.mohesr_in_progress ?? 0,
    },
    {
      id: 'completed',
      label: t('attestation.status.completed'),
      value: overview?.summary.completed ?? 0,
    },
  ];

  return (
    <section className="space-y-5" aria-labelledby="hr-attestation-title">
      <div className="space-y-1">
        <h1 id="hr-attestation-title" className="text-xl font-semibold text-slate-900 break-words">
          {t('hrPortal.attestation.title')}
        </h1>
        <p className="text-sm text-slate-500 break-words">
          {overview?.batch?.title || t('hrPortal.attestation.subtitle')}
        </p>
        {overview?.customer ? (
          <p className="text-sm text-slate-600 break-words">
            {t('hrPortal.attestation.organization')}: {overview.customer.display_name}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {(
          [
            ['expected', expected ?? '—'],
            ['submitted', overview?.summary.submitted ?? '—'],
            ['documents_received', overview?.summary.documents_received ?? '—'],
            ['dataflow_in_progress', overview?.summary.dataflow_in_progress ?? '—'],
            ['mohesr_in_progress', overview?.summary.mohesr_in_progress ?? '—'],
            ['completed', overview?.summary.completed ?? '—'],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-xs text-slate-500 break-words">
              {t(`hrPortal.attestation.kpi.${key}`)}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900" dir="ltr">
              {loading && !overview ? '…' : value}
            </p>
          </div>
        ))}
      </div>

      {progressPct != null ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex justify-between text-sm text-slate-600">
            <span>{t('hrPortal.attestation.progress')}</span>
            <span dir="ltr">
              {completed} / {expected} ({progressPct}%)
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden" aria-hidden>
            <div className="h-full bg-emerald-500" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('hrPortal.attestation.filters.statusChips')}>
        {statusChips.map((chip) => (
          <button
            key={chip.id || 'all'}
            type="button"
            role="tab"
            aria-selected={statusFilter === chip.id}
            onClick={() => setStatusFilter(chip.id)}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
              statusFilter === chip.id
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700'
            )}
          >
            {chip.label}
            <span className="tabular-nums" dir="ltr">
              {chip.value}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="flex-1 min-w-[12rem]">
          <label htmlFor="hr-search" className={attestationLabelClass}>
            {t('hrPortal.attestation.filters.search')}
          </label>
          <input
            id="hr-search"
            className={attestationInputClass}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('hrPortal.attestation.filters.searchPlaceholder')}
          />
        </div>
        <div className="w-full sm:w-44">
          <label htmlFor="hr-from" className={attestationLabelClass}>
            {t('attestation.filters.submittedFrom')}
          </label>
          <input
            id="hr-from"
            type="date"
            className={attestationInputClass}
            value={submittedFrom}
            onChange={(e) => setSubmittedFrom(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-44">
          <label htmlFor="hr-to" className={attestationLabelClass}>
            {t('attestation.filters.submittedTo')}
          </label>
          <input
            id="hr-to"
            type="date"
            className={attestationInputClass}
            value={submittedTo}
            onChange={(e) => setSubmittedTo(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-52">
          <label htmlFor="hr-ordering" className={attestationLabelClass}>
            {t('attestation.filters.ordering')}
          </label>
          <select
            id="hr-ordering"
            className={attestationInputClass}
            value={ordering}
            onChange={(e) => setOrdering(e.target.value)}
          >
            <option value="-updated_at">{t('hrPortal.attestation.ordering.updatedNewest')}</option>
            <option value="-submitted_at">{t('attestation.ordering.submittedNewest')}</option>
            <option value="full_name">{t('attestation.ordering.nameAsc')}</option>
            <option value="reference_number">{t('attestation.ordering.refAsc')}</option>
          </select>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm" role="alert">
          <div className="flex gap-2">
            <AlertTriangle className="size-5 shrink-0" aria-hidden />
            <div className="space-y-2">
              <p>{formatAttestationErrorMessage(error, t)}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                {t('attestation.actions.retry')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16 text-slate-400" role="status">
            <Loader2 className="size-8 animate-spin" aria-hidden />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-500">
            <Inbox className="size-8" aria-hidden />
            <p>{t('hrPortal.attestation.empty')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-start">{t('attestation.columns.reference')}</th>
                  <th className="px-4 py-3 text-start">{t('hrPortal.attestation.columns.teacher')}</th>
                  <th className="px-4 py-3 text-start">{t('attestation.columns.degrees')}</th>
                  <th className="px-4 py-3 text-start">{t('attestation.columns.status')}</th>
                  <th className="px-4 py-3 text-start">{t('attestation.columns.dataflowRef')}</th>
                  <th className="px-4 py-3 text-start">{t('attestation.columns.mohesrRef')}</th>
                  <th className="px-4 py-3 text-start">{t('attestation.columns.updatedAt')}</th>
                  <th className="px-4 py-3 text-start">{t('attestation.columns.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      <AttestationCode>{row.reference_number}</AttestationCode>
                    </td>
                    <td className="px-4 py-3 max-w-[12rem] break-words">{row.full_name}</td>
                    <td className="px-4 py-3 tabular-nums" dir="ltr">
                      {row.degree_count}
                    </td>
                    <td className="px-4 py-3">
                      <AttestationStatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3">
                      {row.dataflow_reference ? (
                        <AttestationCode>{row.dataflow_reference}</AttestationCode>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.mohesr_reference ? (
                        <AttestationCode>{row.mohesr_reference}</AttestationCode>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatAttestationDateTime(row.updated_at, i18n.language)}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/hr/attestation/${row.id}`)}
                      >
                        <Eye className="size-4 me-1.5" aria-hidden />
                        {t('hrPortal.attestation.view')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && count > 0 ? (
          <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between text-sm">
            <p dir="ltr">
              {t('attestation.pagination.summary', { page, totalPages, count })}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('attestation.pagination.prev')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t('attestation.pagination.next')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <Link to="/hr/attestation" className="sr-only">
        {t('hrPortal.attestation.title')}
      </Link>
    </section>
  );
}
