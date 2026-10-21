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
import { marketingCampaignsApi } from '@/app/lib/marketingApi';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { CampaignStatus, MarketingCampaign } from '@/app/lib/marketingTypes';
import { PlatformSelect } from '@/app/components/marketing/campaigns/HierarchySelects';
import {
  marketingInputClass,
  marketingLabelClass,
} from '@/app/components/marketing/campaigns/marketingFormStyles';

const STATUSES: CampaignStatus[] = ['draft', 'active', 'paused', 'completed', 'cancelled'];

type CampaignFormDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  campaign?: MarketingCampaign | null;
};

export function CampaignFormDialog({
  open,
  onClose,
  onSuccess,
  campaign,
}: CampaignFormDialogProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(campaign);
  const [submitting, setSubmitting] = useState(false);
  const [platformId, setPlatformId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [objective, setObjective] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [budget, setBudget] = useState('');
  const [currency, setCurrency] = useState('AED');
  const [status, setStatus] = useState<CampaignStatus>('draft');

  useEffect(() => {
    if (!open) return;
    setPlatformId(campaign?.platform?.id ?? '');
    setName(campaign?.name ?? '');
    setCode(campaign?.code ?? '');
    setDescription(campaign?.description ?? '');
    setObjective(campaign?.objective ?? '');
    setStartDate(campaign?.start_date ?? '');
    setEndDate(campaign?.end_date ?? '');
    setBudget(campaign?.budget ?? '');
    setCurrency(campaign?.currency ?? 'AED');
    setStatus((campaign?.status as CampaignStatus) || 'draft');
  }, [open, campaign]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!platformId) {
      toast.error(t('marketing.campaignManagement.validation.platformRequired'));
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
        platform_id: platformId,
        name: name.trim(),
        description: description.trim(),
        objective: objective.trim(),
        start_date: startDate || null,
        end_date: endDate || null,
        budget: budget === '' ? null : budget,
        currency: currency.trim() || 'AED',
        status,
      };
      if (isEdit && campaign) {
        await marketingCampaignsApi.update(campaign.id, payload);
        toast.success(t('marketing.campaignManagement.campaign.updated'));
      } else {
        await marketingCampaignsApi.create({ ...payload, code: code.trim() });
        toast.success(t('marketing.campaignManagement.campaign.created'));
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
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t('marketing.campaignManagement.campaign.edit')
              : t('marketing.campaignManagement.campaign.create')}
          </DialogTitle>
          <DialogDescription>
            {t('marketing.campaignManagement.campaign.formHint')}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <PlatformSelect
            id="campaign-platform"
            label={t('marketing.campaignManagement.fields.platform')}
            value={platformId}
            onChange={setPlatformId}
            required
            selectedLabel={campaign?.platform?.name}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="campaign-name" className={marketingLabelClass}>
                {t('marketing.campaignManagement.fields.name')} *
              </label>
              <input
                id="campaign-name"
                className={marketingInputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div>
              <label htmlFor="campaign-code" className={marketingLabelClass}>
                {t('marketing.campaignManagement.fields.code')} *
              </label>
              <input
                id="campaign-code"
                className={marketingInputClass}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={isEdit}
                dir="ltr"
                required={!isEdit}
              />
            </div>
          </div>
          <div>
            <label htmlFor="campaign-status" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.status')}
            </label>
            <select
              id="campaign-status"
              className={marketingInputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as CampaignStatus)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`marketing.campaignManagement.status.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="campaign-start" className={marketingLabelClass}>
                {t('marketing.campaignManagement.fields.startDate')}
              </label>
              <input
                id="campaign-start"
                type="date"
                className={marketingInputClass}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                dir="ltr"
              />
            </div>
            <div>
              <label htmlFor="campaign-end" className={marketingLabelClass}>
                {t('marketing.campaignManagement.fields.endDate')}
              </label>
              <input
                id="campaign-end"
                type="date"
                className={marketingInputClass}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                dir="ltr"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="campaign-budget" className={marketingLabelClass}>
                {t('marketing.campaignManagement.fields.budget')}
              </label>
              <input
                id="campaign-budget"
                type="number"
                step="0.01"
                min="0"
                className={marketingInputClass}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                dir="ltr"
              />
            </div>
            <div>
              <label htmlFor="campaign-currency" className={marketingLabelClass}>
                {t('marketing.campaignManagement.fields.currency')}
              </label>
              <input
                id="campaign-currency"
                className={marketingInputClass}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                dir="ltr"
              />
            </div>
          </div>
          <div>
            <label htmlFor="campaign-objective" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.objective')}
            </label>
            <input
              id="campaign-objective"
              className={marketingInputClass}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="campaign-description" className={marketingLabelClass}>
              {t('marketing.campaignManagement.fields.description')}
            </label>
            <textarea
              id="campaign-description"
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
