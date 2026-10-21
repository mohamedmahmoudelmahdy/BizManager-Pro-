import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Pencil } from 'lucide-react';
import { MarketingPageShell } from '@/app/components/marketing/MarketingPageShell';
import { MarketingLoadingState } from '@/app/components/marketing/MarketingLoadingState';
import { MarketingErrorState } from '@/app/components/marketing/MarketingErrorState';
import { MarketingPermissionGuard } from '@/app/components/marketing/MarketingPermissionGuard';
import { CampaignFormDialog } from '@/app/components/marketing/campaigns/CampaignFormDialog';
import { formatMarketingMoney } from '@/app/components/marketing/campaigns/marketingFormStyles';
import {
  MarketingActiveBadge,
  MarketingCode,
} from '@/app/components/marketing/campaigns/MarketingBadges';
import { Button } from '@/app/components/ui/button';
import { marketingCampaignsApi } from '@/app/lib/marketingApi';
import { MARKETING_PERMISSIONS } from '@/app/lib/marketingPermissions';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { MarketingCampaign } from '@/app/lib/marketingTypes';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';

export function CampaignDetailPage() {
  const { t } = useTranslation();
  const { campaignId } = useParams<{ campaignId: string }>();
  const perms = useMarketingPermissions();
  const [campaign, setCampaign] = useState<MarketingCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    try {
      setCampaign(await marketingCampaignsApi.get(campaignId));
    } catch (err) {
      setError(err);
      setCampaign(null);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <MarketingPermissionGuard permission={MARKETING_PERMISSIONS.viewCampaign}>
      {loading ? (
        <MarketingLoadingState />
      ) : error || !campaign ? (
        <MarketingErrorState
          message={formatMarketingErrorMessage(error ?? new Error('missing'), t)}
          onRetry={load}
        />
      ) : (
        <MarketingPageShell
          title={campaign.name}
          description={t('marketing.campaignManagement.campaign.detailSubtitle')}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" asChild>
                <Link to="/marketing/campaigns">
                  <ArrowLeft className="size-4 me-2" />
                  {t('marketing.campaignManagement.campaign.backToList')}
                </Link>
              </Button>
              {perms.canChangeCampaign ? (
                <Button type="button" onClick={() => setEditOpen(true)}>
                  <Pencil className="size-4 me-2" />
                  {t('common.edit')}
                </Button>
              ) : null}
            </div>
          }
        >
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs text-slate-400 font-semibold uppercase">
                  {t('marketing.campaignManagement.fields.code')}
                </dt>
                <dd className="mt-1">
                  <MarketingCode>{campaign.code}</MarketingCode>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400 font-semibold uppercase">
                  {t('marketing.campaignManagement.fields.status')}
                </dt>
                <dd className="mt-1">
                  {t(`marketing.campaignManagement.status.${campaign.status}`, {
                    defaultValue: campaign.status,
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400 font-semibold uppercase">
                  {t('marketing.campaignManagement.fields.platform')}
                </dt>
                <dd className="mt-1 break-words">{campaign.platform?.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400 font-semibold uppercase">
                  {t('marketing.campaignManagement.fields.channel')}
                </dt>
                <dd className="mt-1 break-words">{campaign.channel?.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400 font-semibold uppercase">
                  {t('marketing.campaignManagement.fields.startDate')}
                </dt>
                <dd className="mt-1" dir="ltr">
                  {campaign.start_date || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400 font-semibold uppercase">
                  {t('marketing.campaignManagement.fields.endDate')}
                </dt>
                <dd className="mt-1" dir="ltr">
                  {campaign.end_date || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400 font-semibold uppercase">
                  {t('marketing.campaignManagement.fields.budget')}
                </dt>
                <dd className="mt-1" dir="ltr">
                  {formatMarketingMoney(campaign.budget, campaign.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400 font-semibold uppercase">
                  {t('marketing.campaignManagement.fields.active')}
                </dt>
                <dd className="mt-1">
                  <MarketingActiveBadge
                    active={campaign.is_active}
                    activeLabel={t('marketing.campaignManagement.active')}
                    inactiveLabel={t('marketing.campaignManagement.inactive')}
                  />
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-400 font-semibold uppercase">
                  {t('marketing.campaignManagement.fields.objective')}
                </dt>
                <dd className="mt-1 break-words">{campaign.objective || '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-400 font-semibold uppercase">
                  {t('marketing.campaignManagement.fields.description')}
                </dt>
                <dd className="mt-1 break-words">{campaign.description || '—'}</dd>
              </div>
            </dl>
          </div>

          <CampaignFormDialog
            open={editOpen}
            campaign={campaign}
            onClose={() => setEditOpen(false)}
            onSuccess={load}
          />
        </MarketingPageShell>
      )}
    </MarketingPermissionGuard>
  );
}
