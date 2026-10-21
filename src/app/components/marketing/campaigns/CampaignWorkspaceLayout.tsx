import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/app/components/ui/utils';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';
import { MarketingPermissionGuard } from '@/app/components/marketing/MarketingPermissionGuard';
import { MARKETING_CAMPAIGN_WORKSPACE_PERMISSIONS } from '@/app/lib/marketingPermissions';

type Tab = { to: string; end?: boolean; labelKey: string; visible: boolean };

/**
 * Local Campaign Management workspace navigation (does not duplicate Sidebar).
 */
export function CampaignWorkspaceLayout() {
  const { t } = useTranslation();
  const perms = useMarketingPermissions();

  const tabs: Tab[] = [
    {
      to: '/marketing/campaigns',
      end: true,
      labelKey: 'marketing.campaignManagement.nav.campaigns',
      visible: perms.canViewCampaigns,
    },
    {
      to: '/marketing/campaigns/channels',
      labelKey: 'marketing.campaignManagement.nav.channels',
      visible: perms.canViewChannels,
    },
    {
      to: '/marketing/campaigns/platforms',
      labelKey: 'marketing.campaignManagement.nav.platforms',
      visible: perms.canViewPlatforms,
    },
    {
      to: '/marketing/campaigns/ad-sets',
      labelKey: 'marketing.campaignManagement.nav.adSets',
      visible: perms.canViewAdSets,
    },
    {
      to: '/marketing/campaigns/advertisements',
      labelKey: 'marketing.campaignManagement.nav.advertisements',
      visible: perms.canViewAdvertisements,
    },
    {
      to: '/marketing/spend',
      labelKey: 'marketing.campaignManagement.nav.spend',
      visible: perms.canViewSpend,
    },
  ];

  const visible = tabs.filter((tab) => tab.visible);

  return (
    <MarketingPermissionGuard anyOf={[...MARKETING_CAMPAIGN_WORKSPACE_PERMISSIONS]}>
      <div className="space-y-4">
        <nav
          className="flex flex-wrap gap-1.5 rounded-lg bg-slate-100 p-1.5"
          aria-label={t('marketing.campaignManagement.nav.ariaLabel')}
        >
          {visible.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors break-words max-w-full',
                  isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                )
              }
            >
              {t(tab.labelKey)}
            </NavLink>
          ))}
        </nav>
        <Outlet />
      </div>
    </MarketingPermissionGuard>
  );
}
