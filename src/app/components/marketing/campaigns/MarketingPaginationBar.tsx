import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/app/components/ui/button';

type MarketingPaginationBarProps = {
  page: number;
  totalPages: number;
  count: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
};

export function MarketingPaginationBar({
  page,
  totalPages,
  count,
  pageSize,
  onPageChange,
  loading,
}: MarketingPaginationBarProps) {
  const { t } = useTranslation();
  if (count === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, count);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-3">
      <p className="text-xs text-slate-500" aria-live="polite">
        {t('marketing.campaignManagement.pagination.range', { from, to, count })}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={t('marketing.campaignManagement.pagination.prev')}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm text-slate-600 tabular-nums" dir="ltr">
          {t('marketing.campaignManagement.pagination.pageOf', { page, totalPages })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label={t('marketing.campaignManagement.pagination.next')}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
