// docs/ARCHITECTURE.md: GET/PUT /api/enrollments/:id for docs_received/
// docs_needed edits — the farmer's "still needed" list updates live from
// this. Backed by Netlify Blobs; first read seeds from admin/enrollments-all.json.
import type { Handler } from "@netlify/functions";
import { jsonResponse, loadEnrollments, saveEnrollments } from "./_shared";

const ADMIN_HEADER_SECRET = "vch-admin-demo";

function isAuthorized(headers: Record<string, string | undefined>): boolean {
  return headers["x-vch-admin"] === ADMIN_HEADER_SECRET;
}

export const handler: Handler = async (event) => {
  const id = event.path.split("/").filter(Boolean).pop();

  if (event.httpMethod === "GET") {
    const all = await loadEnrollments();
    if (id && id !== "enrollments") {
      const one = all.find((e) => e.enrollment_id === id);
      return one ? jsonResponse(200, one) : jsonResponse(404, { error: "Not found" });
    }
    return jsonResponse(200, all);
  }

  if (event.httpMethod === "PUT") {
    if (!isAuthorized(event.headers as Record<string, string | undefined>)) {
      return jsonResponse(401, { error: "Missing or invalid X-VCH-Admin header (demo-grade check)." });
    }
    if (!id) return jsonResponse(400, { error: "Missing enrollment id" });
    const body = JSON.parse(event.body || "{}");
    const all = await loadEnrollments();
    const idx = all.findIndex((e) => e.enrollment_id === id);
    if (idx === -1) return jsonResponse(404, { error: "Not found" });
    all[idx] = {
      ...all[idx],
      docs_received: body.docs_received ?? all[idx].docs_received,
      docs_needed: body.docs_needed ?? all[idx].docs_needed,
    };
    await saveEnrollments(all);
    return jsonResponse(200, all[idx]);
  }

  return jsonResponse(404, { error: "Not found" });
};
