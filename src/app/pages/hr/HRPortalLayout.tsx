import React from 'react';
import { Link, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GraduationCap, LogOut } from 'lucide-react';
import { useAuth } from '@/app/contexts/AuthContext';
import { Button } from '@/app/components/ui/button';
import { HR_PORTAL_ENTRY_PERMISSIONS } from '@/app/lib/hrPortalPermissions';

export function HRPortalLayout() {
  const { t, i18n } = useTranslation();
  const { user, loading, logout, hasAnyPermission } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400" role="status">
        {t('hrPortal.loading')}
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  const allowed =
    user.role === 'hr_client' &&
    hasAnyPermission([...HR_PORTAL_ENTRY_PERMISSIONS], { allowAdminManager: false });

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  const orgName = user.customer?.display_name || t('hrPortal.organizationFallback');

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-lg bg-blue-600 p-2 text-white shrink-0">
              <GraduationCap className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 break-words">
                {t('hrPortal.brand')}
              </p>
              <p className="text-xs text-slate-500 break-words">{orgName}</p>
            </div>
          </div>
          <nav className="flex items-center gap-2" aria-label={t('hrPortal.navAria')}>
            <Button asChild variant="ghost" size="sm">
              <Link to="/hr/attestation">{t('hrPortal.nav.applications')}</Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                logout();
                navigate('/');
              }}
            >
              <LogOut className="size-4 me-1.5" aria-hidden />
              {t('hrPortal.nav.signOut')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')}
            >
              {i18n.language === 'ar' ? 'EN' : 'ع'}
            </Button>
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
