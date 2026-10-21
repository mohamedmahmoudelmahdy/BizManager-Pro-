import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { useAttestationPermissions } from '@/app/hooks/useAttestationPermissions';
import { ATTESTATION_MODULE_ENTRY_PERMISSIONS } from '@/app/lib/attestationPermissions';
import { homePathForRole } from '@/app/lib/permissions';
import { useAuth } from '@/app/contexts/AuthContext';

export function AttestationAccessDenied() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const home = homePathForRole(user?.role);

  return (
    <section
      className="flex flex-col items-center justify-center gap-4 py-16 text-center"
      role="alert"
      aria-labelledby="attestation-access-denied-title"
    >
      <ShieldAlert className="size-10 text-amber-500" aria-hidden />
      <div className="space-y-2 max-w-md">
        <h2 id="attestation-access-denied-title" className="text-lg font-semibold text-slate-900">
          {t('attestation.permissionDenied.title')}
        </h2>
        <p className="text-sm text-slate-500 break-words">
          {t('attestation.permissionDenied.description')}
        </p>
      </div>
      <Button asChild variant="outline">
        <Link to={home}>{t('attestation.permissionDenied.back')}</Link>
      </Button>
    </section>
  );
}

type AttestationPermissionGuardProps = {
  permission?: string;
  anyOf?: readonly string[] | string[];
  children: React.ReactNode;
};

export function AttestationPermissionGuard({
  permission,
  anyOf = ATTESTATION_MODULE_ENTRY_PERMISSIONS,
  children,
}: AttestationPermissionGuardProps) {
  const { loading, can, canAny, user } = useAttestationPermissions();
  const { user: authUser } = useAuth();

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-slate-400" role="status">
        <Loader2 className="size-8 animate-spin" aria-hidden />
      </div>
    );
  }

  const allowed = permission ? can(permission) : canAny(anyOf);

  if (!allowed) {
    if (!authUser && !user) {
      return <Navigate to="/" replace />;
    }
    return <AttestationAccessDenied />;
  }

  return <>{children}</>;
}
