import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Upload,
  Loader2,
  AlertTriangle,
  ShieldAlert,
  Trash2,
  Archive,
  Download,
  Eraser,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchImportJobs,
  fetchImportJob,
  fetchImportRows,
  uploadImportJob,
  validateImportJob,
  confirmImportJob,
  deleteImportJob,
  archiveImportJob,
  clearUnconfirmedImports,
  downloadImportReport,
  type ImportJobApi,
  type ImportRowApi,
} from '@/app/lib/financialControlApi';
import { ApiError } from '@/app/lib/api';
import { useData } from '@/app/contexts/DataContext';
import { useAuth } from '@/app/contexts/AuthContext';
import { SectionHeader } from '@/app/components/financial-control/components/SectionHeader';
import { SectionCard } from '@/app/components/financial-control/components/SectionCard';
import { ImportMappingPanel } from '@/app/components/financial-control/ImportMappingPanel';
import { FinancialStatusBadge } from '@/app/components/financial-control/components/FinancialStatusBadge';
import { EmptyFinancialState } from '@/app/components/financial-control/components/EmptyFinancialState';
import { fmtAed } from '@/app/components/financial-control/utils/format';
import { cn } from '@/app/components/ui/utils';

const ROW_FILTERS = ['all', 'valid', 'warning', 'error', 'imported', 'skipped'] as const;
type RowFilter = (typeof ROW_FILTERS)[number];
const PAGE_SIZE = 100;

const DELETABLE_STATUSES = ['pending', 'preview', 'validated', 'failed', 'cancelled'];

export function ExcelImportPage() {
  const { t, i18n } = useTranslation();
  const { refreshBankCards } = useData();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const fileRef = useRef<HTMLInputElement>(null);

  const [jobs, setJobs] = useState<ImportJobApi[]>([]);
  const [selected, setSelected] = useState<ImportJobApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reviewedAck, setReviewedAck] = useState(false);
  const [warningAck, setWarningAck] = useState(false);

  const [rows, setRows] = useState<ImportRowApi[]>([]);
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');
  const [rowPage, setRowPage] = useState(1);
  const [rowCount, setRowCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(false);

  const [modal, setModal] = useState<{ job: ImportJobApi; mode: 'delete' | 'archive' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProfile, setUploadProfile] = useState('bizmanager_legacy');

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      setJobs(await fetchImportJobs());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const loadRows = useCallback(async (jobId: string, status: RowFilter, page: number) => {
    setRowsLoading(true);
    try {
      const data = await fetchImportRows(jobId, { status, page, page_size: PAGE_SIZE });
      setRows(data.results);
      setRowCount(data.count);
      setTotalPages(data.total_pages);
    } catch {
      toast.error(t('financialControl.shell.loadError'));
    } finally {
      setRowsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (selected?.id) loadRows(selected.id, rowFilter, rowPage);
  }, [selected?.id, rowFilter, rowPage, loadRows]);

  const openJob = async (id: string) => {
    setReviewedAck(false);
    setWarningAck(false);
    setRowFilter('all');
    setRowPage(1);
    try {
      setSelected(await fetchImportJob(id));
    } catch {
      toast.error(t('financialControl.shell.loadError'));
    }
  };

  const refreshSelected = async (id: string) => {
    try {
      setSelected(await fetchImportJob(id));
    } catch {
      /* ignore */
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const job = await uploadImportJob(file, uploadProfile);
      toast.success(t('financialControl.excelImport.uploaded'));
      await loadJobs();
      setReviewedAck(false);
      setWarningAck(false);
      setRowFilter('all');
      setRowPage(1);
      setSelected(job);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        const body = e.body as { detail?: string; field_errors?: Record<string, string> } | null;
        const fieldMsg = body?.field_errors ? Object.values(body.field_errors).join(' ') : '';
        toast.error(body?.detail || fieldMsg || e.detail || t('financialControl.shell.loadError'));
      } else {
        toast.error((e as Error)?.message || t('financialControl.shell.loadError'));
      }
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!selected) return;
    setConfirming(true);
    try {
      await confirmImportJob(selected.id);
      toast.success(t('financialControl.excelImport.importCompleted'));
      await refreshBankCards();
      await refreshSelected(selected.id);
      await loadJobs();
      loadRows(selected.id, rowFilter, 1);
      setRowPage(1);
    } catch (e: unknown) {
      const detail =
        e instanceof ApiError ? (e.body as { detail?: string } | null)?.detail || e.detail : '';
      toast.error(detail || t('financialControl.excelImport.importFailed'));
      await refreshSelected(selected.id);
    } finally {
      setConfirming(false);
    }
  };

  const confirmModal = async () => {
    if (!modal) return;
    setBusy(true);
    try {
      if (modal.mode === 'delete') {
        await deleteImportJob(modal.job.id);
        toast.success(t('financialControl.excelImport.deleted'));
      } else {
        await archiveImportJob(modal.job.id);
        toast.success(t('financialControl.excelImport.archived'));
      }
      if (selected?.id === modal.job.id) setSelected(null);
      setModal(null);
      await loadJobs();
    } catch (e: unknown) {
      const detail =
        e instanceof ApiError ? (e.body as { detail?: string } | null)?.detail || e.detail : '';
      toast.error(detail || t('financialControl.shell.loadError'));
    } finally {
      setBusy(false);
    }
  };

  const handleClearUnconfirmed = async () => {
    setBusy(true);
    try {
      const r = await clearUnconfirmedImports();
      toast.success(t('financialControl.excelImport.cleared', { count: r.deleted }));
      setSelected(null);
      await loadJobs();
    } catch (e: unknown) {
      const detail =
        e instanceof ApiError ? (e.body as { detail?: string } | null)?.detail || e.detail : '';
      toast.error(detail || t('financialControl.shell.loadError'));
    } finally {
      setBusy(false);
    }
  };

  const preview = selected?.summary_json?.preview_summary;
  const isCompleted = selected?.status === 'completed' || selected?.status === 'confirmed';
  const validRows = selected?.valid_rows ?? 0;
  const errorRows = selected?.error_rows ?? 0;
  const warningRows = selected?.warning_rows ?? 0;
  const noImportable = validRows === 0;
  const highUnknown = (preview?.unknown_ratio ?? 0) >= 0.5;

  const canConfirm =
    !!selected &&
    !isCompleted &&
    !noImportable &&
    errorRows === 0 &&
    reviewedAck &&
    (warningRows === 0 || warningAck) &&
    !confirming;

  const byTypeEntries = useMemo(
    () => Object.entries(preview?.by_type ?? {}).filter(([type]) => type !== 'unknown'),
    [preview]
  );

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader title={t('financialControl.nav.excelImport')} subtitle={t('financialControl.excelImport.subtitle')}>
        <select
          value={uploadProfile}
          onChange={(e) => setUploadProfile(e.target.value)}
          title={t('financialControl.excelImport.profile')}
          className="border border-slate-300 rounded-lg px-2 py-2 text-sm"
        >
          <option value="generic">{t('financialControl.excelImport.profile_generic')}</option>
          <option value="bizmanager_legacy">{t('financialControl.excelImport.profile_bizmanager_legacy')}</option>
          <option value="custom">{t('financialControl.excelImport.profile_custom')}</option>
        </select>
        {isAdmin && (
          <button
            type="button"
            disabled={busy}
            onClick={handleClearUnconfirmed}
            className="flex items-center gap-2 px-3 py-2 border border-slate-300 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            <Eraser className="size-4" />
            {t('financialControl.excelImport.clearUnconfirmed')}
          </button>
        )}
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {t('financialControl.excelImport.upload')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
            e.target.value = '';
          }}
        />
      </SectionHeader>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 flex gap-2">
        <ShieldAlert className="size-4 flex-shrink-0 mt-0.5" />
        {t('financialControl.excelImport.previewOnly')}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <SectionCard title={t('financialControl.excelImport.jobsTitle')}>
            {jobs.length === 0 ? (
              <EmptyFinancialState message={t('financialControl.excelImport.noJobs')} />
            ) : (
              <div className="divide-y divide-slate-50 max-h-[480px] overflow-y-auto">
                {jobs.map((j) => {
                  const completed = j.status === 'completed' || j.status === 'confirmed';
                  const deletable = DELETABLE_STATUSES.includes(j.status);
                  return (
                    <div
                      key={j.id}
                      className={cn(
                        'flex items-center gap-1 px-2 hover:bg-slate-50 transition-colors',
                        selected?.id === j.id && 'bg-slate-50'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => openJob(j.id)}
                        className="flex-1 text-start py-3 px-2 min-w-0"
                      >
                        <div className="font-medium text-sm truncate">{j.original_filename}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <FinancialStatusBadge status={j.status} />
                          <span className="text-xs text-slate-400">
                            {j.valid_rows}/{j.total_rows} {t('financialControl.excelImport.valid')}
                          </span>
                        </div>
                      </button>
                      {completed ? (
                        <button
                          type="button"
                          title={t('financialControl.excelImport.archive')}
                          onClick={() => setModal({ job: j, mode: 'archive' })}
                          className="p-2 text-slate-400 hover:text-slate-700"
                        >
                          <Archive className="size-4" />
                        </button>
                      ) : (
                        deletable && (
                          <button
                            type="button"
                            title={t('financialControl.excelImport.delete')}
                            onClick={() => setModal({ job: j, mode: 'delete' })}
                            className="p-2 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {!selected ? (
            <EmptyFinancialState message={t('financialControl.excelImport.selectJob')} />
          ) : (
            <>
              <SectionCard>
                <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm">
                  <div>
                    <div className="text-xs text-slate-400">{t('financialControl.excelImport.sheets')}</div>
                    <div className="font-bold">{selected.total_sheets}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">{t('financialControl.excelImport.rows')}</div>
                    <div className="font-bold">{selected.total_rows}</div>
                  </div>
                  <div>
                    <div className="text-xs text-emerald-600">{t('financialControl.excelImport.valid')}</div>
                    <div className="font-bold text-emerald-700">{selected.valid_rows}</div>
                  </div>
                  <div>
                    <div className="text-xs text-red-600">{t('financialControl.excelImport.errors')}</div>
                    <div className="font-bold text-red-700">{selected.error_rows}</div>
                  </div>
                </div>

                {selected.summary_json?.duplicate_file && (
                  <div className="mx-4 mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    <div className="flex gap-2 font-medium">
                      <AlertTriangle className="size-3.5 flex-shrink-0 mt-0.5" />
                      {t('financialControl.excelImport.duplicateFile')}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-2 ps-5">
                      {selected.summary_json.duplicate_job_id && (
                        <button
                          type="button"
                          className="underline hover:text-amber-900"
                          onClick={() => openJob(selected.summary_json!.duplicate_job_id as string)}
                        >
                          {t('financialControl.excelImport.viewPrevious')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="underline hover:text-red-700"
                        onClick={() => setModal({ job: selected, mode: 'delete' })}
                      >
                        {t('financialControl.excelImport.deleteDuplicate')}
                      </button>
                    </div>
                  </div>
                )}

                <div className="px-4 pb-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 text-sm border rounded-lg hover:bg-slate-50"
                    onClick={async () => {
                      try {
                        const refreshed = await validateImportJob(selected.id);
                        setSelected(refreshed);
                        setRowPage(1);
                        toast.success(t('financialControl.excelImport.revalidated'));
                      } catch {
                        toast.error(t('financialControl.shell.loadError'));
                      }
                    }}
                  >
                    {t('financialControl.excelImport.revalidate')}
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg hover:bg-slate-50"
                    onClick={() =>
                      downloadImportReport(selected.id, `import_report_${selected.id}.csv`).catch(() =>
                        toast.error(t('financialControl.shell.loadError'))
                      )
                    }
                  >
                    <Download className="size-3.5" />
                    {t('financialControl.excelImport.downloadReport')}
                  </button>
                </div>
              </SectionCard>

              {!isCompleted && (
                <ImportMappingPanel
                  jobId={selected.id}
                  onValidated={() => {
                    setReviewedAck(false);
                    setWarningAck(false);
                    setRowPage(1);
                    refreshSelected(selected.id);
                    loadRows(selected.id, rowFilter, 1);
                  }}
                />
              )}

              {highUnknown && !isCompleted && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-sm text-orange-800">
                  <div className="flex gap-2 font-medium">
                    <AlertTriangle className="size-4 flex-shrink-0 mt-0.5" />
                    {t('financialControl.excelImport.mostlyUnknown')}
                  </div>
                  {preview?.top_sheets?.length ? (
                    <div className="mt-2 ps-6 text-xs space-y-0.5">
                      {preview.top_sheets.slice(0, 5).map((s) => (
                        <div key={s.name} className="flex justify-between max-w-xs">
                          <span className="truncate">{s.name}</span>
                          <span className="font-mono">{s.count}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}

              {isCompleted && selected.summary_json?.import_result ? (
                <SectionCard title={t('financialControl.excelImport.resultTitle')}>
                  <div className="p-4 grid grid-cols-3 gap-3 text-center text-sm">
                    <div>
                      <div className="text-xs text-emerald-600">{t('financialControl.excelImport.importedRows')}</div>
                      <div className="font-bold text-emerald-700">{selected.summary_json.import_result.imported_rows}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">{t('financialControl.excelImport.skippedRows')}</div>
                      <div className="font-bold">{selected.summary_json.import_result.skipped_rows}</div>
                    </div>
                    <div>
                      <div className="text-xs text-red-600">{t('financialControl.excelImport.failedRows')}</div>
                      <div className="font-bold text-red-700">{selected.summary_json.import_result.failed_rows}</div>
                    </div>
                  </div>
                  <div className="px-4 pb-4 text-xs text-slate-500 space-y-1">
                    {Object.entries(selected.summary_json.import_result.created || {})
                      .filter(([, n]) => Number(n) > 0)
                      .map(([k, n]) => (
                        <div key={k} className="flex justify-between">
                          <span className="capitalize">{k.replace('_', ' ')}</span>
                          <span className="font-semibold">{String(n)}</span>
                        </div>
                      ))}
                  </div>
                </SectionCard>
              ) : (
                !isCompleted && (
                  <SectionCard title={t('financialControl.excelImport.confirmTitle')}>
                    <div className="p-4 space-y-3 text-sm">
                      {byTypeEntries.length > 0 && (
                        <div className="space-y-1 text-xs">
                          {byTypeEntries.map(([type, info]) => (
                            <div key={type} className="flex justify-between">
                              <span className="capitalize text-slate-500">
                                {type.replace('_', ' ')} ({info.valid + info.warning})
                              </span>
                              <span className="font-mono font-semibold">
                                {fmtAed(info.total || 0, i18n.language)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {noImportable ? (
                        <div className="flex gap-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                          <AlertTriangle className="size-3.5 flex-shrink-0 mt-0.5" />
                          {t('financialControl.excelImport.noImportable')}
                        </div>
                      ) : (
                        <>
                          {errorRows > 0 && (
                            <div className="flex gap-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                              <AlertTriangle className="size-3.5 flex-shrink-0 mt-0.5" />
                              {t('financialControl.excelImport.blockingErrors', { count: errorRows })}
                            </div>
                          )}
                          {warningRows > 0 && (
                            <label className="flex items-start gap-2 text-xs text-amber-800">
                              <input
                                type="checkbox"
                                checked={warningAck}
                                onChange={(e) => setWarningAck(e.target.checked)}
                              />
                              {t('financialControl.excelImport.warningAck', { count: warningRows })}
                            </label>
                          )}
                          <label className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={reviewedAck}
                              onChange={(e) => setReviewedAck(e.target.checked)}
                            />
                            <span className="text-xs text-slate-600">
                              {t('financialControl.excelImport.reviewAck')}
                            </span>
                          </label>
                        </>
                      )}

                      <button
                        type="button"
                        disabled={!canConfirm}
                        onClick={handleConfirm}
                        className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {confirming && <Loader2 className="size-4 animate-spin" />}
                        {t('financialControl.excelImport.confirmImport')}
                      </button>
                    </div>
                  </SectionCard>
                )
              )}

              <SectionCard title={t('financialControl.excelImport.previewRows')}>
                <div className="px-4 pt-3 flex flex-wrap items-center gap-2">
                  <select
                    className="border rounded-lg px-2 py-1.5 text-sm"
                    value={rowFilter}
                    onChange={(e) => {
                      setRowFilter(e.target.value as RowFilter);
                      setRowPage(1);
                    }}
                  >
                    {ROW_FILTERS.map((f) => (
                      <option key={f} value={f}>
                        {t(`financialControl.excelImport.filter_${f}`)}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-slate-400">
                    {t('financialControl.excelImport.rowsCount', { count: rowCount })}
                  </span>
                  {rowsLoading && <Loader2 className="size-4 animate-spin text-slate-300" />}
                </div>

                <div className="overflow-x-auto max-h-[420px] mt-2">
                  <table className="w-full text-xs min-w-[700px]">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="text-slate-400 uppercase">
                        <th className="px-3 py-2 text-start">{t('financialControl.excelImport.sheet')}</th>
                        <th className="px-3 py-2 text-start">#</th>
                        <th className="px-3 py-2 text-start">{t('financialControl.excelImport.type')}</th>
                        <th className="px-3 py-2 text-start">{t('financialControl.expenses.date')}</th>
                        <th className="px-3 py-2 text-end">{t('financialControl.ledger.amount')}</th>
                        <th className="px-3 py-2 text-start">{t('common.status', { defaultValue: 'Status' })}</th>
                        <th className="px-3 py-2 text-start">{t('financialControl.excelImport.message')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {rows.map((r) => {
                        const n = r.normalized_data_json || {};
                        return (
                          <tr key={r.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2">{r.sheet_name}</td>
                            <td className="px-3 py-2">{r.row_number}</td>
                            <td className="px-3 py-2">{r.detected_type}</td>
                            <td className="px-3 py-2"><bdi>{String(n.date || n.due_date || '—')}</bdi></td>
                            <td className="px-3 py-2 text-end font-mono">{String(n.amount ?? '—')}</td>
                            <td className="px-3 py-2">
                              <FinancialStatusBadge status={r.status} />
                            </td>
                            <td className="px-3 py-2 text-slate-500 max-w-[200px] truncate">
                              {String(r.error_message || r.warning_message || n.description || n.payee || '—')}
                            </td>
                          </tr>
                        );
                      })}
                      {!rowsLoading && rows.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                            {t('financialControl.excelImport.noRows')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="px-4 py-3 flex items-center justify-between text-sm border-t border-slate-50">
                    <button
                      type="button"
                      disabled={rowPage <= 1 || rowsLoading}
                      onClick={() => setRowPage((p) => Math.max(1, p - 1))}
                      className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-slate-50"
                    >
                      {t('common.previous', { defaultValue: 'Previous' })}
                    </button>
                    <span className="text-xs text-slate-500">
                      {t('financialControl.excelImport.pageOf', { page: rowPage, total: totalPages })}
                    </span>
                    <button
                      type="button"
                      disabled={rowPage >= totalPages || rowsLoading}
                      onClick={() => setRowPage((p) => Math.min(totalPages, p + 1))}
                      className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-slate-50"
                    >
                      {t('common.next', { defaultValue: 'Next' })}
                    </button>
                  </div>
                )}
              </SectionCard>
            </>
          )}
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center gap-2 font-semibold text-slate-800">
              {modal.mode === 'delete' ? <Trash2 className="size-5 text-red-600" /> : <Archive className="size-5 text-slate-600" />}
              {modal.mode === 'delete'
                ? t('financialControl.excelImport.deleteTitle')
                : t('financialControl.excelImport.archiveTitle')}
            </div>
            <p className="text-sm text-slate-600">
              {t('financialControl.excelImport.deleteHelper')}
            </p>
            <div className="text-xs text-slate-400 truncate">{modal.job.original_filename}</div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setModal(null)}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50 disabled:opacity-50"
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={confirmModal}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50',
                  modal.mode === 'delete' ? 'bg-red-600' : 'bg-slate-800'
                )}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {modal.mode === 'delete'
                  ? t('financialControl.excelImport.delete')
                  : t('financialControl.excelImport.archive')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
