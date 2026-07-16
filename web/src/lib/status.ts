import { MICRO_STAGES, type MicroStage, type MacroStage } from "../content/stageCopy";
import type { StatusEvent } from "../types";

export const STAGE_INDEX: Record<MicroStage, number> = Object.fromEntries(
  MICRO_STAGES.map((s, i) => [s, i + 1]),
) as Record<MicroStage, number>;

/** Current status = event with highest stage # (ties -> latest entered_at),
 * per (op_code, project_year_id) — docs/STATUS_MODEL.md. */
export function currentMicroStage(events: StatusEvent[], opCode: string, projectYearId: string): MicroStage | null {
  const matches = events.filter((e) => e.op_code === opCode && e.project_year_id === projectYearId);
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const diff = STAGE_INDEX[a.stage] - STAGE_INDEX[b.stage];
    if (diff !== 0) return diff;
    return a.entered_at.localeCompare(b.entered_at);
  });
  return matches[matches.length - 1].stage;
}

export function deriveMacroStage(y1Micro: MicroStage, y2Micro: MicroStage | null): MacroStage {
  if (y2Micro && STAGE_INDEX[y2Micro] >= STAGE_INDEX.credits_available) return "year2_completed";
  if (STAGE_INDEX[y1Micro] >= STAGE_INDEX.credits_available) return "year1_completed";
  if (STAGE_INDEX[y1Micro] >= STAGE_INDEX.baseline_sampling_completed) return "baseline_gathered";
  return "enrollment_submitted";
}

export function nextForwardStages(currentStage: MicroStage): MicroStage[] {
  const idx = STAGE_INDEX[currentStage];
  return MICRO_STAGES.filter((s) => STAGE_INDEX[s] > idx);
}
