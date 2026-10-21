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
import { marketingPlatformsApi } from '@/app/lib/marketingApi';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { MarketingPlatform } from '@/app/lib/marketingTypes';
import { ChannelSelect } from '@/app/components/marketing/campaigns/HierarchySelects';
import {
  marketingInputClass,
  marketingLabelClass,
} from '@/app/components/marketing/campaigns/marketingFormStyles';

type PlatformFormDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  platform?: MarketingPlatform | null;
};

export function PlatformFormDialog({
  open,
  onClose,
  onSuccess,
  platform,
}: PlatformFormDialogProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(platform);
  const [submitting, setSubmitting] = useState(false);
  const [channelId, setChannelId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) return;
    setChannelId(platform?.channel?.id ?? '');
    setName(platform?.name ?? '');
    setCode(platform?.code ?? '');
    setDescription(platform?.description ?? '');
  }, [open, platform]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelId) {
      toast.error(t('marketing.campaignManagement.validation.channelRequired'));
      return;
    }
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
      if (isEdit && platform) {
        await marketingPlatformsApi.update(platform.id, {
          channel_id: channelId,
          name: name.trim(),
          description: description.trim(),
        });
        toast.success(t('marketing.campaignManagement.platform.updated'));
      } else {
        await marketingPlatformsApi.create({
          channel_id: channelId,
          name: name.trim(),
          code: code.trim(),
          description: description.trim(),
        });
        toast.success(t('marketing.campaignManagement.platform.created'));
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
              ? t('marketing.campaignManagement.platform.edit')
              : t('marketing.campaignManagement.platform.create')}
          </DialogTitle>
          <DialogDescription>
            {t('marketing.campaignManagement.platform.formHint')}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <ChannelSelect
            id="platform-channel"
            label={t('marketing.campaignManagement.fields.channel')}
            value={channelId}
            onChange={setChannelId}
            required
            selectedLabel={platform?.channel?.name}
          />
          <div>
            <label htmlFor="platform-name" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.name')} *
            </label>
            <input
              id="platform-name"
              className={marketingInputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div>
            <label htmlFor="platform-code" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.code')} *
            </label>
            <input
              id="platform-code"
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
            <label htmlFor="platform-description" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.description')}
            </label>
            <textarea
              id="platform-description"
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
