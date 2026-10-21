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
import { marketingAdvertisementsApi } from '@/app/lib/marketingApi';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { MarketingAdvertisement } from '@/app/lib/marketingTypes';
import {
  AdSetSelect,
  CampaignSelect,
} from '@/app/components/marketing/campaigns/HierarchySelects';
import {
  marketingInputClass,
  marketingLabelClass,
} from '@/app/components/marketing/campaigns/marketingFormStyles';

type AdvertisementFormDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  advertisement?: MarketingAdvertisement | null;
};

export function AdvertisementFormDialog({
  open,
  onClose,
  onSuccess,
  advertisement,
}: AdvertisementFormDialogProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(advertisement);
  const [submitting, setSubmitting] = useState(false);
  const [campaignId, setCampaignId] = useState('');
  const [adSetId, setAdSetId] = useState('');
  const [name, setName] = useState('');
  const [externalReference, setExternalReference] = useState('');
  const [creativeReference, setCreativeReference] = useState('');

  useEffect(() => {
    if (!open) return;
    setCampaignId(advertisement?.campaign?.id ?? '');
    setAdSetId(advertisement?.ad_set?.id ?? '');
    setName(advertisement?.name ?? '');
    setExternalReference(advertisement?.external_reference ?? '');
    setCreativeReference(advertisement?.creative_reference ?? '');
  }, [open, advertisement]);

  const handleCampaignChange = (next: string) => {
    setCampaignId(next);
    setAdSetId('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campaignId) {
      toast.error(t('marketing.campaignManagement.validation.campaignRequired'));
      return;
    }
    if (!name.trim()) {
      toast.error(t('marketing.campaignManagement.validation.nameRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        campaign_id: campaignId,
        ad_set_id: adSetId || null,
        name: name.trim(),
        external_reference: externalReference.trim(),
        creative_reference: creativeReference.trim(),
      };
      if (isEdit && advertisement) {
        await marketingAdvertisementsApi.update(advertisement.id, payload);
        toast.success(t('marketing.campaignManagement.advertisement.updated'));
      } else {
        await marketingAdvertisementsApi.create(payload);
        toast.success(t('marketing.campaignManagement.advertisement.created'));
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
              ? t('marketing.campaignManagement.advertisement.edit')
              : t('marketing.campaignManagement.advertisement.create')}
          </DialogTitle>
          <DialogDescription>
            {t('marketing.campaignManagement.advertisement.formHint')}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <CampaignSelect
            id="ad-campaign"
            label={t('marketing.campaignManagement.fields.campaign')}
            value={campaignId}
            onChange={handleCampaignChange}
            required
            selectedLabel={advertisement?.campaign?.name}
          />
          <AdSetSelect
            id="ad-adset"
            label={t('marketing.campaignManagement.fields.adSet')}
            value={adSetId}
            onChange={setAdSetId}
            disabled={!campaignId}
            allowClear
            selectedLabel={advertisement?.ad_set?.name}
            extraParams={campaignId ? { campaign: campaignId } : undefined}
          />
          <div>
            <label htmlFor="ad-name" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.name')} *
            </label>
            <input
              id="ad-name"
              className={marketingInputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div>
            <label htmlFor="ad-ext" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.externalReference')}
            </label>
            <input
              id="ad-ext"
              className={marketingInputClass}
              value={externalReference}
              onChange={(e) => setExternalReference(e.target.value)}
              dir="ltr"
            />
          </div>
          <div>
            <label htmlFor="ad-creative" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.creativeReference')}
            </label>
            <input
              id="ad-creative"
              className={marketingInputClass}
              value={creativeReference}
              onChange={(e) => setCreativeReference(e.target.value)}
              dir="ltr"
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
