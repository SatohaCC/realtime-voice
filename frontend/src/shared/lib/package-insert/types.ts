export interface ImportedProduct {
  yj_code: string | null;
  brand_name: string | null;
}

export interface ImportedRevision {
  source_label: string | null;
  year_month: string | null;
  version: string | null;
}

export interface ImportWarning {
  code: string;
  reference: string;
}

export interface CleanupPendingItem {
  version_id: string;
  reason: string;
}

export interface PackageInsertImportResult {
  document_id: string;
  source_sha256: string;
  status: "active" | "superseded";
  reused: boolean;
  validation_status: string;
  section_count: number;
  search_unit_count: number;
  products: ImportedProduct[];
  revisions: ImportedRevision[];
  warnings: ImportWarning[];
  transformer_version: string;
  search_index_updated: boolean;
  generation_id: string | null;
  registration_sequence: number;
  active_yj_codes: string[];
  replaced_yj_codes: string[];
  deleted_version_ids: string[];
  cleanup_pending: CleanupPendingItem[];
  artifacts_deleted: boolean;
}

export interface ImportSummary {
  document_id: string;
  source_sha256: string;
  filename: string | null;
  registration_sequence: number;
  revised_at: string;
  products: ImportedProduct[];
  active_yj_codes: string[];
  artifacts_deleted: boolean;
}

export interface PackageInsertImportPage {
  items: ImportSummary[];
  total_count: number;
  limit: number;
  offset: number;
}

export interface RegisteredMedicineMatch {
  generic_name: string;
  brand_names: string[];
  yj_codes: string[];
  document_ids: string[];
}

export interface RegisteredMedicineList {
  items: RegisteredMedicineMatch[];
  generation_id: string;
}

export interface PackageInsertEvidenceSource {
  unit_id: string;
  document_id: string;
  product_name: string;
  generic_name: string;
  product_yj_codes: string[];
  document_revision: {
    source_label?: string | null;
    year_month?: string | null;
    version?: string | null;
  };
  section: {
    code: string;
    title: string;
  };
  kind: string;
  excerpt: string;
  columns?: Record<string, string> | null;
  references: Array<Record<string, unknown>>;
  url: string;
  retrieved_by: string[];
}

export interface PackageInsertSearchResponse {
  query: string;
  items: PackageInsertEvidenceSource[];
  total_count: number;
  expanded_keywords: string[];
}
