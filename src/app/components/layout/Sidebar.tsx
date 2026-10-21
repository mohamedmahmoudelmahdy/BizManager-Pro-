import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/app/contexts/AuthContext';
import { MARKETING_MODULE_ENTRY_PERMISSIONS } from '@/app/lib/marketingPermissions';
import { EXPENSE_MODULE_ENTRY_PERMISSIONS } from '@/app/lib/expensePermissions';
import { ATTESTATION_MODULE_ENTRY_PERMISSIONS } from '@/app/lib/attestationPermissions';
import {
  LayoutDashboard,
  Users,
  FileText,
  DollarSign,
  UserCog,
  Receipt,
  BarChart3,
  Settings,
  Building2,
  Shield,
  Megaphone,
  GraduationCap,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/app/components/ui/utils';
import { Button } from '@/app/components/ui/button';

interface NavItem {
  titleKey: string;
  href: string;
  icon: React.ElementType;
  roles: Array<'admin' | 'manager' | 'employee' | 'cashier' | 'marketer'>;
  /** When set, item is shown if user has any of these permissions (admin/manager bypass). */
  anyOfPermissions?: readonly string[];
}

const navItems: NavItem[] = [
  {
    titleKey: 'nav.dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    roles: ['admin', 'manager', 'employee', 'cashier'],
  },
  {
    titleKey: 'nav.customers',
    href: '/customers',
    icon: Users,
    roles: ['admin', 'manager', 'employee', 'cashier'],
  },
  {
    titleKey: 'nav.procedures',
    href: '/procedures',
    icon: FileText,
    roles: ['admin', 'manager', 'employee', 'cashier'],
  },
  {
    titleKey: 'nav.payments',
    href: '/payments',
    icon: DollarSign,
    roles: ['admin', 'cashier', 'employee'],
  },
  {
    titleKey: 'nav.marketing',
    href: '/marketing',
    icon: Megaphone,
    // Admin/manager always; employee/cashier/marketer when they hold marketing entry perms.
    roles: ['admin', 'manager', 'employee', 'cashier', 'marketer'],
    anyOfPermissions: MARKETING_MODULE_ENTRY_PERMISSIONS,
  },
  {
    titleKey: 'nav.financialControl',
    href: '/financial-control/overview',
    icon: Shield,
    roles: ['admin', 'manager', 'cashier'],
  },
  {
    titleKey: 'nav.employeeLog',
    href: '/employee-log',
    icon: UserCog,
    roles: ['admin', 'manager'],
  },
  {
    titleKey: 'nav.expenses',
    href: '/expenses',
    icon: Receipt,
    roles: ['admin', 'manager', 'employee'],
    anyOfPermissions: EXPENSE_MODULE_ENTRY_PERMISSIONS,
  },
  {
    titleKey: 'nav.attestation',
    href: '/attestation',
    icon: GraduationCap,
    // Internal staff (admin/manager/employee). Entry via Django perms
    // (Attestation Employee group grants view_attestationapplication to employees).
    // Admin/manager bypass applies. Hidden from hr_client (AppLayout redirect).
    roles: ['admin', 'manager', 'employee'],
    anyOfPermissions: ATTESTATION_MODULE_ENTRY_PERMISSIONS,
  },
  {
    titleKey: 'nav.reports',
    href: '/reports',
    icon: BarChart3,
    roles: ['admin', 'manager'],
  },
  {
    titleKey: 'nav.settings',
    href: '/settings',
    icon: Settings,
    roles: ['admin'],
  },
];

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ isCollapsed, onToggleCollapse }: SidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, isAuthorized, hasAnyPermission } = useAuth();

  const filteredNavItems = navItems.filter((item) => {
    if (item.anyOfPermissions?.length) {
      // Permission-gated items (e.g. Marketing): still require role allow-list so
      // marketers only see Marketing, while admin/manager/employee retain CRM access.
      if (!isAuthorized(item.roles)) return false;
      return hasAnyPermission([...item.anyOfPermissions], { allowAdminManager: true });
    }
    return isAuthorized(item.roles);
  });

  return (
    <div
      className={cn(
        'bg-slate-900 text-white h-screen flex flex-col transition-all duration-300',
        isCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="p-4 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="p-2 bg-blue-600 rounded-lg flex-shrink-0">
            <Building2 className="h-5 w-5" />
          </div>
          {!isCollapsed && (
            <div className="overflow-hidden">
              <h1 className="font-bold text-sm whitespace-nowrap">{t('appName')}</h1>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          className="text-white hover:bg-slate-800 flex-shrink-0"
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 overflow-y-auto" aria-label={t('nav.mainAriaLabel')}>
        <div className="space-y-1">
          {filteredNavItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.href ||
              (item.href === '/customers' && location.pathname.startsWith('/customers')) ||
              (item.href.startsWith('/financial-control') &&
                location.pathname.startsWith('/financial-control')) ||
              (item.href === '/marketing' && location.pathname.startsWith('/marketing')) ||
              (item.href === '/expenses' && location.pathname.startsWith('/expenses')) ||
              (item.href === '/attestation' && location.pathname.startsWith('/attestation'));

            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                  isCollapsed && 'justify-center'
                )}
                title={isCollapsed ? t(item.titleKey) : undefined}
              >
                <Icon className="h-5 w-5 flex-shrink-0" aria-hidden />
                {!isCollapsed && (
                  <span className="text-sm break-words leading-snug">{t(item.titleKey)}</span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* User Info */}
      {!isCollapsed && user && (
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-semibold">{user.name.charAt(0)}</span>
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-xs text-slate-400 capitalize">{user.role}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
