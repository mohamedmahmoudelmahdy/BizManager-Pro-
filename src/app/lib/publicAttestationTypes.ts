/** Public applicant attestation form types (no internal DTOs). */

export type PublicAttestationDegreeInput = {
  clientId: string;
  study_location: string;
  university: string;
  degree_level: string;
  major: string;
  start_year: string;
  completion_year: string;
  final_grade: string;
  certificate: File | null;
  transcript: File | null;
};

export type PublicAttestationFormState = {
  full_name: string;
  phone: string;
  degrees: PublicAttestationDegreeInput[];
  passport: File | null;
  /** Honeypot — must stay empty for real applicants. */
  website: string;
  /** Optional future CAPTCHA token; unused when provider is disabled. */
  captcha_token?: string;
};

export type PublicAttestationSubmissionResponse = {
  reference_number: string;
  status: string;
  submitted_at: string;
  message_code: string;
};

export type PublicAttestationErrorDetails = {
  field?: string;
  reason?: string;
  index?: number;
  degree_index?: number;
  missing?: string[];
  forbidden_fields?: string[];
  max_bytes?: number;
  max_total_bytes?: number;
  size?: number;
  [key: string]: unknown;
};

export type PublicAttestationApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: PublicAttestationErrorDetails;
  };
  detail?: string;
};

export const PUBLIC_ATTESTATION_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const PUBLIC_ATTESTATION_MAX_TOTAL_BYTES = 45 * 1024 * 1024;
export const PUBLIC_ATTESTATION_ALLOWED_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
] as const;
export const PUBLIC_ATTESTATION_YEAR_MIN = 1950;
export const PUBLIC_ATTESTATION_YEAR_MAX = 2100;
export const PUBLIC_ATTESTATION_NAME_MAX = 255;
export const PUBLIC_ATTESTATION_PHONE_MAX = 50;
