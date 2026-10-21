import React, { useMemo } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Users,
  Megaphone,
  CalendarClock,
  UserCheck,
  Wallet,
  BarChart3,
  CircleDollarSign,
} from 'lucide-react';
import { cn } from '@/app/components/ui/utils';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';
import { MarketingLoadingState } from '@/app/components/marketing/MarketingLoadingState';
import { MarketingAccessDenied } from '@/app/pages/marketing/MarketingAccessDenied';

type MarketingTab = {
  to: string;
  labelKey: string;
  icon: React.ElementType;
  visible: boolean;
};

export function MarketingLayout() {
  const { t } = useTranslation();
  const perms = useMarketingPermissions();

  const tabs: MarketingTab[] = useMemo(
    () => [
      {
        to: '/marketing',
        labelKey: 'marketing.nav.dashboard',
        icon: LayoutDashboard,
        visible: perms.canViewDashboard || perms.canViewReports || perms.canEnterModule,
      },
      {
        to: '/marketing/leads',
        labelKey: 'marketing.nav.leads',
        icon: Users,
        visible: perms.canViewLeads,
      },
      {
        to: '/marketing/campaigns',
        labelKey: 'marketing.nav.campaigns',
        icon: Megaphone,
        visible: perms.canViewCampaignWorkspace,
      },
      {
        to: '/marketing/followups',
        labelKey: 'marketing.nav.followups',
        icon: CalendarClock,
        visible: perms.canViewFollowUps,
      },
      {
        to: '/marketing/assignments',
        labelKey: 'marketing.nav.assignments',
        icon: UserCheck,
        visible: perms.canViewAssignments,
      },
      {
        to: '/marketing/spend',
        labelKey: 'marketing.nav.spend',
        icon: Wallet,
        visible: perms.canViewSpend,
      },
      {
        to: '/marketing/reports',
        labelKey: 'marketing.nav.reports',
        icon: BarChart3,
        visible: perms.canViewReports,
      },
      {
        to: '/marketing/revenue',
        labelKey: 'marketing.nav.revenue',
        icon: CircleDollarSign,
        visible: perms.canViewReports,
      },
    ],
    [perms]
  );

  if (perms.loading) {
    return <MarketingLoadingState />;
  }

  if (!perms.canEnterModule) {
    return <MarketingAccessDenied backTo="/dashboard" />;
  }

  const visibleTabs = tabs.filter((tab) => tab.visible);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900 break-words">{t('marketing.title')}</h1>
        <p className="text-slate-500 mt-1 break-words">{t('marketing.subtitle')}</p>
      </header>

      <nav
        className="flex flex-wrap gap-2 border-b border-slate-200 pb-3"
        aria-label={t('marketing.nav.ariaLabel')}
      >
        {visibleTabs.map(({ to, labelKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/marketing'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors max-w-full',
                isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              )
            }
          >
            <Icon className="size-4 flex-shrink-0" aria-hidden />
            <span className="break-words">{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
