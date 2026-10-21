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
import { marketingChannelsApi } from '@/app/lib/marketingApi';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { MarketingChannel } from '@/app/lib/marketingTypes';
import {
  marketingInputClass,
  marketingLabelClass,
} from '@/app/components/marketing/campaigns/marketingFormStyles';

type ChannelFormDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  channel?: MarketingChannel | null;
};

export function ChannelFormDialog({ open, onClose, onSuccess, channel }: ChannelFormDialogProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(channel);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(channel?.name ?? '');
    setCode(channel?.code ?? '');
    setDescription(channel?.description ?? '');
  }, [open, channel]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t('marketing.campaignManagement.validation.nameRequired'));
      return;
    }
    if (!isEdit && !code.trim()) {
      toast.error(t('marketing.campaignManagement.validation.codeRequired'));
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit && channel) {
        await marketingChannelsApi.update(channel.id, {
          name: name.trim(),
          description: description.trim(),
        });
        toast.success(t('marketing.campaignManagement.channel.updated'));
      } else {
        await marketingChannelsApi.create({
          name: name.trim(),
          code: code.trim(),
          description: description.trim(),
        });
        toast.success(t('marketing.campaignManagement.channel.created'));
      }
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
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t('marketing.campaignManagement.channel.edit')
              : t('marketing.campaignManagement.channel.create')}
          </DialogTitle>
          <DialogDescription>
            {t('marketing.campaignManagement.channel.formHint')}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="channel-name" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.name')} *
            </label>
            <input
              id="channel-name"
              className={marketingInputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div>
            <label htmlFor="channel-code" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.code')} *
            </label>
            <input
              id="channel-code"
              className={marketingInputClass}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={isEdit}
              dir="ltr"
              required={!isEdit}
            />
            {isEdit ? (
              <p className="mt-1 text-xs text-slate-400">
                {t('marketing.campaignManagement.fields.codeImmutable')}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="channel-description" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.description')}
            </label>
            <textarea
              id="channel-description"
              className={marketingInputClass}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin me-2" /> : null}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
