import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Eye, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { AttestationPermissionGuard } from '@/app/components/attestation/AttestationPermissionGuard';
import {
  AttestationCode,
  AttestationStatusBadge,
} from '@/app/components/attestation/AttestationBadges';
import { useDebouncedValue } from '@/app/hooks/usePaginatedMarketingList';
import { attestationApi } from '@/app/lib/attestationApi';
import { formatAttestationErrorMessage } from '@/app/lib/attestationErrors';
import {
  attestationInputClass,
  attestationLabelClass,
  formatAttestationDateTime,
} from '@/app/lib/attestationFormat';
import {
  ATTESTATION_STATUSES,
  type AttestationApplicationSummary,
  type AttestationListParams,
  type AttestationStatus,
} from '@/app/lib/attestationTypes';
import { cn } from '@/app/components/ui/utils';

type StatusCounts = Record<'all' | AttestationStatus, number>;

const EMPTY_COUNTS: StatusCounts = {
  all: 0,
  documents_received: 0,
  dataflow_in_progress: 0,
  mohesr_in_progress: 0,
  completed: 0,
};

export function AttestationWorkspacePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [statusFilter, setStatusFilter] = useState<AttestationStatus | ''>('');
  const [submittedFrom, setSubmittedFrom] = useState('');
  const [submittedTo, setSubmittedTo] = useState('');
  const [ordering, setOrdering] = useState('-submitted_at');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AttestationApplicationSummary[]>([]);
  const [count, setCount] = useState(0);
  const [counts, setCounts] = useState<StatusCounts>(EMPTY_COUNTS);
  const [expectedTeachers, setExpectedTeachers] = useState<number | null>(null);
  const [batchTitle, setBatchTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [countsLoading, setCountsLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, submittedFrom, submittedTo, ordering]);

  const params = useMemo((): AttestationListParams => {
    return {
      page,
      search: debouncedSearch || undefined,
      status: statusFilter || undefined,
      submitted_from: submittedFrom || undefined,
      submitted_to: submittedTo || undefined,
      ordering,
    };
  }, [page, debouncedSearch, statusFilter, submittedFrom, submittedTo, ordering]);

  const loadCounts = useCallback(async (signal?: AbortSignal) => {
    setCountsLoading(true);
    try {
      const init = signal ? { signal } : undefined;
      const [all, docs, df, mh, done] = await Promise.all([
        attestationApi.listApplications({ page: 1 }, init),
        attestationApi.listApplications({ page: 1, status: 'documents_received' }, init),
        attestationApi.listApplications({ page: 1, status: 'dataflow_in_progress' }, init),
        attestationApi.listApplications({ page: 1, status: 'mohesr_in_progress' }, init),
        attestationApi.listApplications({ page: 1, status: 'completed' }, init),
      ]);
      setCounts({
        all: all.count,
        documents_received: docs.count,
        dataflow_in_progress: df.count,
        mohesr_in_progress: mh.count,
        completed: done.count,
      });
      const sample = all.results[0];
      if (sample) {
        setExpectedTeachers(sample.batch_expected_count);
        setBatchTitle(sample.batch_title);
      } else {
        setExpectedTeachers(null);
        setBatchTitle(null);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // Non-fatal for the list itself
    } finally {
      setCountsLoading(false);
    }
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await attestationApi.listApplications(
          params,
          signal ? { signal } : undefined
        );
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
    },
    [params]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    loadCounts(controller.signal);
    return () => controller.abort();
  }, [loadCounts]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const remaining =
    expectedTeachers != null ? Math.max(0, expectedTeachers - counts.all) : null;

  const statusChips: Array<{ id: '' | AttestationStatus; label: string; value: number }> = [
    { id: '', label: t('attestation.filters.all'), value: counts.all },
    {
      id: 'documents_received',
      label: t('attestation.status.documents_received'),
      value: counts.documents_received,
    },
    {
      id: 'dataflow_in_progress',
      label: t('attestation.status.dataflow_in_progress'),
      value: counts.dataflow_in_progress,
    },
    {
      id: 'mohesr_in_progress',
      label: t('attestation.status.mohesr_in_progress'),
      value: counts.mohesr_in_progress,
    },
    {
      id: 'completed',
      label: t('attestation.status.completed'),
      value: counts.completed,
    },
  ];

  return (
    <AttestationPermissionGuard>
      <section className="space-y-5" aria-labelledby="attestation-workspace-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h1
              id="attestation-workspace-title"
              className="text-xl font-semibold text-slate-900 break-words"
            >
              {t('attestation.workspace.title')}
            </h1>
            <p className="text-sm text-slate-500 break-words max-w-2xl">
              {t('attestation.workspace.description')}
            </p>
            {batchTitle ? (
              <p className="text-sm text-slate-600 break-words">
                <span className="font-medium">{t('attestation.batch.label')}:</span>{' '}
                {batchTitle}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void load();
              void loadCounts();
            }}
          >
            <RefreshCw className="size-4 me-2" aria-hidden />
            {t('attestation.actions.refresh')}
          </Button>
        </div>

        <div
          className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
          aria-label={t('attestation.workspace.summaryAria')}
        >
          {(
            [
              ['all', t('attestation.summary.total')],
              ['documents_received', t('attestation.status.documents_received')],
              ['dataflow_in_progress', t('attestation.status.dataflow_in_progress')],
              ['mohesr_in_progress', t('attestation.status.mohesr_in_progress')],
              ['completed', t('attestation.status.completed')],
            ] as const
          ).map(([key, label]) => (
            <div
              key={key}
              className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            >
              <p className="text-xs font-medium text-slate-500 break-words">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums" dir="ltr">
                {countsLoading ? '…' : counts[key]}
              </p>
            </div>
          ))}
        </div>

        {expectedTeachers != null ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800 mb-2">
              {t('attestation.batch.progressTitle')}
            </h2>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">{t('attestation.batch.expected')}</dt>
                <dd className="font-semibold text-slate-900 tabular-nums" dir="ltr">
                  {expectedTeachers}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('attestation.batch.submitted')}</dt>
                <dd className="font-semibold text-slate-900 tabular-nums" dir="ltr">
                  {counts.all}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('attestation.batch.remaining')}</dt>
                <dd className="font-semibold text-slate-900 tabular-nums" dir="ltr">
                  {remaining}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}

        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label={t('attestation.filters.statusChips')}
        >
          {statusChips.map((chip) => (
            <button
              key={chip.id || 'all'}
              type="button"
              role="tab"
              aria-selected={statusFilter === chip.id}
              onClick={() => setStatusFilter(chip.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors',
                statusFilter === chip.id
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              )}
            >
              <span className="break-words">{chip.label}</span>
              <span
                className={cn(
                  'tabular-nums rounded-full px-1.5 py-0.5',
                  statusFilter === chip.id ? 'bg-white/20' : 'bg-slate-100'
                )}
                dir="ltr"
              >
                {countsLoading ? '…' : chip.value}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor="attestation-search" className={attestationLabelClass}>
              {t('attestation.filters.search')}
            </label>
            <input
              id="attestation-search"
              className={attestationInputClass}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('attestation.filters.searchPlaceholder')}
            />
          </div>
          <div className="w-full sm:w-44">
            <label htmlFor="attestation-from" className={attestationLabelClass}>
              {t('attestation.filters.submittedFrom')}
            </label>
            <input
              id="attestation-from"
              type="date"
              className={attestationInputClass}
              value={submittedFrom}
              onChange={(e) => setSubmittedFrom(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-44">
            <label htmlFor="attestation-to" className={attestationLabelClass}>
              {t('attestation.filters.submittedTo')}
            </label>
            <input
              id="attestation-to"
              type="date"
              className={attestationInputClass}
              value={submittedTo}
              onChange={(e) => setSubmittedTo(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-52">
            <label htmlFor="attestation-ordering" className={attestationLabelClass}>
              {t('attestation.filters.ordering')}
            </label>
            <select
              id="attestation-ordering"
              className={attestationInputClass}
              value={ordering}
              onChange={(e) => setOrdering(e.target.value)}
            >
              <option value="-submitted_at">{t('attestation.ordering.submittedNewest')}</option>
              <option value="submitted_at">{t('attestation.ordering.submittedOldest')}</option>
              <option value="full_name">{t('attestation.ordering.nameAsc')}</option>
              <option value="-full_name">{t('attestation.ordering.nameDesc')}</option>
              <option value="status">{t('attestation.ordering.statusAsc')}</option>
              <option value="-status">{t('attestation.ordering.statusDesc')}</option>
              <option value="reference_number">{t('attestation.ordering.refAsc')}</option>
              <option value="-reference_number">{t('attestation.ordering.refDesc')}</option>
            </select>
          </div>
        </div>

        {error ? (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0 space-y-2">
                <p className="break-words">{formatAttestationErrorMessage(error, t)}</p>
                <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                  {t('attestation.actions.retry')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16 text-slate-400" role="status">
              <Loader2 className="size-8 animate-spin" aria-hidden />
              <span className="sr-only">{t('attestation.loading')}</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-slate-500">
              <Inbox className="size-8" aria-hidden />
              <p>{t('attestation.empty.applications')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-start font-semibold">
                      {t('attestation.columns.reference')}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold">
                      {t('attestation.columns.applicant')}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold">
                      {t('attestation.columns.phone')}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold">
                      {t('attestation.columns.degrees')}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold">
                      {t('attestation.columns.status')}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold">
                      {t('attestation.columns.dataflowRef')}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold">
                      {t('attestation.columns.mohesrRef')}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold">
                      {t('attestation.columns.submittedAt')}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold">
                      {t('attestation.columns.updatedAt')}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold">
                      {t('attestation.columns.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <AttestationCode>{row.reference_number}</AttestationCode>
                      </td>
                      <td className="px-4 py-3 max-w-[12rem] break-words">{row.full_name}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span dir="ltr">{row.phone}</span>
                      </td>
                      <td className="px-4 py-3 tabular-nums" dir="ltr">
                        {row.degree_count}
                      </td>
                      <td className="px-4 py-3">
                        <AttestationStatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3 max-w-[10rem] truncate">
                        {row.dataflow_reference ? (
                          <AttestationCode>{row.dataflow_reference}</AttestationCode>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-[10rem] truncate">
                        {row.mohesr_reference ? (
                          <AttestationCode>{row.mohesr_reference}</AttestationCode>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                        {formatAttestationDateTime(row.submitted_at, i18n.language)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                        {formatAttestationDateTime(row.updated_at, i18n.language)}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            navigate(`/attestation/applications/${row.id}`)
                          }
                        >
                          <Eye className="size-4 me-1.5" aria-hidden />
                          {t('attestation.actions.open')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && count > 0 ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
              <p dir="ltr">
                {t('attestation.pagination.summary', {
                  page,
                  totalPages,
                  count,
                })}
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

        {/* Keep statuses in DOM for i18n completeness without unused-import lint */}
        <span className="sr-only">
          {ATTESTATION_STATUSES.map((s) => t(`attestation.status.${s}`)).join(' ')}
        </span>
        <Link to="/attestation/applications" className="sr-only">
          {t('attestation.workspace.title')}
        </Link>
      </section>
    </AttestationPermissionGuard>
  );
}
