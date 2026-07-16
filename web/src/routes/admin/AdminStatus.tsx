import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Header } from "../../components/Header";
import { DataGrid } from "../../components/DataGrid";
import { FilterChips } from "../../components/FilterChips";
import { advanceStatus, getOpsIndex, getStatusEvents, undoStatus } from "../../lib/api";
import { STAGE_INDEX, nextForwardStages } from "../../lib/status";
import { MICRO_STAGES, MICRO_STAGE_LABEL, type MicroStage } from "../../content/stageCopy";
import { formatAcres, formatDate } from "../../lib/format";
import type { OpIndexRow, StatusEvent } from "../../types";

interface Row extends OpIndexRow {
  current_project_year_id: string;
  last_change_at: string;
  last_change_by: string;
}

function currentProjectYearId(events: StatusEvent[], opCode: string): string | null {
  const currentEvents = events.filter((e) => e.op_code === opCode && e.project_year_id.startsWith("P3-2025"));
  if (currentEvents.length === 0) return null;
  return currentEvents[0].project_year_id;
}

export function AdminStatus() {
  const [ops, setOps] = useState<OpIndexRow[] | null>(null);
  const [events, setEvents] = useState<StatusEvent[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quickFilter, setQuickFilter] = useState<string>("all");
  const [targetStage, setTargetStage] = useState<MicroStage | "">("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [opsRows, evs] = await Promise.all([getOpsIndex(), getStatusEvents()]);
    setOps(opsRows);
    setEvents(evs);
  }

  useEffect(() => {
    refresh();
  }, []);

  const rows: Row[] = useMemo(() => {
    if (!ops) return [];
    return ops.map((o) => {
      const pyid = currentProjectYearId(events, o.op_code);
      const opEvents = pyid ? events.filter((e) => e.op_code === o.op_code && e.project_year_id === pyid) : [];
      opEvents.sort((a, b) => STAGE_INDEX[a.stage] - STAGE_INDEX[b.stage] || a.entered_at.localeCompare(b.entered_at));
      const latest = opEvents[opEvents.length - 1];
      return {
        ...o,
        micro_stage: latest ? latest.stage : o.micro_stage,
        current_project_year_id: pyid ?? "—",
        last_change_at: latest?.entered_at ?? "—",
        last_change_by: latest?.by ?? "—",
      };
    });
  }, [ops, events]);

  const filtered = useMemo(() => {
    if (quickFilter === "all") return rows;
    if (quickFilter.startsWith("region:")) return rows.filter((r) => r.region === quickFilter.slice(7));
    if (quickFilter.startsWith("year:")) return rows.filter((r) => r.grower_since?.startsWith(quickFilter.slice(5)));
    return rows.filter((r) => r.micro_stage === quickFilter);
  }, [rows, quickFilter]);

  const selectedRows = rows.filter((r) => selected.has(r.op_code));
  const commonNextStages = useMemo(() => {
    if (selectedRows.length === 0) return [];
    const perOp = selectedRows.map((r) => new Set(nextForwardStages(r.micro_stage)));
    return MICRO_STAGES.filter((s) => perOp.every((set) => set.has(s)));
  }, [selectedRows]);

  const skippingOps = useMemo(() => {
    if (!targetStage) return [];
    return selectedRows.filter((r) => {
      const distance = STAGE_INDEX[targetStage] - STAGE_INDEX[r.micro_stage];
      return distance > 1;
    });
  }, [selectedRows, targetStage]);

  const columns: ColumnDef<Row, any>[] = [
    { header: "Op", accessorKey: "op_code" },
    { header: "Label", accessorKey: "op_label" },
    { header: "Enrolled", accessorKey: "grower_since" },
    { header: "State", accessorKey: "state" },
    { header: "Acres", accessorKey: "acres", cell: (i) => formatAcres(i.getValue() as number) },
    { header: "Fields", accessorKey: "n_fields" },
    { header: "Region", accessorKey: "region" },
    {
      header: "Stage",
      accessorKey: "micro_stage",
      cell: (i) => (
        <span className="rounded-full border border-gold-700 px-2 py-0.5 text-xs font-semibold text-gold-800">
          {MICRO_STAGE_LABEL[i.getValue() as MicroStage]}
        </span>
      ),
    },
    {
      header: "Last change",
      accessorKey: "last_change_at",
      cell: (i) => (
        <span className="text-xs text-sand-600">
          {formatDate(i.getValue() as string)} · {i.row.original.last_change_by}
        </span>
      ),
    },
    {
      header: "",
      id: "undo",
      cell: (i) => {
        const row = i.row.original;
        const idx = MICRO_STAGES.indexOf(row.micro_stage);
        if (idx <= 0) return null;
        const prevStage = MICRO_STAGES[idx - 1];
        return (
          <button
            className="text-xs font-semibold text-sand-600 hover:text-rust"
            onClick={async (e) => {
              e.stopPropagation();
              await undoStatus(row.op_code, row.current_project_year_id, prevStage, "katie");
              refresh();
            }}
          >
            Undo → {MICRO_STAGE_LABEL[prevStage]}
          </button>
        );
      },
    },
  ];

  async function confirmAdvance() {
    if (!targetStage) return;
    setBusy(true);
    await advanceStatus(
      selectedRows.map((r) => ({ opCode: r.op_code, projectYearId: r.current_project_year_id })),
      targetStage,
      note,
      "katie",
    );
    setBusy(false);
    setConfirming(false);
    setTargetStage("");
    setNote("");
    setSelected(new Set());
    refresh();
  }

  return (
    <div>
      <Header section="Admin" />
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <h1 className="text-3xl">Grower status</h1>
        <p className="text-sm text-sand-600">
          Status changes are human-confirmed milestones — no automation, no timers. Every change is an event; nothing
          is overwritten.
        </p>

        <FilterChips
          options={[
            { value: "all", label: "All" },
            { value: "region:ND_E", label: "ND East" },
            { value: "region:ND_W", label: "ND West" },
            { value: "region:MN", label: "MN" },
            { value: "year:2024", label: "2024" },
            { value: "year:2025", label: "2025" },
            ...MICRO_STAGES.map((s) => ({ value: s, label: MICRO_STAGE_LABEL[s] })),
          ]}
          value={quickFilter}
          onChange={setQuickFilter}
        />

        {ops ? (
          <DataGrid data={filtered} columns={columns} getRowId={(r) => r.op_code} selectable selectedIds={selected} onSelectionChange={setSelected} />
        ) : (
          <p className="text-sand-600">Loading…</p>
        )}

        {selectedRows.length > 0 && (
          <div className="sticky bottom-4 rounded-2xl border border-gold-700 bg-white p-4 shadow-lg">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">Advance {selectedRows.length} grower{selectedRows.length > 1 ? "s" : ""} to →</span>
              <select className="vch-input" value={targetStage} onChange={(e) => setTargetStage(e.target.value as MicroStage)}>
                <option value="">Select stage…</option>
                {commonNextStages.map((s) => (
                  <option key={s} value={s}>{MICRO_STAGE_LABEL[s]}</option>
                ))}
              </select>
              <input className="vch-input flex-1" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="vch-btn-primary" disabled={!targetStage} onClick={() => setConfirming(true)}>
                Advance
              </button>
            </div>
            {commonNextStages.length === 0 && (
              <p className="mt-2 text-xs text-rust">Selected growers have no common next stage — narrow your selection.</p>
            )}
          </div>
        )}

        {confirming && targetStage && (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-6">
            <div className="vch-card w-full max-w-lg">
              <h2 className="text-lg">Confirm advance</h2>
              <p className="text-sm text-sand-700">
                Advancing <strong>{selectedRows.length}</strong> grower{selectedRows.length > 1 ? "s" : ""} to{" "}
                <strong>{MICRO_STAGE_LABEL[targetStage]}</strong>.
              </p>
              {skippingOps.length > 0 && (
                <div className="vch-callout text-xs">
                  {skippingOps.length} op{skippingOps.length > 1 ? "s" : ""} will skip one or more stages:{" "}
                  {skippingOps.map((o) => o.op_label).join(", ")}
                </div>
              )}
              <ul className="max-h-48 overflow-auto rounded-xl border border-sand-200 p-2 text-sm">
                {selectedRows.map((r) => (
                  <li key={r.op_code} className="flex justify-between py-0.5">
                    <span>{r.op_label}</span>
                    <span className="text-sand-500">{MICRO_STAGE_LABEL[r.micro_stage]} → {MICRO_STAGE_LABEL[targetStage]}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-3">
                <button className="vch-btn-secondary" onClick={() => setConfirming(false)}>Cancel</button>
                <button className="vch-btn-primary" disabled={busy} onClick={confirmAdvance}>
                  {busy ? "Advancing…" : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
