/** Certificate Attestation DTOs — mirror Phase A serializers. */

export const ATTESTATION_STATUSES = [
  'documents_received',
  'dataflow_in_progress',
  'mohesr_in_progress',
  'completed',
] as const;

export type AttestationStatus = (typeof ATTESTATION_STATUSES)[number];

export type AttestationDocumentType =
  | 'passport'
  | 'degree_certificate'
  | 'transcript'
  | 'dataflow_payment_proof'
  | 'dataflow_result'
  | 'mohesr_payment_proof'
  | 'final_equivalency'
  | 'other_internal';

export type AttestationDocumentVisibility =
  | 'internal'
  | 'hr'
  | 'applicant_submission';

export type AttestationActorSource = 'public_submission' | 'internal' | 'system';

export interface AttestationBatchSummary {
  id: string;
  title: string;
  public_slug: string;
  expected_applicant_count: number | null;
  is_active: boolean;
  customer: string;
  customer_name: string;
  procedure_id: string;
}

export interface ApplicationDegree {
  id: string;
  study_location: string;
  university: string;
  degree_level: string;
  major: string;
  start_year: number;
  completion_year: number;
  final_grade: string;
  sort_order: number;
  created_at: string;
}

export interface ApplicationDocument {
  id: string;
  degree: string | null;
  document_type: AttestationDocumentType;
  visibility: AttestationDocumentVisibility;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  download_path: string;
}

export interface ApplicationStatusHistory {
  id: string;
  from_status: string;
  to_status: string;
  changed_by: number | string | null;
  changed_by_username: string | null;
  actor_source: AttestationActorSource;
  internal_note: string;
  changed_at: string;
}

export interface AttestationApplicationSummary {
  id: string;
  reference_number: string;
  full_name: string;
  phone: string;
  status: AttestationStatus;
  batch: string;
  batch_title: string;
  batch_expected_count: number | null;
  dataflow_reference: string;
  mohesr_reference: string;
  submitted_at: string;
  updated_at: string;
  completed_at: string | null;
  degree_count: number;
}

export interface AttestationApplicationDetail {
  id: string;
  reference_number: string;
  full_name: string;
  phone: string;
  phone_normalized: string;
  status: AttestationStatus;
  internal_notes: string;
  dataflow_reference: string;
  dataflow_submitted_at: string | null;
  mohesr_reference: string;
  mohesr_submitted_at: string | null;
  submitted_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  batch: AttestationBatchSummary;
  degrees: ApplicationDegree[];
  documents: ApplicationDocument[];
  status_history: ApplicationStatusHistory[];
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type PaginatedAttestationApplications = PaginatedResponse<AttestationApplicationSummary>;

export interface AttestationListParams {
  page?: number;
  search?: string;
  status?: AttestationStatus | '';
  batch?: string;
  submitted_from?: string;
  submitted_to?: string;
  ordering?: string;
}

export interface UpdateInternalNotesInput {
  internal_notes: string;
}

export interface SetDataFlowInput {
  dataflow_reference?: string;
  dataflow_submitted_at?: string;
  dataflow_payment_proof?: File | null;
  dataflow_result?: File | null;
}

export interface SetMOHESRInput {
  mohesr_reference?: string;
  mohesr_submitted_at?: string;
  mohesr_payment_proof?: File | null;
}

export interface CompleteAttestationInput {
  final_equivalency?: File | null;
}

export interface AttestationApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}
