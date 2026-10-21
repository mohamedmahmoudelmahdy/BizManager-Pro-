/**
 * Attestation permission codes and UX helpers.
 * Backend remains authoritative; these gate navigation and actions only.
 */

export const ATTESTATION_PERMISSIONS = {
  view: 'attestation.view_attestationapplication',
  change: 'attestation.change_attestationapplication',
  process: 'attestation.process_attestationapplication',
  viewInternalNotes: 'attestation.view_internal_notes',
  manageBatch: 'attestation.manage_attestationbatch',
} as const;

/** Any of these grants entry to the Attestation workspace. */
export const ATTESTATION_MODULE_ENTRY_PERMISSIONS = [
  ATTESTATION_PERMISSIONS.view,
  ATTESTATION_PERMISSIONS.change,
  ATTESTATION_PERMISSIONS.process,
  ATTESTATION_PERMISSIONS.viewInternalNotes,
  ATTESTATION_PERMISSIONS.manageBatch,
] as const;
