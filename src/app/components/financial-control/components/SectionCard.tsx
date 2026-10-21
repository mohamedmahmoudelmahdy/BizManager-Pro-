import React from 'react';

export function SectionCard({
  title,
  children,
  action,
}: {
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      {title && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-50">
          <h3 className="font-semibold text-slate-900 text-sm">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
