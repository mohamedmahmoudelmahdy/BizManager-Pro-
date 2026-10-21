import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileUp, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
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
  uploadStatementComparison,
  type StatementComparisonJob,
} from '@/app/lib/paymentMethodApi';

const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

type Props = {
  cardId: string;
  open: boolean;
  onClose: () => void;
  onCompared: (job: StatementComparisonJob) => void;
};

export function CompareBankStatementModal({ cardId, open, onClose, onCompared }: Props) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setFile(null);
    setLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const isAccepted = (name: string) =>
    ACCEPTED_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!isAccepted(selected.name)) {
      toast.error(t('financialControl.paymentMethods.comparison.invalidFormat'));
      return;
    }
    setFile(selected);
  };

  const handleCompare = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const job = await uploadStatementComparison(cardId, file);
      onCompared(job);
      reset();
      onClose();
    } catch (err) {
      const message =
        err instanceof ApiError && err.body && typeof err.body === 'object' && 'detail' in err.body
          ? String((err.body as { detail: string }).detail)
          : t('financialControl.paymentMethods.comparison.failed');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('financialControl.paymentMethods.comparison.title')}</DialogTitle>
          <DialogDescription>
            {t('financialControl.paymentMethods.comparison.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {t('financialControl.paymentMethods.comparison.supportedFormats')}
          </p>

          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-xl p-8 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
            />
            {file ? (
              <>
                <FileUp className="size-8 text-indigo-600" />
                <span className="text-sm font-medium text-slate-800">{file.name}</span>
              </>
            ) : (
              <>
                <Upload className="size-8 text-slate-400" />
                <span className="text-sm text-slate-600">
                  {t('financialControl.paymentMethods.comparison.chooseFile')}
                </span>
              </>
            )}
          </label>

          <p className="text-xs text-slate-500">
            {t('financialControl.paymentMethods.comparison.auditOnly')}
          </p>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!file || loading}
            onClick={() => void handleCompare()}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {t('financialControl.paymentMethods.comparison.runComparison')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
