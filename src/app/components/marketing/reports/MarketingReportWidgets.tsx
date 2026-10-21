import React from 'react';

export function MarketingKpiCard({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div
      className="rounded-lg border border-slate-200 bg-white px-4 py-3 min-w-0"
      title={hint}
    >
      <p className="text-xs font-semibold text-slate-500 truncate">{label}</p>
      {loading ? (
        <div
          className="mt-2 h-7 w-20 rounded bg-slate-100 animate-pulse"
          aria-hidden
        />
      ) : (
        <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums break-words" dir="ltr">
          {value}
        </p>
      )}
    </div>
  );
}

export function MarketingWidgetFrame({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-slate-500 break-words">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
