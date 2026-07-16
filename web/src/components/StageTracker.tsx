import { useState } from "react";

interface StageTrackerProps {
  stageIds: string[];
  /** Short labels shown under each node. */
  labels: Record<string, string>;
  /** Full labels for the tooltip + caption (falls back to `labels`). */
  fullLabels?: Record<string, string>;
  currentStage: string;
  size?: "macro" | "micro";
  carriedFromBaseline?: Set<string>;
  onSelect?: (stageId: string) => void;
  selectedStage?: string | null;
  /** Optional per-stage ISO dates, shown in the hover tooltip + caption. */
  dates?: Record<string, string>;
  /** Optional per-stage plain-language sentence, shown in the hover tooltip. */
  copy?: Record<string, string>;
  /** Show the "Now / Completed / Up next" caption under the bar (default true). */
  showCaption?: boolean;
}

function fmtDate(s?: string): string | null {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Connected segmented progress bar (replaces the old row of discrete pills).
 * One continuous track — gold fill up to the current checkpoint, muted sand
 * ahead — with checkpoint nodes and a hover tooltip carrying the full stage
 * name, date, and plain-language copy. Reads at a glance; detail on hover.
 */
export function StageTracker({
  stageIds,
  labels,
  fullLabels,
  currentStage,
  size = "micro",
  carriedFromBaseline,
  onSelect,
  selectedStage,
  dates,
  copy,
  showCaption = true,
}: StageTrackerProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const full = fullLabels ?? labels;
  const n = stageIds.length;
  const rawIdx = stageIds.indexOf(currentStage);
  const currentIdx = rawIdx < 0 ? 0 : rawIdx;
  const clickable = Boolean(onSelect);

  const isMacro = size === "macro";
  const node = isMacro ? 30 : 24; // node diameter (px)
  const half = node / 2;
  const barH = isMacro ? 7 : 6;
  const fillPct = n > 1 ? currentIdx / (n - 1) : 0;

  const tip = hovered != null ? stageIds[hovered] : null;

  return (
    <div
      className="relative w-full pt-1"
      role="list"
      aria-label={isMacro ? "Project macro status" : "Project detail status"}
    >
      {/* Track + fill */}
      <div className="relative" style={{ height: node }}>
        <div
          className="absolute rounded-full bg-sand-300"
          style={{ left: half, right: half, top: `calc(50% - ${barH / 2}px)`, height: barH }}
        />
        <div
          className="absolute rounded-full bg-gold-700 transition-all duration-500"
          style={{
            left: half,
            top: `calc(50% - ${barH / 2}px)`,
            height: barH,
            width: `calc((100% - ${node}px) * ${fillPct})`,
          }}
        />

        {/* Nodes */}
        <div className="absolute inset-0 flex items-center justify-between">
          {stageIds.map((id, i) => {
            const isCompleted = i < currentIdx;
            const isCurrent = i === currentIdx;
            const isCarried = Boolean(carriedFromBaseline?.has(id)) && isCompleted;
            const isSelected = selectedStage === id;

            const nodeColor = isCurrent
              ? "bg-gold-400 text-white border-gold-400"
              : isCompleted
                ? "bg-gold-700 text-white border-gold-700"
                : "bg-white text-sand-500 border-sand-300";
            const ring = isSelected ? "ring-2 ring-gold-700 ring-offset-2 ring-offset-white" : "";

            return (
              <button
                key={id}
                type="button"
                role="listitem"
                aria-current={isCurrent ? "step" : undefined}
                aria-label={full[id] ?? id}
                disabled={!clickable}
                onClick={() => onSelect?.(id)}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered((h) => (h === i ? null : h))}
                className={`relative z-10 flex items-center justify-center rounded-full border-2 font-semibold transition ${nodeColor} ${ring} ${
                  isCurrent ? "pill-pulse" : ""
                } ${clickable ? "cursor-pointer hover:scale-110" : "cursor-default"}`}
                style={{ width: node, height: node, fontSize: isMacro ? 12 : 10 }}
              >
                {isCompleted ? (isCarried ? "↩" : "✓") : i + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mini labels under each node */}
      <div className="mt-1.5 flex items-start justify-between gap-1">
        {stageIds.map((id, i) => {
          const isCurrent = i === currentIdx;
          const isCompleted = i < currentIdx;
          return (
            <div
              key={id}
              className={`text-center leading-tight ${isMacro ? "text-[11px]" : "text-[9px]"} ${
                isCurrent
                  ? "font-bold text-sand-950"
                  : isCompleted
                    ? "font-medium text-gold-800"
                    : "text-sand-500"
              }`}
              style={{ width: `${100 / n}%` }}
            >
              {labels[id] ?? id}
            </div>
          );
        })}
      </div>

      {/* Hover tooltip */}
      {tip && (
        <div
          className="pointer-events-none absolute z-30 w-60 -translate-x-1/2 rounded-2xl border border-sand-300 bg-white p-3 text-left shadow-lg"
          style={{
            left: `calc(${half}px + (100% - ${node}px) * ${n > 1 ? hovered! / (n - 1) : 0})`,
            bottom: `calc(100% - ${node}px + 12px)`,
          }}
        >
          <div className="text-sm font-bold text-sand-950">{full[tip] ?? tip}</div>
          {fmtDate(dates?.[tip]) && (
            <div className="mt-0.5 text-xs font-semibold text-gold-800">{fmtDate(dates?.[tip])}</div>
          )}
          {carriedFromBaseline?.has(tip) && hovered! < currentIdx && (
            <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-sand-500">
              Completed · carried from baseline
            </div>
          )}
          {copy?.[tip] && <div className="mt-1 text-xs text-sand-700">{copy[tip]}</div>}
        </div>
      )}

      {/* Glance-level caption */}
      {showCaption && (
        <p className={`mt-2 ${isMacro ? "text-sm" : "text-xs"} text-sand-700`}>
          <span className="font-semibold text-sand-950">{full[currentStage] ?? currentStage}</span>
          {fmtDate(dates?.[currentStage]) && <span className="text-sand-500"> · {fmtDate(dates?.[currentStage])}</span>}
          <span className="text-sand-500">
            {" "}
            · step {currentIdx + 1} of {n}
          </span>
        </p>
      )}
    </div>
  );
}
