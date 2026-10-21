/**
 * Shared Marketing CRM TypeScript models (Phase 3.0 + 3.1).
 * DTOs mirror Phase 2C.2 serializers — do not invent fields.
 */

export type MarketingPermissionCode = string;

export type NamedRefSummary = {
  id: string;
  name: string;
  code?: string;
  is_active?: boolean;
};

export type UserSummary = {
  id: number | string;
  username: string;
  first_name?: string;
  last_name?: string;
};

export type CustomerSummary = {
  id: string;
  name: string;
  company_name?: string;
  phone?: string;
  type?: string;
};

/** Campaign status codes from MarketingCampaign.Status */
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';

export type CampaignSpendIntegrationStatus =
  | 'pending'
  | 'integrated'
  | 'failed'
  | 'not_required';

export type MarketingChannel = {
  id: string;
  name: string;
  code: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type MarketingPlatform = {
  id: string;
  name: string;
  code: string;
  description: string;
  is_active: boolean;
  channel: NamedRefSummary | null;
  created_at: string;
  updated_at: string;
};

export type MarketingCampaign = {
  id: string;
  name: string;
  code: string;
  description: string;
  objective: string;
  start_date: string | null;
  end_date: string | null;
  budget: string | null;
  currency: string;
  status: CampaignStatus | string;
  is_active: boolean;
  platform: NamedRefSummary | null;
  channel: NamedRefSummary | null;
  created_by: UserSummary | null;
  created_at: string;
  updated_at: string;
};

export type MarketingAdSet = {
  id: string;
  name: string;
  external_reference: string;
  budget: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  campaign: NamedRefSummary | null;
  created_at: string;
  updated_at: string;
};

export type MarketingAdvertisement = {
  id: string;
  name: string;
  external_reference: string;
  creative_reference: string;
  is_active: boolean;
  campaign: NamedRefSummary | null;
  ad_set: NamedRefSummary | null;
  created_at: string;
  updated_at: string;
};

export type CampaignSpend = {
  id: string;
  spend_date: string;
  amount: string;
  currency: string;
  description: string;
  external_reference: string;
  expense_id: string | null;
  integration_status: CampaignSpendIntegrationStatus | string;
  campaign: NamedRefSummary | null;
  ad_set: NamedRefSummary | null;
  advertisement: NamedRefSummary | null;
  created_by: UserSummary | null;
  created_at: string;
  updated_at: string;
  /** Detail-only fields */
  financial_reference?: string;
  integration_error?: string;
  integrated_at?: string | null;
};

export type CreateChannelInput = {
  name: string;
  code: string;
  description?: string;
};

export type UpdateChannelInput = {
  name?: string;
  description?: string;
};

export type CreatePlatformInput = {
  channel_id: string;
  name: string;
  code: string;
  description?: string;
};

export type UpdatePlatformInput = {
  channel_id?: string;
  name?: string;
  description?: string;
};

export type CreateCampaignInput = {
  platform_id: string;
  name: string;
  code: string;
  description?: string;
  objective?: string;
  start_date?: string | null;
  end_date?: string | null;
  budget?: string | null;
  currency?: string;
  status?: CampaignStatus | string;
};

export type UpdateCampaignInput = {
  platform_id?: string;
  name?: string;
  description?: string;
  objective?: string;
  start_date?: string | null;
  end_date?: string | null;
  budget?: string | null;
  currency?: string;
  status?: CampaignStatus | string;
};

export type CreateAdSetInput = {
  campaign_id: string;
  name: string;
  external_reference?: string;
  budget?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

export type UpdateAdSetInput = {
  campaign_id?: string;
  name?: string;
  external_reference?: string;
  budget?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

export type CreateAdvertisementInput = {
  campaign_id: string;
  ad_set_id?: string | null;
  name: string;
  external_reference?: string;
  creative_reference?: string;
};

export type UpdateAdvertisementInput = {
  campaign_id?: string;
  ad_set_id?: string | null;
  name?: string;
  external_reference?: string;
  creative_reference?: string;
};

export type CreateCampaignSpendInput = {
  campaign_id: string;
  spend_date: string;
  amount: string;
  currency?: string;
  description?: string;
  external_reference?: string;
  ad_set_id?: string | null;
  advertisement_id?: string | null;
  expense_id?: string | null;
};

export type UpdateCampaignSpendInput = {
  campaign_id?: string;
  spend_date?: string;
  amount?: string;
  currency?: string;
  description?: string;
  external_reference?: string;
  ad_set_id?: string | null;
  advertisement_id?: string | null;
  expense_id?: string | null;
};

/** @deprecated Prefer MarketingCampaign — kept for Phase 3.0 compatibility */
export type CampaignSummary = MarketingCampaign;
/** @deprecated Prefer NamedRefSummary */
export type ChannelSummary = MarketingChannel;
/** @deprecated Prefer NamedRefSummary */
export type PlatformSummary = MarketingPlatform;

/** Lead status codes from Lead.Status */
export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'assigned'
  | 'in_progress'
  | 'converted'
  | 'lost'
  | 'archived';

/** Lead outcome codes from Lead.Outcome */
export type LeadOutcome =
  | ''
  | 'interested'
  | 'not_interested'
  | 'no_answer'
  | 'wrong_number'
  | 'duplicate'
  | 'future_opportunity';

export type LeadActivityType =
  | 'call'
  | 'whatsapp'
  | 'email'
  | 'meeting'
  | 'note'
  | 'follow_up'
  | 'status_change'
  | 'assignment'
  | 'conversion';

export type LeadFollowUpStatus = 'pending' | 'completed' | 'cancelled';

export type LeadAssignmentStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'completed'
  | 'reassigned'
  | 'cancelled';

export type LeadConversionMode = 'create_customer' | 'link_existing_customer';

export type LeadSummary = {
  id: string;
  lead_number: string;
  name: string;
  raw_phone: string;
  normalized_phone: string;
  email: string;
  status: LeadStatus | string;
  outcome: LeadOutcome | string;
  channel: NamedRefSummary | null;
  platform: NamedRefSummary | null;
  campaign: NamedRefSummary | null;
  marketing_owner: UserSummary | null;
  linked_customer: CustomerSummary | null;
  created_by: UserSummary | null;
  last_contacted_by: UserSummary | null;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  converted_at?: string | null;
};

export type LeadDetail = LeadSummary & {
  notes: string;
  ad_set: NamedRefSummary | null;
  advertisement: NamedRefSummary | null;
  converted_by: UserSummary | null;
  archived_by: UserSummary | null;
  archive_reason: string;
};

export type Lead = LeadDetail;

export type CreateLeadInput = {
  name: string;
  raw_phone: string;
  selected_customer_id?: string | null;
  email?: string;
  notes?: string;
  status?: LeadStatus | string;
  outcome?: LeadOutcome | string;
  channel_id?: string | null;
  platform_id?: string | null;
  campaign_id?: string | null;
  ad_set_id?: string | null;
  advertisement_id?: string | null;
  marketing_owner_id?: number | null;
};

export type UpdateLeadInput = {
  name?: string;
  raw_phone?: string;
  selected_customer_id?: string | null;
  clear_linked_customer?: boolean;
  email?: string;
  notes?: string;
  status?: LeadStatus | string;
  outcome?: LeadOutcome | string;
  channel_id?: string | null;
  platform_id?: string | null;
  campaign_id?: string | null;
  ad_set_id?: string | null;
  advertisement_id?: string | null;
  marketing_owner_id?: number | null;
};

export type ArchiveLeadInput = {
  reason: string;
};

export type CreateCustomerConversionInput = {
  mode: 'create_customer';
  customer?: {
    type?: string;
    name?: string;
    phone?: string;
    email?: string;
    company_name?: string;
  };
};

export type LinkExistingCustomerConversionInput = {
  mode: 'link_existing_customer';
  customer_id: string;
};

export type LeadConversionInput =
  | CreateCustomerConversionInput
  | LinkExistingCustomerConversionInput;

/** Phone-match item from Lead create/update (`CustomerPhoneMatch.to_dict`). */
export type CustomerPhoneMatchSummary = {
  customer_id: string;
  matched_field: string;
  matched_raw_value: string;
  normalized_value: string;
  display_name: string;
  phone?: string;
  phone_secondary?: string;
  customer_type?: string;
};

/** Convert-mode match item (`safe_customer_match_summaries`). */
export type ConvertCustomerMatchSummary = {
  id: string;
  display_name: string;
  matched_field: string;
  matched_raw_phone: string;
  normalized_phone: string;
  phone?: string;
  phone_secondary?: string;
  customer_type?: string;
};

export type DuplicateLeadPhoneDetails = {
  lead: {
    id: string;
    lead_number: string;
    name: string;
    status: string;
    normalized_phone: string;
  };
};

export type LeadActivity = {
  id: string;
  lead: Pick<LeadSummary, 'id' | 'lead_number' | 'name' | 'status' | 'raw_phone'> | null;
  activity_type: LeadActivityType | string;
  subject: string;
  notes: string;
  occurred_at: string;
  due_at: string | null;
  completed_at: string | null;
  created_by: UserSummary | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

export type CreateLeadActivityInput = {
  lead_id: string;
  activity_type: LeadActivityType | string;
  subject?: string;
  notes?: string;
  occurred_at?: string | null;
  due_at?: string | null;
  metadata?: Record<string, unknown>;
};

export type LeadFollowUp = {
  id: string;
  lead: Pick<LeadSummary, 'id' | 'lead_number' | 'name' | 'status' | 'raw_phone'> | null;
  assigned_to: UserSummary | null;
  scheduled_for: string;
  status: LeadFollowUpStatus | string;
  completed_at: string | null;
  completed_by: UserSummary | null;
  notes: string;
  created_by: UserSummary | null;
  created_at: string;
  updated_at: string;
  is_overdue: boolean;
};

export type CreateLeadFollowUpInput = {
  lead_id: string;
  scheduled_for: string;
  assigned_to_id?: number | null;
  notes?: string;
};

export type UpdateLeadFollowUpInput = {
  scheduled_for?: string;
  assigned_to_id?: number | null;
  notes?: string;
  status?: LeadFollowUpStatus | string;
};

export type CompleteLeadFollowUpInput = {
  notes?: string | null;
};

export type LeadAssignment = {
  id: string;
  lead: Pick<LeadSummary, 'id' | 'lead_number' | 'name' | 'status' | 'raw_phone'> | null;
  operations_employee: UserSummary | null;
  assigned_by: UserSummary | null;
  assigned_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  completed_at: string | null;
  status: LeadAssignmentStatus | string;
  notes: string;
  is_active: boolean;
};

export type AssignLeadInput = {
  lead_id: string;
  operations_employee_id: number;
  notes?: string;
};

export type ReassignLeadInput = AssignLeadInput;

export type LeadAssignmentActionInput = {
  notes?: string;
};

export type AssignmentSummary = LeadAssignment;
export type ActivitySummary = LeadActivity;
export type FollowUpSummary = LeadFollowUp;

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type MarketingApiErrorBody = {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
};

/** Common list query params for Marketing list endpoints. */
export type MarketingListParams = {
  page?: number;
  search?: string;
  ordering?: string;
  include_inactive?: boolean | string;
  inactive?: boolean | string;
  archived?: boolean | string;
  include_archived?: boolean | string;
  channel?: string;
  platform?: string;
  campaign?: string;
  ad_set?: string;
  advertisement?: string;
  status?: string;
  outcome?: string;
  owner?: string;
  customer?: string;
  lead?: string;
  activity_type?: string;
  actor?: string;
  assigned_to?: string;
  assigned_user?: string;
  active?: boolean | string;
  completed?: boolean | string;
  created_after?: string;
  created_before?: string;
  occurred_after?: string;
  occurred_before?: string;
  due_before?: string;
  due_after?: string;
  scheduled_from?: string;
  scheduled_to?: string;
  overdue?: boolean | string;
  assignment_state?: 'unassigned' | 'assigned' | string;
  spend_date_after?: string;
  spend_date_before?: string;
};

/* -------------------------------------------------------------------------- */
/* Phase 3.3B — Reporting DTOs (presentation only; values from Phase 3.3A)    */
/* -------------------------------------------------------------------------- */

/** Backend Decimal / ratio string (never treat as business float). */
export type MarketingDecimalString = string;

/** Conversion / cost ratios as 0–1 Decimal strings, or null when undefined. */
export type MarketingRatioString = string | null;

export type ReportingInterval = 'day' | 'week' | 'month';

export type MarketingReportFilters = {
  date_from: string;
  date_to: string;
  channel_id: string | null;
  platform_id: string | null;
  campaign_id: string | null;
  adset_id: string | null;
  advertisement_id: string | null;
  status: string | null;
  outcome: string | null;
  assigned_to: number | null;
  include_archived: boolean;
};

export type MarketingReportFilterParams = {
  date_from?: string;
  date_to?: string;
  channel_id?: string;
  platform_id?: string;
  campaign_id?: string;
  adset_id?: string;
  advertisement_id?: string;
  status?: string;
  outcome?: string;
  assigned_to?: number | string;
  include_archived?: boolean | string;
  interval?: ReportingInterval | string;
  search?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
};

export type MarketingCodeCount = {
  code: string | null;
  count: number;
};

export type MarketingOverviewLeads = {
  total: number;
  active: number;
  converted_cohort: number;
  conversion_events: number;
  lost: number;
  conversion_rate: MarketingRatioString;
  average_time_to_conversion_hours: MarketingDecimalString | null;
};

export type MarketingOverviewSpend = {
  total: MarketingDecimalString;
  cost_per_lead: MarketingDecimalString | null;
  cost_per_conversion: MarketingDecimalString | null;
};

export type MarketingOverviewFollowups = {
  pending: number;
  overdue: number;
  due_today: number;
  due_next_7_days: number;
  completed: number;
  cancelled: number;
};

export type MarketingOverviewAssignments = {
  unassigned_leads: number;
  pending: number;
  accepted: number;
  active_total: number;
};

export type MarketingOverviewReport = {
  filters: MarketingReportFilters;
  meta: Record<string, unknown>;
  leads: MarketingOverviewLeads;
  breakdowns: {
    status: MarketingCodeCount[];
    outcome: MarketingCodeCount[];
  };
  spend: MarketingOverviewSpend;
  followups: MarketingOverviewFollowups;
  assignments: MarketingOverviewAssignments;
};

export type LeadTrendPoint = {
  period: string;
  created: number;
  converted: number;
  lost: number;
};

export type LeadTrendsReport = {
  filters: MarketingReportFilters;
  interval: ReportingInterval;
  meta: Record<string, unknown>;
  series: LeadTrendPoint[];
};

export type CampaignPerformanceRow = {
  campaign_id: string;
  campaign_code: string;
  campaign_name: string;
  is_active: boolean;
  platform: { id: string; name: string };
  channel: { id: string; name: string };
  leads_created: number;
  converted_leads: number;
  conversion_rate: MarketingRatioString;
  spend: MarketingDecimalString;
  cost_per_lead: MarketingDecimalString | null;
  cost_per_conversion: MarketingDecimalString | null;
};

export type CampaignPerformanceReport = {
  filters: MarketingReportFilters;
  meta: Record<string, unknown>;
  count: number;
  page: number;
  page_size: number;
  results: CampaignPerformanceRow[];
};

export type FollowupAssigneeWorkload = {
  user_id: number;
  display_name: string;
  pending: number;
  overdue: number;
  completed: number;
  total: number;
};

export type FollowupWorkloadSummary = {
  pending: number;
  completed: number;
  cancelled: number;
  overdue: number;
  due_today: number;
  due_next_7_days: number;
  unassigned_pending: number;
};

export type FollowupWorkloadReport = {
  filters: MarketingReportFilters;
  meta: Record<string, unknown>;
  summary: FollowupWorkloadSummary;
  by_status: MarketingCodeCount[];
  by_assignee: FollowupAssigneeWorkload[];
};

export type AssignmentAssigneeWorkload = {
  user_id: number;
  display_name: string;
  pending: number;
  accepted: number;
  active_total: number;
  completed_in_range: number;
  rejected: number;
  cancelled: number;
  reassigned: number;
};

export type AssignmentWorkloadSummary = {
  pending: number;
  accepted: number;
  completed: number;
  rejected: number;
  cancelled: number;
  reassigned: number;
  completed_in_range: number;
  active_total: number;
  unassigned_leads: number;
};

export type AssignmentWorkloadReport = {
  filters: MarketingReportFilters;
  meta: Record<string, unknown>;
  summary: AssignmentWorkloadSummary;
  by_status: MarketingCodeCount[];
  by_assignee: AssignmentAssigneeWorkload[];
};

/** Phase 4.1 Revenue Attribution */
export type RevenueAttributionFilterParams = {
  date_from?: string;
  date_to?: string;
  conversion_date_from?: string;
  conversion_date_to?: string;
  channel_id?: string;
  platform_id?: string;
  campaign_id?: string;
  adset_id?: string;
  advertisement_id?: string;
  lead_id?: string;
  customer_id?: string;
  procedure_type_id?: string;
  include_archived?: boolean | string;
  search?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
};

export type RevenueOverviewSummary = {
  leads: number;
  converted_customers: number;
  procedures: number;
  collected_revenue: MarketingDecimalString;
  net_profit: MarketingDecimalString;
  campaign_spend: MarketingDecimalString;
  marketing_contribution: MarketingDecimalString;
  roas: MarketingDecimalString | null;
  marketing_roi: MarketingRatioString | null;
  customer_acquisition_cost: MarketingDecimalString | null;
  average_customer_revenue: MarketingDecimalString | null;
  average_customer_net_profit: MarketingDecimalString | null;
};

export type RevenueOverviewReport = {
  filters: Record<string, unknown>;
  summary: RevenueOverviewSummary;
  meta?: Record<string, unknown>;
};

export type RevenueNamedRef = {
  id: string | null;
  name: string | null;
  code?: string | null;
};

export type RevenueChannelRow = {
  channel: RevenueNamedRef;
  leads: number;
  converted_customers: number;
  procedures: number;
  collected_revenue: MarketingDecimalString;
  net_profit: MarketingDecimalString;
  campaign_spend: MarketingDecimalString;
  marketing_contribution: MarketingDecimalString;
  roas: MarketingDecimalString | null;
  marketing_roi: MarketingRatioString | null;
};

export type RevenueCampaignRow = {
  campaign: RevenueNamedRef;
  platform: RevenueNamedRef;
  channel: RevenueNamedRef;
  leads: number;
  converted_customers: number;
  procedures: number;
  collected_revenue: MarketingDecimalString;
  net_profit: MarketingDecimalString;
  campaign_spend: MarketingDecimalString;
  marketing_contribution: MarketingDecimalString;
  cost_per_lead: MarketingDecimalString | null;
  customer_acquisition_cost: MarketingDecimalString | null;
  roas: MarketingDecimalString | null;
  marketing_roi: MarketingRatioString | null;
};

export type RevenueLeadRow = {
  lead: { id: string; lead_number: string; name: string };
  customer: { id: string; display_name: string } | null;
  channel: RevenueNamedRef | null;
  campaign: RevenueNamedRef | null;
  converted_at: string | null;
  procedures: number;
  collected_revenue: MarketingDecimalString;
  net_profit: MarketingDecimalString;
  first_payment_at: string | null;
  latest_payment_at: string | null;
};

export type RevenuePlatformRow = {
  platform: RevenueNamedRef;
  channel: RevenueNamedRef;
  leads: number;
  converted_customers: number;
  procedures: number;
  collected_revenue: MarketingDecimalString;
  net_profit: MarketingDecimalString;
  campaign_spend: MarketingDecimalString;
  marketing_contribution: MarketingDecimalString;
  roas: MarketingDecimalString | null;
  marketing_roi: MarketingRatioString | null;
};

export type RevenueCustomerRow = {
  customer: { id: string; display_name: string } | null;
  lead_number: string;
  lead_id: string;
  campaign: RevenueNamedRef | null;
  converted_at: string | null;
  procedures: number;
  collected_revenue: MarketingDecimalString;
  net_profit: MarketingDecimalString;
  first_payment_at: string | null;
  latest_payment_at: string | null;
};

export type RevenueProcedureTypeRow = {
  procedure_type: string;
  procedure_count: number;
  customer_count: number;
  collected_revenue: MarketingDecimalString | null;
  net_profit: MarketingDecimalString;
  average_revenue: MarketingDecimalString | null;
  average_net_profit: MarketingDecimalString | null;
};

export type RevenuePaginated<T> = {
  filters: Record<string, unknown>;
  count: number;
  page: number;
  page_size: number;
  results: T[];
  meta?: Record<string, unknown>;
};
