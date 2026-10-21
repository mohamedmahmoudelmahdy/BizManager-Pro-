import { useMemo } from 'react';
import { useAuth } from '@/app/contexts/AuthContext';
import {
  MARKETING_CAMPAIGN_WORKSPACE_PERMISSIONS,
  MARKETING_MODULE_ENTRY_PERMISSIONS,
  MARKETING_PERMISSIONS,
} from '@/app/lib/marketingPermissions';

const ALLOW_ADMIN_MANAGER = { allowAdminManager: true } as const;

/**
 * Permission-aware helpers for Marketing CRM navigation and guards.
 * Uses /api/me permissions via AuthContext — not group labels or hardcoded roles.
 */
export function useMarketingPermissions() {
  const { user, loading, hasPermission, hasAnyPermission } = useAuth();

  return useMemo(() => {
    const can = (permission: string) => hasPermission(permission, ALLOW_ADMIN_MANAGER);
    const canAny = (permissions: string[]) => hasAnyPermission(permissions, ALLOW_ADMIN_MANAGER);

    return {
      loading,
      user,
      permissions: user?.permissions ?? [],
      canEnterModule: canAny([...MARKETING_MODULE_ENTRY_PERMISSIONS]),
      canViewCampaignWorkspace: canAny([...MARKETING_CAMPAIGN_WORKSPACE_PERMISSIONS]),
      canViewDashboard: can(MARKETING_PERMISSIONS.viewDashboard),
      canViewLeads: can(MARKETING_PERMISSIONS.viewLead),
      canAddLead: can(MARKETING_PERMISSIONS.addLead),
      canChangeLead: can(MARKETING_PERMISSIONS.changeLead),
      canConvertLead: can(MARKETING_PERMISSIONS.convertLead),
      canAssignLead: can(MARKETING_PERMISSIONS.assignLead),
      canViewActivities:
        can(MARKETING_PERMISSIONS.viewActivity) || can(MARKETING_PERMISSIONS.manageLeadActivity),
      canAddActivity:
        can(MARKETING_PERMISSIONS.addActivity) || can(MARKETING_PERMISSIONS.manageLeadActivity),
      canViewFollowUps:
        can(MARKETING_PERMISSIONS.viewFollowUp) || can(MARKETING_PERMISSIONS.manageLeadActivity),
      canAddFollowUp:
        can(MARKETING_PERMISSIONS.addFollowUp) || can(MARKETING_PERMISSIONS.manageLeadActivity),
      canChangeFollowUp:
        can(MARKETING_PERMISSIONS.changeFollowUp) || can(MARKETING_PERMISSIONS.manageLeadActivity),
      canViewAssignments: can(MARKETING_PERMISSIONS.viewAssignment),
      canChangeAssignment:
        can(MARKETING_PERMISSIONS.changeAssignment) || can(MARKETING_PERMISSIONS.assignLead),
      canViewCampaigns: can(MARKETING_PERMISSIONS.viewCampaign),
      canAddCampaign: can(MARKETING_PERMISSIONS.addCampaign),
      canChangeCampaign: can(MARKETING_PERMISSIONS.changeCampaign),
      canViewChannels: can(MARKETING_PERMISSIONS.viewChannel),
      canAddChannel: can(MARKETING_PERMISSIONS.addChannel),
      canChangeChannel: can(MARKETING_PERMISSIONS.changeChannel),
      canViewPlatforms: can(MARKETING_PERMISSIONS.viewPlatform),
      canAddPlatform: can(MARKETING_PERMISSIONS.addPlatform),
      canChangePlatform: can(MARKETING_PERMISSIONS.changePlatform),
      canViewAdSets: can(MARKETING_PERMISSIONS.viewAdSet),
      canAddAdSet: can(MARKETING_PERMISSIONS.addAdSet),
      canChangeAdSet: can(MARKETING_PERMISSIONS.changeAdSet),
      canViewAdvertisements: can(MARKETING_PERMISSIONS.viewAdvertisement),
      canAddAdvertisement: can(MARKETING_PERMISSIONS.addAdvertisement),
      canChangeAdvertisement: can(MARKETING_PERMISSIONS.changeAdvertisement),
      canViewSpend: can(MARKETING_PERMISSIONS.viewCampaignSpend),
      canAddSpend: can(MARKETING_PERMISSIONS.addCampaignSpend),
      canChangeSpend: can(MARKETING_PERMISSIONS.changeCampaignSpend),
      canViewReports: can(MARKETING_PERMISSIONS.viewReport),
      can: can,
      canAny: canAny,
      codes: MARKETING_PERMISSIONS,
    };
  }, [user, loading, hasPermission, hasAnyPermission]);
}
