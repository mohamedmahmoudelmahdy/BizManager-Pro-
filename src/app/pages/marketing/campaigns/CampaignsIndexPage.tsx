import React from 'react';
import { Navigate } from 'react-router-dom';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';
import { MarketingLoadingState } from '@/app/components/marketing/MarketingLoadingState';
import { MarketingAccessDenied } from '@/app/pages/marketing/MarketingAccessDenied';
import { CampaignsPage } from '@/app/pages/marketing/campaigns/CampaignsPage';

/**
 * /marketing/campaigns entry: show campaign list when allowed,
 * otherwise land on the first accessible hierarchy section.
 */
export function CampaignsIndexPage() {
  const perms = useMarketingPermissions();

  if (perms.loading) return <MarketingLoadingState />;
  if (perms.canViewCampaigns) return <CampaignsPage />;
  if (perms.canViewChannels) return <Navigate to="/marketing/campaigns/channels" replace />;
  if (perms.canViewPlatforms) return <Navigate to="/marketing/campaigns/platforms" replace />;
  if (perms.canViewAdSets) return <Navigate to="/marketing/campaigns/ad-sets" replace />;
  if (perms.canViewAdvertisements) {
    return <Navigate to="/marketing/campaigns/advertisements" replace />;
  }
  if (perms.canViewSpend) return <Navigate to="/marketing/spend" replace />;
  return <MarketingAccessDenied />;
}
