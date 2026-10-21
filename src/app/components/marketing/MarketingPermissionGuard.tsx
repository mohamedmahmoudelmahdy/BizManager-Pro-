import React from 'react';
import { Navigate } from 'react-router-dom';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';
import { MarketingLoadingState } from '@/app/components/marketing/MarketingLoadingState';
import { MarketingAccessDenied } from '@/app/pages/marketing/MarketingAccessDenied';

type MarketingPermissionGuardProps = {
  permission?: string;
  anyOf?: string[];
  children: React.ReactNode;
  /** When true, render access denied inline instead of redirecting away. Default true. */
  showDenied?: boolean;
};

/**
 * Gate Marketing feature content by Django permission codes from /api/me.
 * Does not authorize by translated group names or hardcoded role lists.
 */
export function MarketingPermissionGuard({
  permission,
  anyOf,
  children,
  showDenied = true,
}: MarketingPermissionGuardProps) {
  const { loading, can, canAny } = useMarketingPermissions();

  if (loading) {
    return <MarketingLoadingState />;
  }

  const allowed = permission
    ? can(permission)
    : anyOf?.length
      ? canAny(anyOf)
      : false;

  if (!allowed) {
    if (showDenied) {
      return <MarketingAccessDenied />;
    }
    return <Navigate to="/marketing" replace />;
  }

  return <>{children}</>;
}
