import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/app/components/ui/dialog';
import { ApiError } from '@/app/lib/api';
import { deleteImportedLedgerAccount } from '@/app/lib/financialControlApi';
import type { LedgerAccountApi } from '@/app/components/financial-control/types/ledger';

export function DeleteImportedLedgerModal({
  account,
  open,
  onClose,
  onSuccess,
}: {
  account: LedgerAccountApi;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const canDelete = account.can_delete_imported;
  const blockReason = account.delete_imported_reason;

  const handleConfirm = async () => {
    if (!canDelete) return;
    setSubmitting(true);
    try {
      const result = await deleteImportedLedgerAccount(account.id);
      toast.success(
        t('financialControl.ledger.deleteImportedSuccess', {
          name: result.deleted_account_name,
          count: result.deleted_entry_count,
        })
      );
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const detail =
        err instanceof ApiError &&
        err.body &&
        typeof err.body === 'object' &&
        'detail' in err.body
          ? String((err.body as { detail: string }).detail)
          : t('financialControl.ledger.deleteImportedFailed');
      toast.error(detail);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('financialControl.ledger.deleteImportedTitle')}</DialogTitle>
          <DialogDescription>{account.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>{t('financialControl.ledger.deleteImportedWarning')}</p>
          <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 space-y-1">
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">{t('financialControl.ledger.accountName')}</span>
              <span className="font-medium text-end">{account.name}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">{t('financialControl.ledger.deleteImportedEntryCount')}</span>
              <span className="font-semibold">{account.import_draft_entry_count}</span>
            </div>
          </div>
          {!canDelete && blockReason ? (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {blockReason}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <button type="button" className="px-4 py-2 text-sm border rounded-lg">
              {t('common.cancel')}
            </button>
          </DialogClose>
          <button
            type="button"
            disabled={submitting || !canDelete}
            onClick={handleConfirm}
            title={!canDelete ? blockReason : undefined}
            className="px-5 py-2 text-sm bg-rose-700 text-white rounded-lg font-semibold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('financialControl.ledger.confirmDeleteImported')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
