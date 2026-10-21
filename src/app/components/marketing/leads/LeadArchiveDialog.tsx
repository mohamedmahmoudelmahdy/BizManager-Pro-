import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { marketingLeadsApi } from '@/app/lib/marketingApi';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import {
  marketingInputClass,
  marketingLabelClass,
} from '@/app/components/marketing/campaigns/marketingFormStyles';

type LeadArchiveDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  leadId: string;
  leadName: string;
  leadNumber: string;
};

export function LeadArchiveDialog({
  open,
  onClose,
  onSuccess,
  leadId,
  leadName,
  leadNumber,
}: LeadArchiveDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const handleConfirm = async () => {
    if (!reason.trim()) {
      toast.error(t('marketing.leadManagement.validation.archiveReasonRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await marketingLeadsApi.archive(leadId, { reason: reason.trim() });
      toast.success(t('marketing.leadManagement.toasts.archived', { name: leadName }));
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(formatMarketingErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('marketing.leadManagement.archive.title')}</DialogTitle>
          <DialogDescription>
            {t('marketing.leadManagement.archive.description', {
              name: leadName,
              number: leadNumber,
            })}
          </DialogDescription>
        </DialogHeader>
        <div>
          <label htmlFor="lead-archive-reason" className={marketingLabelClass}>
            {t('marketing.leadManagement.archive.reason')} *
          </label>
          <textarea
            id="lead-archive-reason"
            className={marketingInputClass}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin me-2" /> : null}
            {t('marketing.leadManagement.archive.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
