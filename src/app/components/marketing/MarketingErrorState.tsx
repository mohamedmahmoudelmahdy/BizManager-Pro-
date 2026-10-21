import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/app/components/ui/button';

export function MarketingErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-12 text-slate-500"
      role="alert"
    >
      <AlertTriangle className="size-8 text-amber-500" aria-hidden />
      <p className="text-sm text-center max-w-md">{message ?? t('marketing.errors.generic')}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t('marketing.retry')}
        </Button>
      ) : null}
    </div>
  );
}
