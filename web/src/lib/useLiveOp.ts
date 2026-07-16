import { useEffect, useState } from "react";
import { getOpProfile, getStatusEvents } from "./api";
import { currentMicroStage, deriveMacroStage, STAGE_INDEX } from "./status";
import type { OpProfile, StatusEvent } from "../types";

/** Merges the baked profile.json with live status events (docs/ARCHITECTURE.md
 * R25) so admin advances are reflected on reload without a redeploy — the
 * whole reason status lives in Netlify Blobs instead of only baked JSON. */
function mergeLiveStatus(base: OpProfile, events: StatusEvent[]): OpProfile {
  const projects = base.projects.map((p) => {
    const live = currentMicroStage(events, base.op_code, p.project_year_id);
    return live ? { ...p, micro_stage: live } : p;
  });
  const current = projects.find((p) => p.project_year_id === base.current_project_year_id) ?? projects[projects.length - 1];
  const y1 = projects.find((p) => p.year_index === 1);
  const y2 = projects.find((p) => p.year_index === 2);
  const macro = y1 ? deriveMacroStage(y1.micro_stage, y2?.micro_stage ?? null) : base.macro_stage;

  return {
    ...base,
    projects,
    current_micro_stage: current.micro_stage,
    macro_stage: macro,
  };
}

export function useLiveOp(opCode: string | undefined) {
  const [profile, setProfile] = useState<OpProfile | null>(null);
  const [events, setEvents] = useState<StatusEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!opCode) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    Promise.all([getOpProfile(opCode), getStatusEvents()])
      .then(([base, evs]) => {
        if (cancelled) return;
        setEvents(evs);
        setProfile(mergeLiveStatus(base, evs));
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [opCode, reloadToken]);

  const reload = () => setReloadToken((t) => t + 1);

  return { profile, events, loading, error, reload };
}

export function creditsSubmitted(microStage: string): boolean {
  return STAGE_INDEX[microStage as keyof typeof STAGE_INDEX] >= STAGE_INDEX.project_submitted;
}
