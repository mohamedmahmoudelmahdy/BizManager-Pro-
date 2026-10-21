/** HR portal attestation permissions and entry codes. */

export const HR_ATTESTATION_PERMISSIONS = {
  viewPortal: 'attestation.view_hr_attestation_portal',
  viewApplication: 'attestation.view_hr_attestationapplication',
  downloadDocument: 'attestation.download_hr_attestationdocument',
} as const;

export const HR_PORTAL_ENTRY_PERMISSIONS = [
  HR_ATTESTATION_PERMISSIONS.viewPortal,
  HR_ATTESTATION_PERMISSIONS.viewApplication,
] as const;
