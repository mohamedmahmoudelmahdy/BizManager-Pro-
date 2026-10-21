import React, { useState } from 'react';
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
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';

type ArchiveEntityDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  entityName: string;
  archive: () => Promise<unknown>;
};

export function ArchiveEntityDialog({
  open,
  onClose,
  onSuccess,
  entityName,
  archive,
}: ArchiveEntityDialogProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await archive();
      toast.success(t('marketing.campaignManagement.archive.success', { name: entityName }));
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
          <DialogTitle>{t('marketing.campaignManagement.archive.title')}</DialogTitle>
          <DialogDescription>
            {t('marketing.campaignManagement.archive.description', { name: entityName })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('marketing.campaignManagement.archive.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
