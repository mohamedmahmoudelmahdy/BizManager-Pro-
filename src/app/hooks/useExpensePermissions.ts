import { useMemo } from 'react';
import { useAuth } from '@/app/contexts/AuthContext';
import {
  EXPENSE_MODULE_ENTRY_PERMISSIONS,
  EXPENSE_PERMISSIONS,
  EXPENSE_REVIEW_PERMISSIONS,
} from '@/app/lib/expensePermissions';

const ALLOW_ADMIN_MANAGER = { allowAdminManager: true } as const;

/**
 * Permission-aware helpers for Expense claims navigation and actions.
 * Uses /api/me permissions via AuthContext — admin/manager bypass when configured.
 */
export function useExpensePermissions() {
  const { user, loading, hasPermission, hasAnyPermission } = useAuth();

  return useMemo(() => {
    const can = (permission: string) => hasPermission(permission, ALLOW_ADMIN_MANAGER);
    const canAny = (permissions: readonly string[] | string[]) =>
      hasAnyPermission([...permissions], ALLOW_ADMIN_MANAGER);

    const canEnterModule = canAny(EXPENSE_MODULE_ENTRY_PERMISSIONS);
    const canReviewQueue = canAny(EXPENSE_REVIEW_PERMISSIONS);

    return {
      loading,
      user,
      permissions: user?.permissions ?? [],
      canEnterModule,
      canViewOwn: can(EXPENSE_PERMISSIONS.viewOwn) || can(EXPENSE_PERMISSIONS.view),
      canAddOwn: can(EXPENSE_PERMISSIONS.addOwn) || can(EXPENSE_PERMISSIONS.add),
      canChangeOwn: can(EXPENSE_PERMISSIONS.changeOwn) || can(EXPENSE_PERMISSIONS.change),
      canSubmit: can(EXPENSE_PERMISSIONS.submit),
      canWithdraw: can(EXPENSE_PERMISSIONS.withdraw),
      canViewAll: can(EXPENSE_PERMISSIONS.view),
      canReview: can(EXPENSE_PERMISSIONS.review) || canReviewQueue,
      canApprove: can(EXPENSE_PERMISSIONS.approve),
      canReject: can(EXPENSE_PERMISSIONS.reject),
      canReturn: can(EXPENSE_PERMISSIONS.return),
      canMarkPaid: can(EXPENSE_PERMISSIONS.markPaid),
      canReviewQueue,
      canRecordOperational: Boolean(
        user?.role === 'admin' || user?.role === 'manager'
      ),
      can,
      canAny,
      codes: EXPENSE_PERMISSIONS,
    };
  }, [user, loading, hasPermission, hasAnyPermission]);
}
