import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AdSetSelect,
  AdvertisementSelect,
  CampaignSelect,
  ChannelSelect,
  PlatformSelect,
} from '@/app/components/marketing/campaigns/HierarchySelects';

export type LeadAttributionValues = {
  channelId: string;
  platformId: string;
  campaignId: string;
  adSetId: string;
  advertisementId: string;
};

type LeadAttributionFieldsProps = {
  value: LeadAttributionValues;
  onChange: (next: LeadAttributionValues) => void;
  labels?: Partial<Record<keyof LeadAttributionValues, string>>;
};

/**
 * Dependent Channel → Platform → Campaign → Ad Set → Advertisement selectors.
 */
export function LeadAttributionFields({ value, onChange, labels }: LeadAttributionFieldsProps) {
  const { t } = useTranslation();

  const set = (patch: Partial<LeadAttributionValues>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <ChannelSelect
        id="lead-channel"
        label={labels?.channelId ?? t('marketing.leadManagement.fields.channel')}
        value={value.channelId}
        selectedLabel={undefined}
        allowClear
        onChange={(channelId) =>
          set({
            channelId,
            platformId: '',
            campaignId: '',
            adSetId: '',
            advertisementId: '',
          })
        }
      />
      <PlatformSelect
        id="lead-platform"
        label={labels?.platformId ?? t('marketing.leadManagement.fields.platform')}
        value={value.platformId}
        allowClear
        disabled={!value.channelId}
        extraParams={value.channelId ? { channel: value.channelId } : undefined}
        onChange={(platformId) =>
          set({
            platformId,
            campaignId: '',
            adSetId: '',
            advertisementId: '',
          })
        }
      />
      <CampaignSelect
        id="lead-campaign"
        label={labels?.campaignId ?? t('marketing.leadManagement.fields.campaign')}
        value={value.campaignId}
        allowClear
        disabled={!value.platformId}
        extraParams={value.platformId ? { platform: value.platformId } : undefined}
        onChange={(campaignId) =>
          set({
            campaignId,
            adSetId: '',
            advertisementId: '',
          })
        }
      />
      <AdSetSelect
        id="lead-adset"
        label={labels?.adSetId ?? t('marketing.leadManagement.fields.adSet')}
        value={value.adSetId}
        allowClear
        disabled={!value.campaignId}
        extraParams={value.campaignId ? { campaign: value.campaignId } : undefined}
        onChange={(adSetId) => set({ adSetId, advertisementId: '' })}
      />
      <AdvertisementSelect
        id="lead-advertisement"
        label={labels?.advertisementId ?? t('marketing.leadManagement.fields.advertisement')}
        value={value.advertisementId}
        allowClear
        disabled={!value.campaignId}
        extraParams={{
          ...(value.campaignId ? { campaign: value.campaignId } : {}),
          ...(value.adSetId ? { ad_set: value.adSetId } : {}),
        }}
        onChange={(advertisementId) => set({ advertisementId })}
      />
    </div>
  );
}
