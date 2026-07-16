import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Header } from "../../components/Header";
import { DataGrid } from "../../components/DataGrid";
import { FilterChips } from "../../components/FilterChips";
import { StatCard } from "../../components/StatCard";
import { getOpStrat, getOpsIndex, getProjectSummary } from "../../lib/api";
import { toCsv, downloadText } from "../../lib/csv";
import { formatAcres, formatNumber, formatTonnes } from "../../lib/format";
import type { OpIndexRow, ProjectSummary, StratJson } from "../../types";
import type { ColumnDef } from "@tanstack/react-table";

type QuickFilter = "all" | "ND_E" | "ND_W" | "MN" | "2024" | "2025";

export function AnalystHome() {
  const [ops, setOps] = useState<OpIndexRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [stratCache, setStratCache] = useState<Record<string, StratJson>>({});
  const [aggregating, setAggregating] = useState(false);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);

  useEffect(() => {
    getOpsIndex().then((rows) => {
      setOps(rows);
      setSelected(new Set(rows.map((r) => r.op_code)));
    });
    getProjectSummary().then(setSummary);
  }, []);

  const columns = useMemo<ColumnDef<OpIndexRow, any>[]>(
    () => [
      { header: "Op", accessorKey: "op_code" },
      {
        header: "Label",
        accessorKey: "op_label",
        cell: (info) => (
          <Link to={`/analyst/op/${info.row.original.op_code}`} className="font-semibold text-gold-800 hover:underline">
            {info.getValue() as string}
          </Link>
        ),
      },
      { header: "Region", accessorKey: "region" },
      { header: "State", accessorKey: "state" },
      { header: "Since", accessorKey: "grower_since" },
      { header: "Origin", accessorKey: "enroll_origin" },
      { header: "Acres", accessorKey: "acres", cell: (i) => formatAcres(i.getValue() as number) },
      { header: "Creditable ac", accessorKey: "creditable_acres", cell: (i) => formatAcres(i.getValue() as number) },
      { header: "Fields", accessorKey: "n_fields" },
      { header: "Samples", accessorKey: "n_samples" },
      { header: "Measured t", accessorKey: "measured_gain_t", cell: (i) => formatNumber(i.getValue() as number) },
      { header: "Credited t", accessorKey: "credited_t", cell: (i) => formatNumber(i.getValue() as number) },
      { header: "Stage", accessorKey: "micro_stage" },
    ],
    [],
  );

  const filtered = useMemo(() => {
    if (!ops) return [];
    switch (quickFilter) {
      case "ND_E":
      case "ND_W":
      case "MN":
        return ops.filter((o) => o.region === quickFilter);
      case "2024":
        return ops.filter((o) => o.enroll_origin === "2024_reenrolled");
      case "2025":
        return ops.filter((o) => o.enroll_origin === "2025_new");
      default:
        return ops;
    }
  }, [ops, quickFilter]);

  const selectedRows = ops?.filter((o) => selected.has(o.op_code)) ?? [];
  const isFullSelection = Boolean(ops) && selected.size === ops!.length;

  const rollup = useMemo(() => {
    return selectedRows.reduce(
      (acc, o) => ({
        acres: acc.acres + o.acres,
        creditable_acres: acc.creditable_acres + (o.creditable_acres ?? 0),
        n_fields: acc.n_fields + o.n_fields,
        n_samples: acc.n_samples + o.n_samples,
        measured_gain_t: acc.measured_gain_t + (o.measured_gain_t ?? 0),
        credited_t: acc.credited_t + o.credited_t,
      }),
      { acres: 0, creditable_acres: 0, n_fields: 0, n_samples: 0, measured_gain_t: 0, credited_t: 0 },
    );
  }, [selectedRows]);

  async function ensureStratLoaded(opCodes: string[]) {
    const missing = opCodes.filter((c) => !(c in stratCache));
    if (missing.length === 0) return stratCache;
    setAggregating(true);
    const fetched = await Promise.all(missing.map((c) => getOpStrat(c).catch(() => null)));
    const next = { ...stratCache };
    missing.forEach((c, i) => {
      if (fetched[i]) next[c] = fetched[i]!;
    });
    setStratCache(next);
    setAggregating(false);
    return next;
  }

  const strataAgg = useMemo(() => {
    const byTexture: Record<string, { acres: number; est_gain_t: number; densitySum: number; densityWeight: number }> = {};
    for (const opCode of selected) {
      const s = stratCache[opCode];
      if (!s) continue;
      for (const row of s.strata) {
        if (!row.texture_class) continue;
        const bucket = (byTexture[row.texture_class] ??= { acres: 0, est_gain_t: 0, densitySum: 0, densityWeight: 0 });
        bucket.acres += row.acres ?? 0;
        bucket.est_gain_t += row.est_gain_t ?? 0;
        if (row.avg_density_t_acft != null && row.acres) {
          bucket.densitySum += row.avg_density_t_acft * row.acres;
          bucket.densityWeight += row.acres;
        }
      }
    }
    return Object.entries(byTexture)
      .map(([texture_class, b]) => ({
        texture_class,
        acres: b.acres,
        est_gain_t: b.est_gain_t,
        avg_density_t_acft: b.densityWeight > 0 ? b.densitySum / b.densityWeight : null,
      }))
      .sort((a, b) => b.acres - a.acres);
  }, [selected, stratCache]);

  useEffect(() => {
    ensureStratLoaded([...selected]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  function selectByChip(chip: QuickFilter) {
    setQuickFilter(chip);
    if (!ops) return;
    if (chip === "all") setSelected(new Set(ops.map((o) => o.op_code)));
    else if (chip === "ND_E" || chip === "ND_W" || chip === "MN") setSelected(new Set(ops.filter((o) => o.region === chip).map((o) => o.op_code)));
    else if (chip === "2024") setSelected(new Set(ops.filter((o) => o.enroll_origin === "2024_reenrolled").map((o) => o.op_code)));
    else if (chip === "2025") setSelected(new Set(ops.filter((o) => o.enroll_origin === "2025_new").map((o) => o.op_code)));
  }

  async function exportApplicationCsv() {
    const cache = await ensureStratLoaded([...selected]);
    const rows: Record<string, unknown>[] = [];
    for (const op of selectedRows) {
      const strat = cache[op.op_code];
      if (!strat) continue;
      const opTotalEstGain = strat.strata.reduce((s, r) => s + (r.est_gain_t ?? 0), 0);
      for (const r of strat.strata) {
        if (!r.texture_class) continue;
        const share = opTotalEstGain > 0 ? (r.est_gain_t ?? 0) / opTotalEstGain : 0;
        rows.push({
          op_code: op.op_code,
          op_label: op.op_label,
          entity_name: op.op_label,
          state: op.state,
          region: op.region,
          enrollment_year: op.grower_since?.slice(0, 4),
          texture_class: r.texture_class,
          stratum_acres: r.acres,
          creditable_acres: op.creditable_acres,
          n_points_baseline: r.n_points_baseline,
          n_points_monitoring: r.n_points_monitoring,
          avg_bulk_density_g_cm3: r.avg_bulk_density_g_cm3,
          avg_density_t_acft: r.avg_density_t_acft,
          toc_baseline_mean_pct: r.toc_baseline_mean_pct,
          toc_monitoring_mean_pct: r.toc_monitoring_mean_pct,
          oc_gain_ppts: r.oc_gain_ppts,
          oc_gain_lower90_ppts: r.oc_gain_lower90_ppts,
          gain_t_acft: r.gain_t_acft,
          est_gain_t: r.est_gain_t,
          credited_t: Math.round(share * op.credited_t * 10) / 10,
          creditable: r.creditable,
          n_plss_sections: r.n_plss_sections,
        });
      }
    }
    downloadText("vch_application_export.csv", toCsv(rows));
  }

  function exportFullJson() {
    ensureStratLoaded([...selected]).then((cache) => {
      const payload = selectedRows.map((op) => ({ profile: op, strat: cache[op.op_code] ?? null }));
      downloadText("vch_full_export.json", JSON.stringify(payload, null, 2), "application/json");
    });
  }

  return (
    <div>
      <Header section="Analyst" />
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl">Growers</h1>
          <nav className="flex gap-4 text-sm font-semibold text-gold-800">
            <Link to="/analyst/status-map" className="hover:underline">Status map</Link>
            <Link to="/analyst/qa" className="hover:underline">QA</Link>
          </nav>
        </div>

        <FilterChips
          options={[
            { value: "all", label: "All" },
            { value: "ND_E", label: "ND East" },
            { value: "ND_W", label: "ND West" },
            { value: "MN", label: "MN" },
            { value: "2024", label: "2024 enrolled" },
            { value: "2025", label: "2025 enrolled" },
          ]}
          value={quickFilter}
          onChange={selectByChip}
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Ops selected" value={selectedRows.length} />
          <StatCard label="Total acres" value={formatAcres(isFullSelection && summary ? summary.table2.total_property_acres : rollup.acres)} />
          <StatCard
            label="Creditable acres"
            value={formatAcres(isFullSelection && summary ? summary.table2.creditable_acres : rollup.creditable_acres)}
            footnote={isFullSelection && summary ? "Matches BCarbon application Table 2" : undefined}
          />
          <StatCard label="Fields / samples" value={`${formatNumber(rollup.n_fields)} / ${formatNumber(rollup.n_samples)}`} />
          <StatCard label="Measured gain" value={formatTonnes(isFullSelection && summary ? summary.total_measured_gain_t : rollup.measured_gain_t)} />
          <StatCard
            label="Credited total"
            value={formatTonnes(isFullSelection && summary ? summary.fixtures.table13_total_requested_t : rollup.credited_t)}
            footnote={isFullSelection && summary ? "Matches BCarbon application Table 13" : undefined}
          />
        </div>

        {ops ? (
          <DataGrid
            data={filtered}
            columns={columns}
            getRowId={(r) => r.op_code}
            selectable
            selectedIds={selected}
            onSelectionChange={setSelected}
          />
        ) : (
          <p className="text-sand-600">Loading…</p>
        )}

        <section className="vch-card">
          <div className="flex items-center justify-between">
            <h2 className="text-lg">Per-stratum rollup (selection){aggregating && <span className="ml-2 text-xs font-normal text-sand-500">loading…</span>}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-sand-500">
                  <th className="py-1">Texture</th>
                  <th className="py-1">Acres</th>
                  <th className="py-1">Avg density (t/ac-ft)</th>
                  <th className="py-1">Est. gain (t)</th>
                </tr>
              </thead>
              <tbody>
                {strataAgg.map((r) => (
                  <tr key={r.texture_class} className="border-t border-sand-200">
                    <td className="py-1.5 font-semibold">{r.texture_class}</td>
                    <td className="py-1.5">{formatAcres(r.acres)}</td>
                    <td className="py-1.5">{r.avg_density_t_acft ? formatNumber(r.avg_density_t_acft, 1) : "—"}</td>
                    <td className="py-1.5">{formatNumber(r.est_gain_t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-wrap gap-3">
          <button className="vch-btn-secondary" onClick={exportFullJson}>Export Full JSON</button>
          <button className="vch-btn-secondary" onClick={exportApplicationCsv}>Export Application CSV</button>
          <ExportSamplePointsCsv opCodes={[...selected]} />
        </section>
      </main>
    </div>
  );
}

function ExportSamplePointsCsv({ opCodes }: { opCodes: string[] }) {
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    try {
      const texts = await Promise.all(
        opCodes.map((c) => fetch(`/data/analyst/ops/${c}/samples.csv`).then((r) => (r.ok ? r.text() : ""))),
      );
      const nonEmpty = texts.filter(Boolean);
      if (nonEmpty.length === 0) return;
      const header = nonEmpty[0].split("\n")[0];
      const body = nonEmpty.map((t) => t.split("\n").slice(1).join("\n")).join("\n");
      downloadText("vch_sample_points_export.csv", [header, body].join("\n"));
    } finally {
      setLoading(false);
    }
  }
  return (
    <button className="vch-btn-secondary" onClick={run} disabled={loading}>
      {loading ? "Preparing…" : "Export Sample points CSV"}
    </button>
  );
}
