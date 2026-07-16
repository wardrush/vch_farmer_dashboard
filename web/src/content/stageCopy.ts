// docs/STATUS_MODEL.md — the farmer-facing copy table. Plain language, no
// unexplained jargon, reassuring but concrete.

export const MICRO_STAGES = [
  "enrollment_began",
  "all_files_submitted",
  "maps_approved",
  "baseline_samples_requested",
  "baseline_sampling_completed",
  "post_season_sampling_completed",
  "lab_data_received",
  "project_submitted",
  "project_validated",
  "credits_available",
] as const;

export type MicroStage = (typeof MICRO_STAGES)[number];

export const MACRO_STAGES = [
  "enrollment_submitted",
  "baseline_gathered",
  "year1_completed",
  "year2_completed",
  "trueup_completed",
] as const;

export type MacroStage = (typeof MACRO_STAGES)[number];

export const MICRO_STAGE_LABEL: Record<MicroStage, string> = {
  enrollment_began: "Enrollment began",
  all_files_submitted: "All files submitted",
  maps_approved: "Maps approved",
  baseline_samples_requested: "Baseline samples requested",
  baseline_sampling_completed: "Baseline sampling completed",
  post_season_sampling_completed: "Post-growing-season sampling completed",
  lab_data_received: "Data received from lab",
  project_submitted: "Project submitted",
  project_validated: "Project validated",
  credits_available: "Credits available",
};

export const MICRO_STAGE_COPY: Record<MicroStage, string> = {
  enrollment_began:
    "You're enrolled. Next, we'll collect your paperwork and get your fields on the map.",
  all_files_submitted:
    "We've received your enrollment paperwork. Next, our team will confirm your field maps.",
  maps_approved:
    "Your field boundaries are confirmed. Next, we'll schedule your baseline soil samples.",
  baseline_samples_requested:
    "Baseline soil sampling has been requested for your fields. Our sampling crew will be in touch to schedule a visit.",
  baseline_sampling_completed:
    "Baseline soil sampling is complete. This gives us the starting point we'll measure your soil's progress against.",
  post_season_sampling_completed:
    "End-of-season soil sampling is complete. Your samples are on their way to the lab.",
  lab_data_received:
    "Your soil samples have been analyzed. We're finishing the paperwork to submit your project.",
  project_submitted:
    "Your project has been submitted to BCarbon, the independent validator. We'll update this as soon as validation completes.",
  project_validated:
    "Your project has been independently validated. Credits are being finalized next.",
  credits_available:
    "Your credits for this cycle are available. See the estimated total below.",
};

export const MACRO_STAGE_LABEL: Record<MacroStage, string> = {
  enrollment_submitted: "Enrollment submitted",
  baseline_gathered: "Baseline gathered",
  year1_completed: "Year 1 project completed",
  year2_completed: "Year 2 project completed",
  trueup_completed: "True-up completed",
};

export const CREDITS_CAP_CAVEAT =
  "Measured soil carbon gain is capped at 1 tonne per acre per year for interim crediting under the BCarbon Soil Protocol. The number above reflects that cap — final amounts settle at true-up.";
