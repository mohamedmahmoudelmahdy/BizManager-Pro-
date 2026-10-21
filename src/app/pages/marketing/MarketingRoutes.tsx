import React, { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { MarketingLayout } from '@/app/components/marketing/MarketingLayout';
import { MarketingLoadingState } from '@/app/components/marketing/MarketingLoadingState';
import { CampaignWorkspaceLayout } from '@/app/components/marketing/campaigns/CampaignWorkspaceLayout';
import { MarketingAccessDenied } from '@/app/pages/marketing/MarketingAccessDenied';
import { MarketingHome } from '@/app/pages/marketing/MarketingHome';
import { MarketingDashboardPage } from '@/app/pages/marketing/MarketingDashboardPage';
import { RevenueAttributionPage } from '@/app/pages/marketing/RevenueAttributionPage';
import { CampaignSpendPage } from '@/app/pages/marketing/campaigns/CampaignSpendPage';
import { FollowUpsPage } from '@/app/pages/marketing/followups/FollowUpsPage';
import { AssignmentsPage } from '@/app/pages/marketing/assignments/AssignmentsPage';
import { LeadsPage } from '@/app/pages/marketing/leads/LeadsPage';
import { LeadDetailPage } from '@/app/pages/marketing/leads/LeadDetailPage';
import { CampaignsIndexPage } from '@/app/pages/marketing/campaigns/CampaignsIndexPage';
import { ChannelsPage } from '@/app/pages/marketing/campaigns/ChannelsPage';
import { PlatformsPage } from '@/app/pages/marketing/campaigns/PlatformsPage';
import { AdSetsPage } from '@/app/pages/marketing/campaigns/AdSetsPage';
import { AdvertisementsPage } from '@/app/pages/marketing/campaigns/AdvertisementsPage';
import { CampaignDetailPage } from '@/app/pages/marketing/campaigns/CampaignDetailPage';

function Loading() {
  return <MarketingLoadingState />;
}

export function MarketingRoutes() {
  return (
    <Routes>
      <Route element={<MarketingLayout />}>
        <Route
          index
          element={
            <Suspense fallback={<Loading />}>
              <MarketingHome />
            </Suspense>
          }
        />
        <Route
          path="leads"
          element={
            <Suspense fallback={<Loading />}>
              <LeadsPage />
            </Suspense>
          }
        />
        <Route
          path="leads/:leadId"
          element={
            <Suspense fallback={<Loading />}>
              <LeadDetailPage />
            </Suspense>
          }
        />

        <Route element={<CampaignWorkspaceLayout />}>
          <Route
            path="campaigns"
            element={
              <Suspense fallback={<Loading />}>
                <CampaignsIndexPage />
              </Suspense>
            }
          />
          <Route
            path="campaigns/channels"
            element={
              <Suspense fallback={<Loading />}>
                <ChannelsPage />
              </Suspense>
            }
          />
          <Route
            path="campaigns/platforms"
            element={
              <Suspense fallback={<Loading />}>
                <PlatformsPage />
              </Suspense>
            }
          />
          <Route
            path="campaigns/ad-sets"
            element={
              <Suspense fallback={<Loading />}>
                <AdSetsPage />
              </Suspense>
            }
          />
          <Route
            path="campaigns/advertisements"
            element={
              <Suspense fallback={<Loading />}>
                <AdvertisementsPage />
              </Suspense>
            }
          />
          <Route
            path="campaigns/:campaignId"
            element={
              <Suspense fallback={<Loading />}>
                <CampaignDetailPage />
              </Suspense>
            }
          />
          <Route
            path="spend"
            element={
              <Suspense fallback={<Loading />}>
                <CampaignSpendPage />
              </Suspense>
            }
          />
        </Route>

        <Route
          path="dashboard"
          element={
            <Suspense fallback={<Loading />}>
              <MarketingDashboardPage mode="dashboard" />
            </Suspense>
          }
        />
        <Route
          path="followups"
          element={
            <Suspense fallback={<Loading />}>
              <FollowUpsPage />
            </Suspense>
          }
        />
        <Route
          path="assignments"
          element={
            <Suspense fallback={<Loading />}>
              <AssignmentsPage />
            </Suspense>
          }
        />
        <Route
          path="reports"
          element={
            <Suspense fallback={<Loading />}>
              <MarketingDashboardPage mode="reports" />
            </Suspense>
          }
        />
        <Route
          path="revenue"
          element={
            <Suspense fallback={<Loading />}>
              <RevenueAttributionPage />
            </Suspense>
          }
        />
        <Route path="access-denied" element={<MarketingAccessDenied />} />
        <Route path="*" element={<Navigate to="/marketing" replace />} />
      </Route>
    </Routes>
  );
}
