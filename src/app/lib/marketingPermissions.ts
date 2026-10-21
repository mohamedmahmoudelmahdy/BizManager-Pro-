/**
 * Marketing CRM permission codes and UX helpers.
 * Backend remains authoritative; these gate navigation and route access only.
 */

export const MARKETING_PERMISSIONS = {
  viewDashboard: 'marketing.view_marketing_dashboard',
  viewLead: 'marketing.view_lead',
  addLead: 'marketing.add_lead',
  changeLead: 'marketing.change_lead',
  convertLead: 'marketing.convert_lead',
  assignLead: 'marketing.assign_lead',
  manageLeadActivity: 'marketing.manage_lead_activity',
  viewActivity: 'marketing.view_leadactivity',
  addActivity: 'marketing.add_leadactivity',
  viewFollowUp: 'marketing.view_leadfollowup',
  addFollowUp: 'marketing.add_leadfollowup',
  changeFollowUp: 'marketing.change_leadfollowup',
  viewAssignment: 'marketing.view_leadassignment',
  changeAssignment: 'marketing.change_leadassignment',
  viewCampaign: 'marketing.view_marketingcampaign',
  addCampaign: 'marketing.add_marketingcampaign',
  changeCampaign: 'marketing.change_marketingcampaign',
  viewChannel: 'marketing.view_marketingchannel',
  addChannel: 'marketing.add_marketingchannel',
  changeChannel: 'marketing.change_marketingchannel',
  viewPlatform: 'marketing.view_marketingplatform',
  addPlatform: 'marketing.add_marketingplatform',
  changePlatform: 'marketing.change_marketingplatform',
  viewAdSet: 'marketing.view_marketingadset',
  addAdSet: 'marketing.add_marketingadset',
  changeAdSet: 'marketing.change_marketingadset',
  viewAdvertisement: 'marketing.view_marketingadvertisement',
  addAdvertisement: 'marketing.add_marketingadvertisement',
  changeAdvertisement: 'marketing.change_marketingadvertisement',
  viewCampaignSpend: 'marketing.view_campaignspend',
  addCampaignSpend: 'marketing.add_campaignspend',
  changeCampaignSpend: 'marketing.change_campaignspend',
  manageCampaignSpend: 'marketing.manage_campaign_spend',
  viewReport: 'marketing.view_marketing_report',
  exportReport: 'marketing.export_marketing_report',
} as const;

/** Any of these grants entry to the Marketing module shell. */
export const MARKETING_MODULE_ENTRY_PERMISSIONS = [
  MARKETING_PERMISSIONS.viewDashboard,
  MARKETING_PERMISSIONS.viewLead,
  MARKETING_PERMISSIONS.viewCampaign,
  MARKETING_PERMISSIONS.viewChannel,
  MARKETING_PERMISSIONS.viewPlatform,
  MARKETING_PERMISSIONS.viewAdSet,
  MARKETING_PERMISSIONS.viewAdvertisement,
  MARKETING_PERMISSIONS.viewCampaignSpend,
  MARKETING_PERMISSIONS.viewFollowUp,
  MARKETING_PERMISSIONS.viewAssignment,
  MARKETING_PERMISSIONS.viewReport,
  MARKETING_PERMISSIONS.manageLeadActivity,
] as const;

/** Access to Campaign Management workspace (any hierarchy/spend view). */
export const MARKETING_CAMPAIGN_WORKSPACE_PERMISSIONS = [
  MARKETING_PERMISSIONS.viewCampaign,
  MARKETING_PERMISSIONS.viewChannel,
  MARKETING_PERMISSIONS.viewPlatform,
  MARKETING_PERMISSIONS.viewAdSet,
  MARKETING_PERMISSIONS.viewAdvertisement,
  MARKETING_PERMISSIONS.viewCampaignSpend,
] as const;
