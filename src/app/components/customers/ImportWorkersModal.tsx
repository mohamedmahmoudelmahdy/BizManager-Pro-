import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, FileUp, Loader2, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/app/components/ui/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import { ApiError } from '@/app/lib/api';
import {
  confirmWorkersCsvImport,
  previewWorkersCsvImport,
  type WorkerImportPreviewResponse,
} from '@/app/lib/customerApi';

type Props = {
  customerId: string;
  customerName: string;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
};

export function ImportWorkersModal({ customerId, customerName, open, onClose, onImported }: Props) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<WorkerImportPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setLoading(false);
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const runPreview = async (selected: File) => {
    setLoading(true);
    setPreview(null);
    try {
      const result = await previewWorkersCsvImport(customerId, selected);
      setPreview(result);
    } catch (err) {
      const message =
        err instanceof ApiError && err.body && typeof err.body === 'object' && 'detail' in err.body
          ? String((err.body as { detail: string }).detail)
          : t('customers.workers.importFailed');
      toast.error(message);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.csv')) {
      toast.error(t('customers.workers.importCsvOnly'));
      return;
    }
    setFile(selected);
    void runPreview(selected);
  };

  const handleConfirm = async () => {
    if (!file || !preview?.can_import) return;
    setImporting(true);
    try {
      const result = await confirmWorkersCsvImport(customerId, file);
      toast.success(
        t('customers.workers.importSuccess', {
          created: result.created,
          skipped: result.skipped,
        })
      );
      onImported();
      handleClose();
    } catch (err) {
      const message =
        err instanceof ApiError && err.body && typeof err.body === 'object' && 'detail' in err.body
          ? String((err.body as { detail: string }).detail)
          : t('customers.workers.importFailed');
      toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  const statusClass = (status: string) =>
    status === 'valid'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'warning'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-rose-50 text-rose-700';

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="size-5" />
            {t('customers.workers.importTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('customers.workers.importDesc', { name: customerName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <FileUp className="size-4" />
              {t('customers.workers.chooseCsv')}
            </button>
            {file && (
              <p className="mt-2 text-sm text-slate-600">
                {t('customers.workers.selectedFile')}: <span className="font-medium">{file.name}</span>
              </p>
            )}
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" />
              {t('customers.workers.importPreviewLoading')}
            </div>
          )}

          {preview && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: t('customers.workers.importTotal'), value: preview.counts.total },
                  { label: t('customers.workers.importValid'), value: preview.counts.valid },
                  { label: t('customers.workers.importWarnings'), value: preview.counts.warning },
                  { label: t('customers.workers.importErrors'), value: preview.counts.error },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-xs text-slate-500">{item.label}</div>
                    <div className="text-lg font-bold text-slate-900">{item.value}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-left">{t('customers.workers.name')}</th>
                        <th className="px-3 py-2 text-left">{t('customers.workers.residencyVisa')}</th>
                        <th className="px-3 py-2 text-left">{t('customers.workers.insurance')}</th>
                        <th className="px-3 py-2 text-left">{t('customers.workers.importStatus')}</th>
                        <th className="px-3 py-2 text-left">{t('customers.workers.importMessages')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.rows.map((row) => (
                        <tr key={row.row_number}>
                          <td className="px-3 py-2 text-slate-500">{row.row_number}</td>
                          <td className="px-3 py-2 font-medium">{row.mapped.name || '—'}</td>
                          <td className="px-3 py-2 font-mono text-xs">{row.mapped.residency_expiry || '—'}</td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {row.mapped.no_health_insurance ? '—' : row.mapped.insurance_expiry || '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', statusClass(row.status))}>
                              {row.status === 'valid' && <CheckCircle2 className="size-3" />}
                              {row.status === 'warning' && <AlertCircle className="size-3" />}
                              {row.status === 'error' && <XCircle className="size-3" />}
                              {row.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600">
                            {[...row.errors, ...row.warnings].join(' · ') || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {!preview.can_import && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {t('customers.workers.importBlocked')}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!preview?.can_import || importing}
            onClick={handleConfirm}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {importing && <Loader2 className="size-4 animate-spin" />}
            {t('customers.workers.confirmImport')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
