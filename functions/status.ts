// docs/ARCHITECTURE.md + docs/STATUS_MODEL.md:
//   GET  /api/status                -> full event log
//   POST /api/status/advance        {op_codes[], stage, note, by} -> one event per op
//   POST /api/status/undo           {op_code, by} -> one corrective event, one stage back
// Backed by Netlify Blobs; first read seeds from the baked status-seed.json.
// Demo-grade admin auth: a shared password checked client-side (PasswordGate)
// plus a header here — not real authorization, documented as such.
import type { Handler } from "@netlify/functions";
import { currentProjectYearId, jsonResponse, loadStatusEvents, saveStatusEvents, STAGE_INDEX, type StatusEvent } from "./_shared";

const ADMIN_HEADER_SECRET = "vch-admin-demo";

function isAuthorized(headers: Record<string, string | undefined>): boolean {
  return headers["x-vch-admin"] === ADMIN_HEADER_SECRET;
}

export const handler: Handler = async (event) => {
  const path = event.path.replace(/\/+$/, "");
  const isAdvance = path.endsWith("/advance");
  const isUndo = path.endsWith("/undo");

  if (event.httpMethod === "GET" && !isAdvance && !isUndo) {
    const events = await loadStatusEvents();
    return jsonResponse(200, { events });
  }

  if (event.httpMethod === "POST" && (isAdvance || isUndo)) {
    if (!isAuthorized(event.headers as Record<string, string | undefined>)) {
      return jsonResponse(401, { error: "Missing or invalid X-VCH-Admin header (demo-grade check)." });
    }
    const body = JSON.parse(event.body || "{}");
    const events = await loadStatusEvents();
    const now = new Date().toISOString().slice(0, 10);
    const by = body.by || "katie";

    if (isAdvance) {
      const opCodes: string[] = body.op_codes || [];
      const stage: string = body.stage;
      if (!stage || !(stage in STAGE_INDEX)) return jsonResponse(400, { error: `Unknown stage: ${stage}` });
      const newEvents: StatusEvent[] = opCodes.map((opCode) => ({
        op_code: opCode,
        project_year_id: currentProjectYearId(events, opCode) ?? "P3-2025-Y1",
        stage,
        entered_at: now,
        by,
        note: body.note || "",
        demo_fabricated: true,
      }));
      await saveStatusEvents([...events, ...newEvents]);
      return jsonResponse(200, { ok: true, events_added: newEvents.length });
    }

    // undo: one step back correction, event-sourced (never deletes)
    const opCode: string = body.op_code;
    const pyid = currentProjectYearId(events, opCode);
    if (!pyid) return jsonResponse(400, { error: `No current project-year for ${opCode}` });
    const opEvents = events
      .filter((e) => e.op_code === opCode && e.project_year_id === pyid)
      .sort((a, b) => STAGE_INDEX[a.stage] - STAGE_INDEX[b.stage] || a.entered_at.localeCompare(b.entered_at));
    const current = opEvents[opEvents.length - 1];
    if (!current) return jsonResponse(400, { error: `No status history for ${opCode}` });
    const currentIdx = STAGE_INDEX[current.stage];
    if (currentIdx <= 1) return jsonResponse(400, { error: "Already at the first stage." });
    const prevStage = Object.keys(STAGE_INDEX).find((s) => STAGE_INDEX[s] === currentIdx - 1)!;
    const correction: StatusEvent = {
      op_code: opCode,
      project_year_id: pyid,
      stage: prevStage,
      entered_at: now,
      by,
      note: "Correction (one step back)",
      demo_fabricated: true,
    };
    await saveStatusEvents([...events, correction]);
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(404, { error: "Not found" });
};
