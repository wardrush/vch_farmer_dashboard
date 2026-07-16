import type {
  EnrollmentsPayload,
  OpIndexRow,
  OpProfile,
  ProjectSummary,
  QaJson,
  StatusEvent,
  StratJson,
} from "../types";

// Matches functions/status.ts / functions/enrollments.ts — demo-grade only,
// same posture as the PasswordGate (docs/ARCHITECTURE.md admin auth note).
const ADMIN_HEADER = { "X-VCH-Admin": "vch-admin-demo" };

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const getOpsIndex = () => fetchJson<OpIndexRow[]>("/data/ops/index.json");
export const getOpProfile = (opCode: string) => fetchJson<OpProfile>(`/data/ops/${opCode}/profile.json`);
export const getOpFieldsGeoJson = (opCode: string) => fetchJson<GeoJSON.FeatureCollection>(`/data/ops/${opCode}/fields.web.geojson`);
export const getOpEnrollments = (opCode: string) => fetchJson<EnrollmentsPayload>(`/data/ops/${opCode}/enrollments.json`);
export const getOpStrat = (opCode: string) => fetchJson<StratJson>(`/data/analyst/ops/${opCode}/strat.json`);
export const getOpSamplesGeoJson = (opCode: string) => fetchJson<GeoJSON.FeatureCollection>(`/data/analyst/ops/${opCode}/samples.geojson`);
export const getProjectSummary = () => fetchJson<ProjectSummary>("/data/analyst/project/summary.json");
export const getFieldsStatusGeoJson = () => fetchJson<GeoJSON.FeatureCollection>("/data/analyst/fields-status.web.geojson");
export const getQa = () => fetchJson<QaJson>("/data/analyst/qa.json");

// ---------------------------------------------------------------------------
// Live status (docs/ARCHITECTURE.md): GET /api/status, POST /api/status/advance,
// POST /api/status/undo, backed by Netlify Blobs in production. Falls back to
// the baked status-seed.json when the API is unreachable (static preview /
// local `vite dev` without `netlify dev`). Local-dev-only extension: writes
// (advance/undo) fall back to a localStorage overlay merged on top of the
// seed, so the admin -> farmer live-update flow is testable without running
// `netlify dev`. This overlay is not part of the production data path.
// ---------------------------------------------------------------------------

const LOCAL_OVERLAY_KEY = "vch_demo_status_overlay_v1";

function readOverlay(): StatusEvent[] {
  try {
    const raw = localStorage.getItem(LOCAL_OVERLAY_KEY);
    return raw ? (JSON.parse(raw) as StatusEvent[]) : [];
  } catch {
    return [];
  }
}

function writeOverlay(events: StatusEvent[]) {
  localStorage.setItem(LOCAL_OVERLAY_KEY, JSON.stringify(events));
}

export async function getStatusEvents(): Promise<StatusEvent[]> {
  try {
    const res = await fetch("/api/status");
    if (res.ok) {
      const data = (await res.json()) as { events: StatusEvent[] };
      return data.events;
    }
  } catch {
    // fall through to static seed
  }
  const seed = await fetchJson<{ events: StatusEvent[] }>("/data/status-seed.json");
  return [...seed.events, ...readOverlay()];
}

export async function advanceStatus(
  targets: Array<{ opCode: string; projectYearId: string }>,
  stage: string,
  note: string,
  by: string,
): Promise<void> {
  try {
    const res = await fetch("/api/status/advance", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ADMIN_HEADER },
      body: JSON.stringify({ op_codes: targets.map((t) => t.opCode), stage, note, by }),
    });
    if (res.ok) return;
  } catch {
    // fall through to local overlay
  }
  const overlay = readOverlay();
  const now = new Date().toISOString().slice(0, 10);
  for (const { opCode, projectYearId } of targets) {
    overlay.push({
      op_code: opCode,
      project_year_id: projectYearId,
      stage: stage as StatusEvent["stage"],
      entered_at: now,
      by,
      note,
      demo_fabricated: true,
    });
  }
  writeOverlay(overlay);
}

export async function undoStatus(opCode: string, projectYearId: string, toStage: string, by: string): Promise<void> {
  try {
    const res = await fetch("/api/status/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ADMIN_HEADER },
      body: JSON.stringify({ op_code: opCode, by }),
    });
    if (res.ok) return;
  } catch {
    // fall through to local overlay
  }
  const overlay = readOverlay();
  const now = new Date().toISOString().slice(0, 10);
  overlay.push({
    op_code: opCode,
    project_year_id: projectYearId,
    stage: toStage as StatusEvent["stage"],
    entered_at: now,
    by,
    note: "Correction (one step back)",
    demo_fabricated: true,
  });
  writeOverlay(overlay);
}

// ---------------------------------------------------------------------------
// Live enrollments (docs/ARCHITECTURE.md): GET/PUT /api/enrollments/:id.
// Same static-seed + localStorage-overlay fallback pattern as status.
// ---------------------------------------------------------------------------

const ENROLLMENT_OVERLAY_KEY = "vch_demo_enrollments_overlay_v1";

interface EnrollmentDocEdit {
  enrollment_id: string;
  docs_received: string[];
  docs_needed: string[];
  note?: string;
}

function readEnrollmentOverlay(): Record<string, EnrollmentDocEdit> {
  try {
    const raw = localStorage.getItem(ENROLLMENT_OVERLAY_KEY);
    return raw ? (JSON.parse(raw) as Record<string, EnrollmentDocEdit>) : {};
  } catch {
    return {};
  }
}

export function getEnrollmentOverlay(enrollmentId: string): EnrollmentDocEdit | null {
  return readEnrollmentOverlay()[enrollmentId] ?? null;
}

export async function updateEnrollmentDocs(edit: EnrollmentDocEdit): Promise<void> {
  try {
    const res = await fetch(`/api/enrollments/${edit.enrollment_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...ADMIN_HEADER },
      body: JSON.stringify(edit),
    });
    if (res.ok) return;
  } catch {
    // fall through to local overlay
  }
  const overlay = readEnrollmentOverlay();
  overlay[edit.enrollment_id] = edit;
  localStorage.setItem(ENROLLMENT_OVERLAY_KEY, JSON.stringify(overlay));
}
