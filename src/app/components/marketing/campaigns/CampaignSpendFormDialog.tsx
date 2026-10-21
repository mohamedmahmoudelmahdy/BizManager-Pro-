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
import { marketingCampaignSpendApi } from '@/app/lib/marketingApi';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { CampaignSpend } from '@/app/lib/marketingTypes';
import {
  AdSetSelect,
  CampaignSelect,
} from '@/app/components/marketing/campaigns/HierarchySelects';
import {
  marketingInputClass,
  marketingLabelClass,
} from '@/app/components/marketing/campaigns/marketingFormStyles';

type CampaignSpendFormDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  spend?: CampaignSpend | null;
};

export function CampaignSpendFormDialog({
  open,
  onClose,
  onSuccess,
  spend,
}: CampaignSpendFormDialogProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(spend);
  const [submitting, setSubmitting] = useState(false);
  const [campaignId, setCampaignId] = useState('');
  const [adSetId, setAdSetId] = useState('');
  const [spendDate, setSpendDate] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('AED');
  const [description, setDescription] = useState('');
  const [externalReference, setExternalReference] = useState('');

  useEffect(() => {
    if (!open) return;
    setCampaignId(spend?.campaign?.id ?? '');
    setAdSetId(spend?.ad_set?.id ?? '');
    setSpendDate(spend?.spend_date ?? '');
    setAmount(spend?.amount ?? '');
    setCurrency(spend?.currency ?? 'AED');
    setDescription(spend?.description ?? '');
    setExternalReference(spend?.external_reference ?? '');
  }, [open, spend]);

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
    if (!spendDate) {
      toast.error(t('marketing.campaignManagement.validation.spendDateRequired'));
      return;
    }
    if (!amount || Number(amount) <= 0) {
      toast.error(t('marketing.campaignManagement.validation.amountPositive'));
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        campaign_id: campaignId,
        ad_set_id: adSetId || null,
        spend_date: spendDate,
        amount,
        currency: currency.trim() || 'AED',
        description: description.trim(),
        external_reference: externalReference.trim(),
      };
      if (isEdit && spend) {
        await marketingCampaignSpendApi.update(spend.id, payload);
        toast.success(t('marketing.campaignManagement.spend.updated'));
      } else {
        await marketingCampaignSpendApi.create(payload);
        toast.success(t('marketing.campaignManagement.spend.created'));
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
              ? t('marketing.campaignManagement.spend.edit')
              : t('marketing.campaignManagement.spend.create')}
          </DialogTitle>
          <DialogDescription>{t('marketing.campaignManagement.spend.formHint')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <CampaignSelect
            id="spend-campaign"
            label={t('marketing.campaignManagement.fields.campaign')}
            value={campaignId}
            onChange={handleCampaignChange}
            required
            selectedLabel={spend?.campaign?.name}
          />
          <AdSetSelect
            id="spend-adset"
            label={t('marketing.campaignManagement.fields.adSet')}
            value={adSetId}
            onChange={setAdSetId}
            disabled={!campaignId}
            allowClear
            selectedLabel={spend?.ad_set?.name}
            extraParams={campaignId ? { campaign: campaignId } : undefined}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="spend-date" className={marketingLabelClass}>
                {t('marketing.campaignManagement.fields.spendDate')} *
              </label>
              <input
                id="spend-date"
                type="date"
                className={marketingInputClass}
                value={spendDate}
                onChange={(e) => setSpendDate(e.target.value)}
                dir="ltr"
                required
              />
            </div>
            <div>
              <label htmlFor="spend-amount" className={marketingLabelClass}>
                {t('marketing.campaignManagement.fields.amount')} *
              </label>
              <input
                id="spend-amount"
                type="number"
                step="0.01"
                min="0.01"
                className={marketingInputClass}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                dir="ltr"
                required
              />
            </div>
          </div>
          <div>
            <label htmlFor="spend-currency" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.currency')}
            </label>
            <input
              id="spend-currency"
              className={marketingInputClass}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              dir="ltr"
            />
          </div>
          <div>
            <label htmlFor="spend-description" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.description')}
            </label>
            <textarea
              id="spend-description"
              className={marketingInputClass}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="spend-ext" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.externalReference')}
            </label>
            <input
              id="spend-ext"
              className={marketingInputClass}
              value={externalReference}
              onChange={(e) => setExternalReference(e.target.value)}
              dir="ltr"
            />
          </div>
          {isEdit && spend?.expense_id ? (
            <div>
              <label className={marketingLabelClass}>
                {t('marketing.campaignManagement.fields.expenseId')}
              </label>
              <p className="text-sm font-mono text-slate-600" dir="ltr">
                {spend.expense_id}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {t('marketing.campaignManagement.spend.expenseReadOnly')}
              </p>
            </div>
          ) : null}
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
