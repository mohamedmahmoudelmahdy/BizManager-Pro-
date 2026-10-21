import { useMemo } from 'react';
import { useAuth } from '@/app/contexts/AuthContext';
import {
  ATTESTATION_MODULE_ENTRY_PERMISSIONS,
  ATTESTATION_PERMISSIONS,
} from '@/app/lib/attestationPermissions';

const ALLOW_ADMIN_MANAGER = { allowAdminManager: true } as const;

/**
 * Permission helpers for Attestation workspace.
 * Uses /api/me permissions — admin/manager bypass when configured.
 */
export function useAttestationPermissions() {
  const { user, loading, hasPermission, hasAnyPermission } = useAuth();

  return useMemo(() => {
    const can = (permission: string) => hasPermission(permission, ALLOW_ADMIN_MANAGER);
    const canAny = (permissions: readonly string[] | string[]) =>
      hasAnyPermission([...permissions], ALLOW_ADMIN_MANAGER);

    const canEnterModule = canAny(ATTESTATION_MODULE_ENTRY_PERMISSIONS);
    const canView = can(ATTESTATION_PERMISSIONS.view) || can(ATTESTATION_PERMISSIONS.process);
    const canProcess = can(ATTESTATION_PERMISSIONS.process);
    const canEditNotes =
      can(ATTESTATION_PERMISSIONS.change) ||
      can(ATTESTATION_PERMISSIONS.process) ||
      can(ATTESTATION_PERMISSIONS.viewInternalNotes);
    const canViewNotes =
      can(ATTESTATION_PERMISSIONS.viewInternalNotes) ||
      can(ATTESTATION_PERMISSIONS.process) ||
      can(ATTESTATION_PERMISSIONS.change);

    return {
      loading,
      user,
      permissions: user?.permissions ?? [],
      canEnterModule,
      canView,
      canProcess,
      canEditNotes,
      canViewNotes,
      can,
      canAny,
      codes: ATTESTATION_PERMISSIONS,
    };
  }, [user, loading, hasPermission, hasAnyPermission]);
}
