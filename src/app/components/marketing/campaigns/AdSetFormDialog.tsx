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
import { marketingAdSetsApi } from '@/app/lib/marketingApi';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { MarketingAdSet } from '@/app/lib/marketingTypes';
import { CampaignSelect } from '@/app/components/marketing/campaigns/HierarchySelects';
import {
  marketingInputClass,
  marketingLabelClass,
} from '@/app/components/marketing/campaigns/marketingFormStyles';

type AdSetFormDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  adSet?: MarketingAdSet | null;
};

export function AdSetFormDialog({ open, onClose, onSuccess, adSet }: AdSetFormDialogProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(adSet);
  const [submitting, setSubmitting] = useState(false);
  const [campaignId, setCampaignId] = useState('');
  const [name, setName] = useState('');
  const [externalReference, setExternalReference] = useState('');
  const [budget, setBudget] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (!open) return;
    setCampaignId(adSet?.campaign?.id ?? '');
    setName(adSet?.name ?? '');
    setExternalReference(adSet?.external_reference ?? '');
    setBudget(adSet?.budget ?? '');
    setStartDate(adSet?.start_date ?? '');
    setEndDate(adSet?.end_date ?? '');
  }, [open, adSet]);

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
    if (startDate && endDate && endDate < startDate) {
      toast.error(t('marketing.campaignManagement.validation.dateOrder'));
      return;
    }
    if (budget !== '' && Number(budget) < 0) {
      toast.error(t('marketing.campaignManagement.validation.budgetInvalid'));
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        campaign_id: campaignId,
        name: name.trim(),
        external_reference: externalReference.trim(),
        budget: budget === '' ? null : budget,
        start_date: startDate || null,
        end_date: endDate || null,
      };
      if (isEdit && adSet) {
        await marketingAdSetsApi.update(adSet.id, payload);
        toast.success(t('marketing.campaignManagement.adSet.updated'));
      } else {
        await marketingAdSetsApi.create(payload);
        toast.success(t('marketing.campaignManagement.adSet.created'));
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
              ? t('marketing.campaignManagement.adSet.edit')
              : t('marketing.campaignManagement.adSet.create')}
          </DialogTitle>
          <DialogDescription>{t('marketing.campaignManagement.adSet.formHint')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <CampaignSelect
            id="adset-campaign"
            label={t('marketing.campaignManagement.fields.campaign')}
            value={campaignId}
            onChange={setCampaignId}
            required
            selectedLabel={adSet?.campaign?.name}
          />
          <div>
            <label htmlFor="adset-name" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.name')} *
            </label>
            <input
              id="adset-name"
              className={marketingInputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div>
            <label htmlFor="adset-ext" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.externalReference')}
            </label>
            <input
              id="adset-ext"
              className={marketingInputClass}
              value={externalReference}
              onChange={(e) => setExternalReference(e.target.value)}
              dir="ltr"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="adset-start" className={marketingLabelClass}>
                {t('marketing.campaignManagement.fields.startDate')}
              </label>
              <input
                id="adset-start"
                type="date"
                className={marketingInputClass}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                dir="ltr"
              />
            </div>
            <div>
              <label htmlFor="adset-end" className={marketingLabelClass}>
                {t('marketing.campaignManagement.fields.endDate')}
              </label>
              <input
                id="adset-end"
                type="date"
                className={marketingInputClass}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                dir="ltr"
              />
            </div>
          </div>
          <div>
            <label htmlFor="adset-budget" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.budget')}
            </label>
            <input
              id="adset-budget"
              type="number"
              step="0.01"
              min="0"
              className={marketingInputClass}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
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
