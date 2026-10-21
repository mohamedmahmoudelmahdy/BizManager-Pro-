import React from 'react';
import { Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function MarketingEmptyState({
  message,
  title,
}: {
  message?: string;
  title?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400"
      role="status"
    >
      <Inbox className="size-8" aria-hidden />
      {title ? <p className="text-sm font-medium text-slate-600">{title}</p> : null}
      <p className="text-sm text-center max-w-md">{message ?? t('marketing.empty')}</p>
    </div>
  );
}
