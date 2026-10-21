import React from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function MarketingLoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2 className="size-8 animate-spin" aria-hidden />
      <p className="text-sm">{label ?? t('marketing.loading')}</p>
    </div>
  );
}
