import React from 'react';
import { AlertTriangle } from 'lucide-react';

export function ReconciliationBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
      <AlertTriangle className="size-4 text-amber-600 flex-shrink-0" />
      <span className="text-sm text-amber-800 font-medium">{message}</span>
    </div>
  );
}
