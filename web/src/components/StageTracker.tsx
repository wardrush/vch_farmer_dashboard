interface StageTrackerProps {
  stageIds: string[];
  labels: Record<string, string>;
  currentStage: string;
  size?: "macro" | "micro";
  carriedFromBaseline?: Set<string>;
  onSelect?: (stageId: string) => void;
  selectedStage?: string | null;
}

export function StageTracker({
  stageIds,
  labels,
  currentStage,
  size = "micro",
  carriedFromBaseline,
  onSelect,
  selectedStage,
}: StageTrackerProps) {
  const currentIdx = stageIds.indexOf(currentStage);

  return (
    <div className="flex snap-x gap-2 overflow-x-auto pb-1" role="list" aria-label={size === "macro" ? "Project macro status" : "Project detail status"}>
      {stageIds.map((id, i) => {
        const isCompleted = i < currentIdx;
        const isCurrent = i === currentIdx;
        const isCarried = carriedFromBaseline?.has(id) && isCompleted;
        const isSelected = selectedStage === id;
        const clickable = Boolean(onSelect);

        const base = "snap-start whitespace-nowrap rounded-xl border px-4 py-3 text-sm font-semibold transition";
        const variant = isCurrent
          ? "border-gold-700 bg-gold-700 text-white pill-pulse"
          : isCompleted
            ? "border-gold-700 text-gold-800 bg-white"
            : "border-sand-300 text-sand-500 bg-white/60";
        const selectedRing = isSelected ? "ring-2 ring-gold-700 ring-offset-2 ring-offset-sand-50" : "";

        return (
          <button
            key={id}
            type="button"
            role="listitem"
            disabled={!clickable}
            onClick={() => onSelect?.(id)}
            className={`${base} ${variant} ${selectedRing} ${clickable ? "cursor-pointer" : "cursor-default"}`}
            title={isCarried ? "Completed (carried from baseline)" : undefined}
          >
            <span
              className={`mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                isCurrent ? "bg-white/20" : isCompleted ? "bg-gold-700 text-white" : "bg-black/10"
              }`}
            >
              {isCompleted ? "✓" : i + 1}
            </span>
            {labels[id] ?? id}
            {isCarried && <span className="ml-2 text-[10px] font-normal opacity-75">(carried from baseline)</span>}
          </button>
        );
      })}
    </div>
  );
}
