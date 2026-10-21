import React from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { useExpensePermissions } from '@/app/hooks/useExpensePermissions';
import { EXPENSE_MODULE_ENTRY_PERMISSIONS } from '@/app/lib/expensePermissions';
import { homePathForRole } from '@/app/lib/permissions';
import { useAuth } from '@/app/contexts/AuthContext';

export function ExpenseAccessDenied() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const home = homePathForRole(user?.role);

  return (
    <section
      className="flex flex-col items-center justify-center gap-4 py-16 text-center"
      role="alert"
      aria-labelledby="expense-access-denied-title"
    >
      <ShieldAlert className="size-10 text-amber-500" aria-hidden />
      <div className="space-y-2 max-w-md">
        <h2 id="expense-access-denied-title" className="text-lg font-semibold text-slate-900">
          {t('expenses.employee.permissionDenied.title')}
        </h2>
        <p className="text-sm text-slate-500 break-words">
          {t('expenses.employee.permissionDenied.description')}
        </p>
      </div>
      <Button asChild variant="outline">
        <Link to={home}>{t('expenses.employee.permissionDenied.back')}</Link>
      </Button>
    </section>
  );
}

type ExpensePermissionGuardProps = {
  permission?: string;
  anyOf?: readonly string[] | string[];
  children: React.ReactNode;
};

/** Gate expense feature content by Django permission codes from /api/me. */
export function ExpensePermissionGuard({
  permission,
  anyOf = EXPENSE_MODULE_ENTRY_PERMISSIONS,
  children,
}: ExpensePermissionGuardProps) {
  const { loading, can, canAny, user } = useExpensePermissions();
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
    return <ExpenseAccessDenied />;
  }

  return <>{children}</>;
}
