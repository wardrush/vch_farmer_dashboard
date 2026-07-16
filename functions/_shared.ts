// Shared between status.ts and enrollments.ts. Mirrors docs/STATUS_MODEL.md
// and docs/FIELD_MAPPING.md — this is the ONE other place (besides the
// Python pipeline and the frontend's content/stageCopy.ts) that knows the
// micro-stage order, because status advance/undo needs it server-side too.
import { getStore } from "@netlify/blobs";

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

export const STAGE_INDEX: Record<string, number> = Object.fromEntries(
  MICRO_STAGES.map((s, i) => [s, i + 1]),
);

export interface StatusEvent {
  op_code: string;
  project_year_id: string;
  stage: string;
  entered_at: string;
  by: string;
  note: string;
  demo_fabricated: boolean;
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
  submitted_at: string | null;
  docs_received: string[];
  docs_needed: string[];
  demo_fabricated: boolean;
}

const STATUS_STORE = "vch-status";
const STATUS_KEY = "status/events.json";
const ENROLLMENTS_STORE = "vch-enrollments";
const ENROLLMENTS_KEY = "enrollments/records.json";

function siteOrigin(): string {
  // Netlify sets URL/DEPLOY_URL in the function's environment.
  return process.env.URL || process.env.DEPLOY_URL || "http://localhost:8888";
}

export async function loadStatusEvents(): Promise<StatusEvent[]> {
  const store = getStore(STATUS_STORE);
  const existing = await store.get(STATUS_KEY, { type: "json" });
  if (existing) return (existing as { events: StatusEvent[] }).events;

  const res = await fetch(new URL("/data/status-seed.json", siteOrigin()));
  const seed = (await res.json()) as { events: StatusEvent[] };
  await store.setJSON(STATUS_KEY, { events: seed.events });
  return seed.events;
}

export async function saveStatusEvents(events: StatusEvent[]): Promise<void> {
  await getStore(STATUS_STORE).setJSON(STATUS_KEY, { events });
}

export async function loadEnrollments(): Promise<EnrollmentRecord[]> {
  const store = getStore(ENROLLMENTS_STORE);
  const existing = await store.get(ENROLLMENTS_KEY, { type: "json" });
  if (existing) return existing as EnrollmentRecord[];

  const res = await fetch(new URL("/data/admin/enrollments-all.json", siteOrigin()));
  const seed = (await res.json()) as EnrollmentRecord[];
  await store.setJSON(ENROLLMENTS_KEY, seed);
  return seed;
}

export async function saveEnrollments(records: EnrollmentRecord[]): Promise<void> {
  await getStore(ENROLLMENTS_STORE).setJSON(ENROLLMENTS_KEY, records);
}

export function currentProjectYearId(events: StatusEvent[], opCode: string): string | null {
  const matches = events.filter((e) => e.op_code === opCode && e.project_year_id.startsWith("P3-2025"));
  if (matches.length === 0) return null;
  return matches[0].project_year_id;
}

export function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
