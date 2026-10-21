import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/app/components/ui/utils';

type MarketingPageShellProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

/**
 * Shared Marketing page shell: heading, optional actions slot, content.
 * Reuses existing typography/spacing — not a second app shell.
 */
export function MarketingPageShell({
  title,
  description,
  actions,
  children,
  className,
}: MarketingPageShellProps) {
  return (
    <section className={cn('space-y-5', className)} aria-labelledby="marketing-page-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 id="marketing-page-title" className="text-xl font-semibold text-slate-900 break-words">
            {title}
          </h2>
          {description ? (
            <p className="text-sm text-slate-500 break-words max-w-2xl">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
        ) : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

/** Convenience wrapper that pulls title/description from i18n keys. */
export function MarketingTranslatedPageShell({
  titleKey,
  descriptionKey,
  actions,
  children,
  className,
}: {
  titleKey: string;
  descriptionKey?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <MarketingPageShell
      title={t(titleKey)}
      description={descriptionKey ? t(descriptionKey) : undefined}
      actions={actions}
      className={className}
    >
      {children}
    </MarketingPageShell>
  );
}
