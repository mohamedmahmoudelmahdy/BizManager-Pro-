/** HR portal attestation DTOs (read-only). */

export type HRAttestationStatus =
  | 'documents_received'
  | 'dataflow_in_progress'
  | 'mohesr_in_progress'
  | 'completed';

export interface HRCustomerSummary {
  id: string;
  display_name: string;
}

export interface HRBatchSummary {
  id: string;
  title: string;
  expected_applicant_count: number | null;
  is_active: boolean;
}

export interface HROverviewResponse {
  customer: HRCustomerSummary;
  batch: HRBatchSummary | null;
  summary: {
    submitted: number;
    documents_received: number;
    dataflow_in_progress: number;
    mohesr_in_progress: number;
    completed: number;
    remaining_expected: number;
  };
}

export interface HRDocumentsSummary {
  count: number;
  label: string;
  has_passport: boolean;
  has_degree_documents: boolean;
}

export interface HRApplicationSummary {
  id: string;
  reference_number: string;
  full_name: string;
  phone: string;
  degree_count: number;
  documents_summary: HRDocumentsSummary;
  status: HRAttestationStatus;
  dataflow_reference: string;
  mohesr_reference: string;
  submitted_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface HRDegree {
  id: string;
  study_location: string;
  university: string;
  degree_level: string;
  major: string;
  start_year: number;
  completion_year: number;
  final_grade: string;
  sort_order: number;
}

export interface HRDocument {
  id: string;
  degree: string | null;
  document_type: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  download_path: string;
}

export interface HRStatusHistoryItem {
  id: string;
  from_status: string;
  to_status: string;
  changed_at: string;
}

export interface HRApplicationDetail {
  id: string;
  reference_number: string;
  full_name: string;
  phone: string;
  status: HRAttestationStatus;
  degrees: HRDegree[];
  documents: HRDocument[];
  dataflow_reference: string;
  dataflow_submitted_at: string | null;
  mohesr_reference: string;
  mohesr_submitted_at: string | null;
  submitted_at: string;
  updated_at: string;
  completed_at: string | null;
  status_history: HRStatusHistoryItem[];
  batch: HRBatchSummary;
}

export interface PaginatedHRApplications {
  count: number;
  next: string | null;
  previous: string | null;
  results: HRApplicationSummary[];
}

export interface HRApplicationListParams {
  page?: number;
  search?: string;
  status?: HRAttestationStatus | '';
  submitted_from?: string;
  submitted_to?: string;
  ordering?: string;
}
