import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { Users, BarChart3 } from 'lucide-react';
import { cn } from '@/app/components/ui/utils';
import { useAuth } from '@/app/contexts/AuthContext';

const tabs = [
  { key: 'list', href: '/customers', icon: Users, labelKey: 'customers.area.list', roles: ['admin', 'manager', 'employee', 'cashier'] as const },
  { key: 'financials', href: '/customers/financials', icon: BarChart3, labelKey: 'customers.area.financials', roles: ['admin', 'manager', 'employee', 'cashier'] as const },
];

export function CustomerAreaNav() {
  const { t } = useTranslation();
  const location = useLocation();
  const { isAuthorized } = useAuth();
  const visibleTabs = tabs.filter((tab) => isAuthorized([...tab.roles]));

  return (
    <div className="flex gap-2 mb-6">
      {visibleTabs.map((tab) => {
        const Icon = tab.icon;
        const isActive =
          tab.href === '/customers'
            ? location.pathname === '/customers'
            : location.pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.key}
            to={tab.href}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors',
              isActive
                ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                : 'text-gray-500 hover:text-gray-900 border border-transparent'
            )}
          >
            <Icon className="size-4" />
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </div>
  );
}
