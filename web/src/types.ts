import type { MacroStage, MicroStage } from "./content/stageCopy";

export interface OpIndexRow {
  op_code: string;
  op_label: string;
  state: string | null;
  region: string | null;
  enroll_origin: string | null;
  acres: number;
  n_fields: number;
  n_samples: number;
  grower_since: string;
  macro_stage: MacroStage;
  micro_stage: MicroStage;
  measured_gain_t: number | null;
  creditable_acres: number | null;
  credited_t: number;
}

export interface ClusterBbox {
  cluster_id: number;
  min_lon: number;
  min_lat: number;
  max_lon: number;
  max_lat: number;
  field_count: number;
  acres: number;
}

export interface Bounds {
  min_lon: number;
  min_lat: number;
  max_lon: number;
  max_lat: number;
}

export interface ProjectYear {
  project_year_id: string;
  year_index: number;
  season_span: string;
  micro_stage: MicroStage;
  acres: number;
  credited_t: number;
  credit_status: "distributed" | "requested" | "not_yet_submitted";
  distributed_usd?: number;
}

export interface OpProfile {
  op_code: string;
  op_label: string;
  entity_name: string;
  grower_since: string;
  macro_stage: MacroStage;
  current_project_year_id: string;
  current_micro_stage: MicroStage;
  projects: ProjectYear[];
  acres_submitted: number;
  n_fields: number;
  submitted_at: string | null;
  true_up_year: number;
  credited_t: number | null;
  credits_distributed_to_date: number | null;
  credits_distributed_t_to_date: number | null;
  cluster_bboxes: ClusterBbox[];
  op_bounds: Bounds | null;
  demo_fabricated_status: boolean;
}

export interface EnrollmentRecord {
  enrollment_id: string;
  op_code: string;
  farmer_name: string;
  entity_name: string;
  distributor: string;
  total_acreage: number;
  billed_acreage: number;
  tote_count: number;
  status: string;
  bill_of_sale_at: string | null;
  submitted_at: string;
  docs_received: string[];
  docs_needed: string[];
  demo_fabricated: boolean;
}

export interface EnrollmentsPayload {
  op_code: string;
  rollup: {
    total_acres: number;
    grower_since: string;
    credits_distributed_usd: number | null;
  };
  enrollments: EnrollmentRecord[];
}

export interface StratumRow {
  texture_class: string;
  n_points_baseline: number | null;
  n_points_monitoring: number | null;
  toc_baseline_mean_pct: number | null;
  toc_monitoring_mean_pct: number | null;
  oc_gain_ppts: number | null;
  oc_gain_lower90_ppts: number | null;
  avg_bulk_density_g_cm3: number | null;
  avg_density_t_acft: number | null;
  gain_t_acft: number | null;
  n_plss_sections: number | null;
  acres: number | null;
  est_gain_t: number | null;
  creditable: boolean | null;
}

export interface StratJson {
  op_code: string;
  n_textures: number;
  total_acres: number;
  creditable_acres: number | null;
  n_fields: number;
  n_samples: number;
  strata: StratumRow[];
}

export interface SamplePointProperties {
  op_code: string;
  period: string;
  sample_role: "baseline" | "monitoring";
  lat: number;
  lon: number;
  trs: string;
  trs_confidence: string;
  state: string;
  region: string;
  texture_class: string | null;
  mukey: number | null;
  has_dc: boolean;
  has_bd: boolean;
  match_completeness: string;
  latlon_source: string;
  point_id: string;
}

export interface StatusEvent {
  op_code: string;
  project_year_id: string;
  stage: MicroStage;
  entered_at: string;
  by: string;
  note: string;
  demo_fabricated: boolean;
}

export interface ProjectSummary {
  table2: {
    total_property_acres: number;
    creditable_acres: number;
    fixture_total_property_acres: number;
    fixture_creditable_acres: number;
    delta_total_pct: number;
    delta_creditable_pct: number;
  };
  table13_official: Array<{
    texture_class: string;
    acres: number;
    avg_density_t_acft: number | null;
    oc_gain_lower90_ppts: number | null;
    gain_t_acft: number | null;
    est_gain_t: number;
    requested_t: number;
    creditable: boolean;
  }>;
  table13_computed_acres: Array<{ texture_class: string; computed_acres: number }>;
  table13_computed_sample_stats: StratumRow[];
  total_credited_t: number;
  total_measured_gain_t: number;
  fixtures: Record<string, number>;
}

export interface QaJson {
  crosswalk_resolution_counts: Record<string, number>;
  unresolved_variants: Array<{ raw_value: string; source: string; row_count: number; best_score: number | null }>;
  n_unmatched_samples: number;
  unmatched_samples_preview: Array<Record<string, unknown>>;
  outlier_counts: {
    spatial: Record<string, number>;
    toc: Record<string, number>;
    bd_flag: Record<string, number>;
  };
  unresolved_enrollments: Array<{ enrollment_id: string; farmer_name: string; entity_name: string }>;
}
