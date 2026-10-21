/**
 * Marketing CRM API client — thin wrappers over shared fetch helpers.
 * Base path: /api/marketing/
 * Mutations: POST create, PATCH update, POST archive. No PUT/DELETE.
 */

import { deleteJson, getJson, patchJson, postJson } from '@/app/lib/api';
import type {
  ArchiveLeadInput,
  AssignLeadInput,
  CampaignSpend,
  CompleteLeadFollowUpInput,
  ConvertCustomerMatchSummary,
  CreateAdSetInput,
  CreateAdvertisementInput,
  CreateCampaignInput,
  CreateCampaignSpendInput,
  CreateChannelInput,
  CreateLeadActivityInput,
  CreateLeadFollowUpInput,
  CreateLeadInput,
  CreatePlatformInput,
  LeadActivity,
  LeadAssignment,
  LeadAssignmentActionInput,
  LeadConversionInput,
  LeadDetail,
  LeadFollowUp,
  LeadSummary,
  MarketingAdSet,
  MarketingAdvertisement,
  MarketingCampaign,
  MarketingChannel,
  MarketingListParams,
  MarketingPlatform,
  PaginatedResponse,
  ReassignLeadInput,
  ReportingInterval,
  UpdateAdSetInput,
  UpdateAdvertisementInput,
  UpdateCampaignInput,
  UpdateCampaignSpendInput,
  UpdateChannelInput,
  UpdateLeadFollowUpInput,
  UpdateLeadInput,
  UpdatePlatformInput,
  AssignmentWorkloadReport,
  CampaignPerformanceReport,
  FollowupWorkloadReport,
  LeadTrendsReport,
  MarketingOverviewReport,
  MarketingReportFilterParams,
  RevenueAttributionFilterParams,
  RevenueCampaignRow,
  RevenueChannelRow,
  RevenueCustomerRow,
  RevenueLeadRow,
  RevenueOverviewReport,
  RevenuePaginated,
  RevenuePlatformRow,
  RevenueProcedureTypeRow,
} from '@/app/lib/marketingTypes';

export const MARKETING_API_BASE = '/marketing';

function marketingPath(path: string): string {
  const cleaned = path.startsWith('/') ? path : `/${path}`;
  return `${MARKETING_API_BASE}${cleaned}`;
}

/** Build query string; omits undefined / null / empty values. */
export function buildMarketingQuery(
  params?: MarketingListParams | Record<string, unknown>,
  options?: { keepEmptyKeys?: string[] }
): string {
  if (!params) return '';
  const keepEmpty = new Set(options?.keepEmptyKeys ?? []);
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (value === '' && !keepEmpty.has(key)) continue;
    if (typeof value === 'boolean') {
      if (value) sp.set(key, 'true');
      continue;
    }
    sp.set(key, String(value));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export const marketingApi = {
  get: <T>(path: string, init?: RequestInit) => getJson<T>(marketingPath(path), init),
  post: <T>(path: string, body: unknown, init?: RequestInit) =>
    postJson<T>(marketingPath(path), body, init),
  patch: <T>(path: string, body: unknown, init?: RequestInit) =>
    patchJson<T>(marketingPath(path), body, init),
  delete: (path: string) => deleteJson(marketingPath(path)),
};

export const marketingPaths = {
  channels: '/channels/',
  channel: (id: string) => `/channels/${id}/`,
  channelArchive: (id: string) => `/channels/${id}/archive/`,
  platforms: '/platforms/',
  platform: (id: string) => `/platforms/${id}/`,
  platformArchive: (id: string) => `/platforms/${id}/archive/`,
  campaigns: '/campaigns/',
  campaign: (id: string) => `/campaigns/${id}/`,
  campaignArchive: (id: string) => `/campaigns/${id}/archive/`,
  adsets: '/adsets/',
  adset: (id: string) => `/adsets/${id}/`,
  adsetArchive: (id: string) => `/adsets/${id}/archive/`,
  advertisements: '/advertisements/',
  advertisement: (id: string) => `/advertisements/${id}/`,
  advertisementArchive: (id: string) => `/advertisements/${id}/archive/`,
  campaignSpend: '/campaign-spend/',
  campaignSpendItem: (id: string) => `/campaign-spend/${id}/`,
  leads: '/leads/',
  lead: (id: string) => `/leads/${id}/`,
  leadArchive: (id: string) => `/leads/${id}/archive/`,
  leadConvert: (id: string) => `/leads/${id}/convert/`,
  leadCustomerMatches: (id: string) => `/leads/${id}/customer-matches/`,
  activities: '/activities/',
  activity: (id: string) => `/activities/${id}/`,
  followups: '/followups/',
  followup: (id: string) => `/followups/${id}/`,
  followupComplete: (id: string) => `/followups/${id}/complete/`,
  assignments: '/assignments/',
  assignment: (id: string) => `/assignments/${id}/`,
  assignmentAssign: '/assignments/assign/',
  assignmentReassign: '/assignments/reassign/',
  assignmentAccept: (id: string) => `/assignments/${id}/accept/`,
  assignmentReject: (id: string) => `/assignments/${id}/reject/`,
  assignmentComplete: (id: string) => `/assignments/${id}/complete/`,
  assignmentCancel: (id: string) => `/assignments/${id}/cancel/`,
  reportsOverview: '/reports/overview/',
  reportsLeadTrends: '/reports/lead-trends/',
  reportsCampaignPerformance: '/reports/campaign-performance/',
  reportsFollowupWorkload: '/reports/followup-workload/',
  reportsAssignmentWorkload: '/reports/assignment-workload/',
  revenueOverview: '/revenue/overview/',
  revenueChannels: '/revenue/channels/',
  revenuePlatforms: '/revenue/platforms/',
  revenueCampaigns: '/revenue/campaigns/',
  revenueLeads: '/revenue/leads/',
  revenueCustomers: '/revenue/customers/',
  revenueProcedureTypes: '/revenue/procedure-types/',
} as const;

type ListInit = { signal?: AbortSignal };

function listResource<T>(path: string, params?: MarketingListParams, init?: ListInit) {
  return marketingApi.get<PaginatedResponse<T>>(`${path}${buildMarketingQuery(params)}`, {
    signal: init?.signal,
  });
}

export const marketingChannelsApi = {
  list: (params?: MarketingListParams, init?: ListInit) =>
    listResource<MarketingChannel>(marketingPaths.channels, params, init),
  get: (id: string, init?: ListInit) =>
    marketingApi.get<MarketingChannel>(marketingPaths.channel(id), { signal: init?.signal }),
  create: (body: CreateChannelInput) =>
    marketingApi.post<MarketingChannel>(marketingPaths.channels, body),
  update: (id: string, body: UpdateChannelInput) =>
    marketingApi.patch<MarketingChannel>(marketingPaths.channel(id), body),
  archive: (id: string) => marketingApi.post<MarketingChannel>(marketingPaths.channelArchive(id), {}),
};

export const marketingPlatformsApi = {
  list: (params?: MarketingListParams, init?: ListInit) =>
    listResource<MarketingPlatform>(marketingPaths.platforms, params, init),
  get: (id: string, init?: ListInit) =>
    marketingApi.get<MarketingPlatform>(marketingPaths.platform(id), { signal: init?.signal }),
  create: (body: CreatePlatformInput) =>
    marketingApi.post<MarketingPlatform>(marketingPaths.platforms, body),
  update: (id: string, body: UpdatePlatformInput) =>
    marketingApi.patch<MarketingPlatform>(marketingPaths.platform(id), body),
  archive: (id: string) =>
    marketingApi.post<MarketingPlatform>(marketingPaths.platformArchive(id), {}),
};

export const marketingCampaignsApi = {
  list: (params?: MarketingListParams, init?: ListInit) =>
    listResource<MarketingCampaign>(marketingPaths.campaigns, params, init),
  get: (id: string, init?: ListInit) =>
    marketingApi.get<MarketingCampaign>(marketingPaths.campaign(id), { signal: init?.signal }),
  create: (body: CreateCampaignInput) =>
    marketingApi.post<MarketingCampaign>(marketingPaths.campaigns, body),
  update: (id: string, body: UpdateCampaignInput) =>
    marketingApi.patch<MarketingCampaign>(marketingPaths.campaign(id), body),
  archive: (id: string) =>
    marketingApi.post<MarketingCampaign>(marketingPaths.campaignArchive(id), {}),
};

export const marketingAdSetsApi = {
  list: (params?: MarketingListParams, init?: ListInit) =>
    listResource<MarketingAdSet>(marketingPaths.adsets, params, init),
  get: (id: string, init?: ListInit) =>
    marketingApi.get<MarketingAdSet>(marketingPaths.adset(id), { signal: init?.signal }),
  create: (body: CreateAdSetInput) => marketingApi.post<MarketingAdSet>(marketingPaths.adsets, body),
  update: (id: string, body: UpdateAdSetInput) =>
    marketingApi.patch<MarketingAdSet>(marketingPaths.adset(id), body),
  archive: (id: string) => marketingApi.post<MarketingAdSet>(marketingPaths.adsetArchive(id), {}),
};

export const marketingAdvertisementsApi = {
  list: (params?: MarketingListParams, init?: ListInit) =>
    listResource<MarketingAdvertisement>(marketingPaths.advertisements, params, init),
  get: (id: string, init?: ListInit) =>
    marketingApi.get<MarketingAdvertisement>(marketingPaths.advertisement(id), {
      signal: init?.signal,
    }),
  create: (body: CreateAdvertisementInput) =>
    marketingApi.post<MarketingAdvertisement>(marketingPaths.advertisements, body),
  update: (id: string, body: UpdateAdvertisementInput) =>
    marketingApi.patch<MarketingAdvertisement>(marketingPaths.advertisement(id), body),
  archive: (id: string) =>
    marketingApi.post<MarketingAdvertisement>(marketingPaths.advertisementArchive(id), {}),
};

export const marketingCampaignSpendApi = {
  list: (params?: MarketingListParams, init?: ListInit) =>
    listResource<CampaignSpend>(marketingPaths.campaignSpend, params, init),
  get: (id: string, init?: ListInit) =>
    marketingApi.get<CampaignSpend>(marketingPaths.campaignSpendItem(id), { signal: init?.signal }),
  create: (body: CreateCampaignSpendInput) =>
    marketingApi.post<CampaignSpend>(marketingPaths.campaignSpend, body),
  update: (id: string, body: UpdateCampaignSpendInput) =>
    marketingApi.patch<CampaignSpend>(marketingPaths.campaignSpendItem(id), body),
};

export const marketingLeadsApi = {
  list: (params?: MarketingListParams, init?: ListInit) =>
    listResource<LeadSummary>(marketingPaths.leads, params, init),
  get: (id: string, init?: ListInit) =>
    marketingApi.get<LeadDetail>(marketingPaths.lead(id), { signal: init?.signal }),
  create: (body: CreateLeadInput) => marketingApi.post<LeadDetail>(marketingPaths.leads, body),
  update: (id: string, body: UpdateLeadInput) =>
    marketingApi.patch<LeadDetail>(marketingPaths.lead(id), body),
  archive: (id: string, body: ArchiveLeadInput) =>
    marketingApi.post<LeadDetail>(marketingPaths.leadArchive(id), body),
  convert: (id: string, body: LeadConversionInput) =>
    marketingApi.post<LeadDetail>(marketingPaths.leadConvert(id), body),
  customerMatches: (id: string, init?: ListInit) =>
    marketingApi.get<{ matches: ConvertCustomerMatchSummary[] }>(
      marketingPaths.leadCustomerMatches(id),
      { signal: init?.signal }
    ),
};

export const marketingActivitiesApi = {
  list: (params?: MarketingListParams, init?: ListInit) =>
    listResource<LeadActivity>(marketingPaths.activities, params, init),
  get: (id: string, init?: ListInit) =>
    marketingApi.get<LeadActivity>(marketingPaths.activity(id), { signal: init?.signal }),
  create: (body: CreateLeadActivityInput) =>
    marketingApi.post<LeadActivity>(marketingPaths.activities, body),
};

export const marketingFollowUpsApi = {
  list: (params?: MarketingListParams, init?: ListInit) =>
    listResource<LeadFollowUp>(marketingPaths.followups, params, init),
  get: (id: string, init?: ListInit) =>
    marketingApi.get<LeadFollowUp>(marketingPaths.followup(id), { signal: init?.signal }),
  create: (body: CreateLeadFollowUpInput) =>
    marketingApi.post<LeadFollowUp>(marketingPaths.followups, body),
  update: (id: string, body: UpdateLeadFollowUpInput) =>
    marketingApi.patch<LeadFollowUp>(marketingPaths.followup(id), body),
  complete: (id: string, body: CompleteLeadFollowUpInput = {}) =>
    marketingApi.post<LeadFollowUp>(marketingPaths.followupComplete(id), body),
};

export const marketingAssignmentsApi = {
  list: (params?: MarketingListParams, init?: ListInit) =>
    listResource<LeadAssignment>(marketingPaths.assignments, params, init),
  get: (id: string, init?: ListInit) =>
    marketingApi.get<LeadAssignment>(marketingPaths.assignment(id), { signal: init?.signal }),
  assign: (body: AssignLeadInput) =>
    marketingApi.post<LeadAssignment>(marketingPaths.assignmentAssign, body),
  reassign: (body: ReassignLeadInput) =>
    marketingApi.post<LeadAssignment>(marketingPaths.assignmentReassign, body),
  accept: (id: string, body: LeadAssignmentActionInput = {}) =>
    marketingApi.post<LeadAssignment>(marketingPaths.assignmentAccept(id), body),
  reject: (id: string, body: LeadAssignmentActionInput = {}) =>
    marketingApi.post<LeadAssignment>(marketingPaths.assignmentReject(id), body),
  complete: (id: string, body: LeadAssignmentActionInput = {}) =>
    marketingApi.post<LeadAssignment>(marketingPaths.assignmentComplete(id), body),
  cancel: (id: string, body: LeadAssignmentActionInput = {}) =>
    marketingApi.post<LeadAssignment>(marketingPaths.assignmentCancel(id), body),
};

/** Phase 3.3A reporting — read-only; no client aggregation. */
function reportQuery(params?: MarketingReportFilterParams): string {
  return buildMarketingQuery(params, { keepEmptyKeys: ['outcome'] });
}

export const marketingReportsApi = {
  overview: (params?: MarketingReportFilterParams, init?: ListInit) =>
    marketingApi.get<MarketingOverviewReport>(
      `${marketingPaths.reportsOverview}${reportQuery(params)}`,
      { signal: init?.signal }
    ),
  leadTrends: (params?: MarketingReportFilterParams, init?: ListInit) =>
    marketingApi.get<LeadTrendsReport>(
      `${marketingPaths.reportsLeadTrends}${reportQuery(params)}`,
      { signal: init?.signal }
    ),
  campaignPerformance: (params?: MarketingReportFilterParams, init?: ListInit) =>
    marketingApi.get<CampaignPerformanceReport>(
      `${marketingPaths.reportsCampaignPerformance}${reportQuery(params)}`,
      { signal: init?.signal }
    ),
  followupWorkload: (params?: MarketingReportFilterParams, init?: ListInit) =>
    marketingApi.get<FollowupWorkloadReport>(
      `${marketingPaths.reportsFollowupWorkload}${reportQuery(params)}`,
      { signal: init?.signal }
    ),
  assignmentWorkload: (params?: MarketingReportFilterParams, init?: ListInit) =>
    marketingApi.get<AssignmentWorkloadReport>(
      `${marketingPaths.reportsAssignmentWorkload}${reportQuery(params)}`,
      { signal: init?.signal }
    ),
};

/** Phase 4.1 Revenue Attribution — GET-only; display formatting only on client. */
function revenueQuery(params?: RevenueAttributionFilterParams): string {
  return buildMarketingQuery(params);
}

export const marketingRevenueApi = {
  overview: (params?: RevenueAttributionFilterParams, init?: ListInit) =>
    marketingApi.get<RevenueOverviewReport>(
      `${marketingPaths.revenueOverview}${revenueQuery(params)}`,
      { signal: init?.signal }
    ),
  channels: (params?: RevenueAttributionFilterParams, init?: ListInit) =>
    marketingApi.get<RevenuePaginated<RevenueChannelRow>>(
      `${marketingPaths.revenueChannels}${revenueQuery(params)}`,
      { signal: init?.signal }
    ),
  platforms: (params?: RevenueAttributionFilterParams, init?: ListInit) =>
    marketingApi.get<RevenuePaginated<RevenuePlatformRow>>(
      `${marketingPaths.revenuePlatforms}${revenueQuery(params)}`,
      { signal: init?.signal }
    ),
  campaigns: (params?: RevenueAttributionFilterParams, init?: ListInit) =>
    marketingApi.get<RevenuePaginated<RevenueCampaignRow>>(
      `${marketingPaths.revenueCampaigns}${revenueQuery(params)}`,
      { signal: init?.signal }
    ),
  leads: (params?: RevenueAttributionFilterParams, init?: ListInit) =>
    marketingApi.get<RevenuePaginated<RevenueLeadRow>>(
      `${marketingPaths.revenueLeads}${revenueQuery(params)}`,
      { signal: init?.signal }
    ),
  customers: (params?: RevenueAttributionFilterParams, init?: ListInit) =>
    marketingApi.get<RevenuePaginated<RevenueCustomerRow>>(
      `${marketingPaths.revenueCustomers}${revenueQuery(params)}`,
      { signal: init?.signal }
    ),
  procedureTypes: (params?: RevenueAttributionFilterParams, init?: ListInit) =>
    marketingApi.get<RevenuePaginated<RevenueProcedureTypeRow>>(
      `${marketingPaths.revenueProcedureTypes}${revenueQuery(params)}`,
      { signal: init?.signal }
    ),
};

export type { ReportingInterval };
