import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/app/components/ui/button';

export function MarketingAccessDenied({ backTo = '/marketing' }: { backTo?: string }) {
  const { t } = useTranslation();
  const backLabel =
    backTo === '/dashboard'
      ? t('marketing.permissionDenied.backDashboard')
      : t('marketing.permissionDenied.back');

  return (
    <section
      className="flex flex-col items-center justify-center gap-4 py-16 text-center"
      role="alert"
      aria-labelledby="marketing-access-denied-title"
    >
      <ShieldAlert className="size-10 text-amber-500" aria-hidden />
      <div className="space-y-2 max-w-md">
        <h2 id="marketing-access-denied-title" className="text-lg font-semibold text-slate-900">
          {t('marketing.permissionDenied.title')}
        </h2>
        <p className="text-sm text-slate-500 break-words">
          {t('marketing.permissionDenied.description')}
        </p>
      </div>
      <Button asChild variant="outline">
        <Link to={backTo}>{backLabel}</Link>
      </Button>
    </section>
  );
}
