import React from 'react';
import { Inbox } from 'lucide-react';

export function EmptyFinancialState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
      <Inbox className="size-8" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
