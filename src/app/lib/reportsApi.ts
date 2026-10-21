import { getJson } from '@/app/lib/api';

export type ProfitabilityBlock = {
  procedure_revenue: string;
  procedure_costs_incurred: string;
  operating_expenses: string;
  operating_profit: string;
  profit_margin: string | null;
  profit_margin_pct: string | null;
};

export type CollectionsBlock = {
  gross_customer_collections: string;
  refunds: string;
  net_customer_collections: string;
  procedure_linked_collections: string;
  customer_level_collections: string;
};

/** Hybrid Model D report — use nested profitability + collections only. */
export type CollectedProfitabilityReport = {
  period: string;
  period_start: string;
  period_end: string;
  profitability: ProfitabilityBlock;
  collections: CollectionsBlock;
  expense_distribution: Array<{ category: string; total: string; count: number }>;
  expense_distribution_total: string;
  procedure_revenue_by_category?: Array<{ category: string; total: string; count: number }>;
  procedure_costs_by_category?: Array<{ category: string; total: string; count: number }>;
  /** Link-type cash breakdown (not procedure revenue). */
  collections_by_category: Array<{ category: string; net_collected: string }>;
  notes?: Record<string, string>;
  labels?: Record<string, string>;
};

export async function fetchCollectedProfitability(
  month: string
): Promise<CollectedProfitabilityReport> {
  const q = month && month !== 'all' ? `?month=${encodeURIComponent(month)}` : '';
  return getJson<CollectedProfitabilityReport>(`/reports/collected-profitability/${q}`);
}
