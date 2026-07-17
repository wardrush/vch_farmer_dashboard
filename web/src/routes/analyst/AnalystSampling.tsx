import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Header } from "../../components/Header";
import { StatCard } from "../../components/StatCard";
import { Callout } from "../../components/Callout";
import { DemoBadge } from "../../components/DemoBadge";
import { SamplingMap, type Selection } from "../../components/SamplingMap";
import { getSamplingIndex, getOpStrata, getOpStratFieldsGeoJson } from "../../lib/api";
import { downloadText } from "../../lib/csv";
import { formatAcres, formatUsd } from "../../lib/format";
import {
  DEFAULT_PARAMS,
  generatePlan,
  recalcAfterEdit,
  computeTotals,
  coresToCsv,
  coresToGeoJson,
  type EngineParams,
  type SamplingPlan,
  type SamplingIndexRow,
  type StrataFile,
  type Core,
} from "../../lib/sampling";

// Earthy categorical palette for soil textures (VCH tones + accents).
const TEXTURE_PALETTE = [
  "#A67C17", "#5B7B4C", "#B3402A", "#8A6612", "#2f6fb0",
  "#C7B08A", "#3E5C36", "#7A5230", "#9C6B9E", "#4E7D8C",
  "#D4A72C", "#6B8E23", "#A0522D", "#556B2F",
];

function buildTextureColors(textures: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  textures.forEach((t, i) => (out[t] = TEXTURE_PALETTE[i % TEXTURE_PALETTE.length]));
  return out;
}

const DRAFT_PREFIX = "vch_sampling_draft_v1:";

function fmtCi(v: number): string {
  return v === Infinity ? "—" : v.toFixed(2);
}

export function AnalystSampling() {
  const [searchParams] = useSearchParams();
  const [index, setIndex] = useState<SamplingIndexRow[] | null>(null);
  const [opCode, setOpCode] = useState<string>("");
  const [strata, setStrata] = useState<StrataFile | null>(null);
  const [fields, setFields] = useState<GeoJSON.FeatureCollection | null>(null);
  const [params, setParams] = useState<EngineParams>(DEFAULT_PARAMS);
  const [plan, setPlan] = useState<SamplingPlan | null>(null);
  const [selected, setSelected] = useState<Selection>(null);
  const [editMode, setEditMode] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadingOp, setLoadingOp] = useState(false);

  const restoredDraftRef = useRef(false);

  // op list
  useEffect(() => {
    getSamplingIndex().then((f) => {
      setIndex(f.ops);
      const qp = searchParams.get("op");
      const initial = qp && f.ops.some((o) => o.op_code === qp) ? qp : f.ops[0]?.op_code ?? "";
      setOpCode(initial);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load op data
  useEffect(() => {
    if (!opCode) return;
    setLoadingOp(true);
    setPlan(null);
    setSelected(null);
    restoredDraftRef.current = false;
    Promise.all([getOpStrata(opCode), getOpStratFieldsGeoJson(opCode)])
      .then(([s, f]) => {
        setStrata(s);
        setFields(f);
        // restore a saved draft for this op, if any
        const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DRAFT_PREFIX + opCode) : null;
        if (raw) {
          try {
            const d = JSON.parse(raw) as { params: EngineParams; cores: SamplingPlan["cores"]; centroids: SamplingPlan["centroids"] };
            const base = generatePlan(s, f.features, d.params);
            const restored = recalcAfterEdit({ ...base, cores: d.cores, centroids: d.centroids });
            setParams(d.params);
            setPlan(restored);
            restoredDraftRef.current = true;
            setDirty(true);
          } catch {
            /* ignore bad draft */
          }
        }
      })
      .finally(() => setLoadingOp(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opCode]);

  // (re)generate on placement-param change — but not right after a draft restore
  const {
    useElevation,
    reliefThresholdM,
    mode,
    densityMultiplier,
    clustering,
    minStratumAcres,
    minSharePct,
    smallStratumMode,
    targetCiHalfWidthPpts,
  } = params;

  useEffect(() => {
    if (!strata || !fields) return;
    if (restoredDraftRef.current) {
      restoredDraftRef.current = false; // consume: keep the restored plan once
      return;
    }
    const p = generatePlan(strata, fields.features, params);
    setPlan(p);
    setSelected(null);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    strata,
    fields,
    useElevation,
    reliefThresholdM,
    mode,
    densityMultiplier,
    clustering,
    minStratumAcres,
    minSharePct,
    smallStratumMode,
    targetCiHalfWidthPpts,
  ]);

  // cost-per-core only affects totals, not placement
  useEffect(() => {
    setPlan((prev) => (prev ? { ...prev, params: { ...prev.params, costPerCoreUsd: params.costPerCoreUsd }, totals: computeTotals(prev.strata, prev.centroids, prev.cores, { ...prev.params, costPerCoreUsd: params.costPerCoreUsd }) } : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.costPerCoreUsd]);

  const textureColors = useMemo(
    () => buildTextureColors(strata ? strata.strata.map((s) => s.texture_class) : []),
    [strata],
  );

  const saveDraft = useCallback(
    (p: SamplingPlan) => {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(DRAFT_PREFIX + opCode, JSON.stringify({ params: p.params, cores: p.cores, centroids: p.centroids }));
    },
    [opCode],
  );

  // ---- manual edit handlers ----
  const applyEdit = useCallback(
    (mutate: (p: SamplingPlan) => SamplingPlan) => {
      setPlan((prev) => {
        if (!prev) return prev;
        const next = recalcAfterEdit(mutate(prev));
        saveDraft(next);
        return next;
      });
      setDirty(true);
    },
    [saveDraft],
  );

  const onMoveCore = useCallback(
    (uuid: string, lon: number, lat: number) => applyEdit((p) => ({ ...p, cores: p.cores.map((c) => (c.core_uuid === uuid ? { ...c, lon, lat } : c)) })),
    [applyEdit],
  );

  const onMoveCentroid = useCallback(
    (id: string, lon: number, lat: number) =>
      applyEdit((p) => {
        const cen = p.centroids.find((c) => c.id === id);
        if (!cen) return p;
        const dLon = lon - cen.lon;
        const dLat = lat - cen.lat;
        return {
          ...p,
          centroids: p.centroids.map((c) => (c.id === id ? { ...c, lon, lat } : c)),
          cores: p.cores.map((c) => (c.centroid_id === id ? { ...c, lon: +(c.lon + dLon).toFixed(6), lat: +(c.lat + dLat).toFixed(6) } : c)),
        };
      }),
    [applyEdit],
  );

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    applyEdit((p) => {
      if (selected.kind === "core") return { ...p, cores: p.cores.filter((c) => c.core_uuid !== selected.id) };
      return { ...p, centroids: p.centroids.filter((c) => c.id !== selected.id), cores: p.cores.filter((c) => c.centroid_id !== selected.id) };
    });
    setSelected(null);
  }, [selected, applyEdit]);

  const addCoreToSelected = useCallback(() => {
    if (!selected || selected.kind !== "centroid" || !plan) return;
    const cen = plan.centroids.find((c) => c.id === selected.id);
    if (!cen) return;
    const bearing = Math.random() * 2 * Math.PI;
    const r = 20 / 111320;
    const seq = plan.cores.length + 1;
    const core: Core = {
      core_uuid: Math.random().toString(16).slice(2, 14),
      barcode: `VCH-${plan.op_code}-M${String(seq).padStart(4, "0")}`,
      lab_no: `L${900000 + seq}`,
      centroid_id: cen.id,
      stratum_id: cen.stratum_id,
      texture_class: cen.texture_class,
      elevation_band: cen.elevation_band,
      op_code: plan.op_code,
      farmer: plan.op_label,
      lat: +(cen.lat + Math.sin(bearing) * r).toFixed(6),
      lon: +(cen.lon + Math.cos(bearing) * r).toFixed(6),
      demo_fabricated: true,
    };
    applyEdit((p) => ({ ...p, cores: [...p.cores, core] }));
  }, [selected, plan, applyEdit]);

  // Delete/Backspace removes selection while in edit mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!editMode) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editMode, selected, deleteSelected]);

  function regenerateFromScratch() {
    if (!strata || !fields) return;
    if (typeof localStorage !== "undefined") localStorage.removeItem(DRAFT_PREFIX + opCode);
    setPlan(generatePlan(strata, fields.features, params));
    setSelected(null);
    setDirty(false);
  }

  function finalize() {
    if (!plan) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`sampling_${plan.op_code}_${stamp}.csv`, coresToCsv(plan));
    downloadText(`sampling_${plan.op_code}_${stamp}.geojson`, JSON.stringify(coresToGeoJson(plan), null, 2), "application/geo+json");
    saveDraft(plan);
  }

  const set = (patch: Partial<EngineParams>) => setParams((p) => ({ ...p, ...patch }));

  const opRow = index?.find((o) => o.op_code === opCode);
  const selectedCore = selected?.kind === "core" ? plan?.cores.find((c) => c.core_uuid === selected.id) : null;
  const selectedCentroid = selected?.kind === "centroid" ? plan?.centroids.find((c) => c.id === selected.id) : null;

  return (
    <div>
      <Header section="Analyst · Sampling" />
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link to="/analyst" className="text-sm font-semibold text-gold-800 hover:underline">← Analyst</Link>
            <h1 className="mt-1 text-3xl">Soil sampling planner</h1>
            <p className="max-w-2xl text-sm text-sand-700">
              Stratify a project by SSURGO soil texture and elevation, auto-place stratified sampling
              points under the BCarbon / VM0042 approach, tune for cost and confidence, then hand-adjust
              points before exporting the field table. <DemoBadge /> elevation and variance are demo values.
            </p>
          </div>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-sand-700">Project</span>
            <select className="vch-input min-w-[18rem]" value={opCode} onChange={(e) => setOpCode(e.target.value)}>
              {index?.map((o) => (
                <option key={o.op_code} value={o.op_code}>
                  {o.op_code} · {o.op_label} · {o.region ?? "—"} {o.has_prior_samples ? "· prior ✓" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loadingOp && <p className="text-sand-600">Loading project…</p>}

        {plan && fields && strata && (
          <>
            {/* Summary stat row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Strata sampled" value={`${plan.totals.n_sampled}/${plan.totals.n_strata}`} />
              <StatCard label="Centroids" value={plan.totals.n_centroids} />
              <StatCard label="Cores" value={plan.totals.n_cores} />
              <StatCard label="Est. cost" value={formatUsd(plan.totals.cost_usd)} />
              <StatCard label="Drive index" value={`${plan.totals.driving_index_km} km`} />
              <StatCard label="Underpowered" value={plan.totals.n_underpowered} />
            </div>

            {plan.totals.n_underpowered > 0 && (
              <Callout>
                <strong>{plan.totals.n_underpowered}</strong> stratum(s) fall below the target confidence for
                crediting at the current density. Raise the density slider or lower the target CI half-width —
                but note each added core costs {formatUsd(params.costPerCoreUsd)}.
              </Callout>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
              {/* Map */}
              <div className="space-y-3">
                <SamplingMap
                  fieldsGeoJson={fields}
                  textureColors={textureColors}
                  cores={plan.cores}
                  centroids={plan.centroids}
                  selected={selected}
                  editMode={editMode}
                  onSelect={setSelected}
                  onMoveCore={onMoveCore}
                  onMoveCentroid={onMoveCentroid}
                />
                {/* legend */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-sand-700">
                  {strata.strata.map((s) => (
                    <span key={s.texture_class} className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ background: textureColors[s.texture_class] }} />
                      {s.texture_class}
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full border-2" style={{ borderColor: "#2f6fb0" }} /> low elev.</span>
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full border-2" style={{ borderColor: "#b3402a" }} /> high elev.</span>
                </div>

                {/* edit toolbar */}
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-sand-300 bg-white/80 p-3">
                  <button
                    type="button"
                    onClick={() => setEditMode((v) => !v)}
                    className={editMode ? "vch-btn-primary" : "vch-btn-secondary"}
                  >
                    {editMode ? "Editing points ✓" : "Edit points"}
                  </button>
                  <button type="button" disabled={!selected} onClick={deleteSelected} className="vch-btn-secondary disabled:opacity-40">
                    Delete selected
                  </button>
                  <button type="button" disabled={selected?.kind !== "centroid"} onClick={addCoreToSelected} className="vch-btn-secondary disabled:opacity-40">
                    + core to centroid
                  </button>
                  <button type="button" onClick={regenerateFromScratch} className="vch-btn-secondary">
                    Regenerate
                  </button>
                  {dirty && <span className="text-xs font-medium text-gold-800">manual edits applied</span>}
                </div>

                {(selectedCore || selectedCentroid) && (
                  <div className="rounded-2xl border border-gold-700/40 bg-sand-50 p-3 text-xs text-sand-800">
                    {selectedCore && (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <div><span className="text-sand-500">Core</span> {selectedCore.core_uuid}</div>
                        <div><span className="text-sand-500">Barcode</span> {selectedCore.barcode}</div>
                        <div><span className="text-sand-500">Texture</span> {selectedCore.texture_class}</div>
                        <div><span className="text-sand-500">Band</span> {selectedCore.elevation_band}</div>
                        <div><span className="text-sand-500">Lat</span> {selectedCore.lat}</div>
                        <div><span className="text-sand-500">Lon</span> {selectedCore.lon}</div>
                      </div>
                    )}
                    {selectedCentroid && (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <div><span className="text-sand-500">Centroid</span> {selectedCentroid.id}</div>
                        <div><span className="text-sand-500">Texture</span> {selectedCentroid.texture_class}</div>
                        <div><span className="text-sand-500">Band</span> {selectedCentroid.elevation_band}</div>
                        <div><span className="text-sand-500">Cores here</span> {plan.cores.filter((c) => c.centroid_id === selectedCentroid.id).length}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="space-y-4 rounded-3xl border border-sand-300 bg-white/90 p-4">
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-sand-500">Reference data</div>
                  <div className="flex gap-1 rounded-full bg-sand-100 p-1 text-xs">
                    {(["naive", "prior"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        disabled={m === "prior" && !opRow?.has_prior_samples}
                        onClick={() => set({ mode: m })}
                        className={`flex-1 rounded-full px-2 py-1.5 font-semibold disabled:opacity-40 ${mode === m ? "bg-gold-700 text-white" : "text-sand-700"}`}
                      >
                        {m === "naive" ? "Naive" : "Prior-informed"}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-sand-500">
                    {mode === "prior"
                      ? "Adds points where last year's carbon gain has a wide confidence interval, to optimise crediting."
                      : "Designs from scratch — no prior sampling assumed."}
                  </p>
                </div>

                <Slider label="Sampling density" value={densityMultiplier} min={0.5} max={2} step={0.1} onChange={(v) => set({ densityMultiplier: v })} fmt={(v) => `${v.toFixed(1)}×`} />
                <Slider label="Clustering (min. driving)" value={clustering} min={0} max={1} step={0.05} onChange={(v) => set({ clustering: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
                <Slider label="Target CI half-width" value={targetCiHalfWidthPpts} min={0.05} max={0.4} step={0.01} onChange={(v) => set({ targetCiHalfWidthPpts: v })} fmt={(v) => `±${v.toFixed(2)} pp`} />

                <div>
                  <label className="flex items-center justify-between text-sm font-semibold text-sand-800">
                    Elevation stratification
                    <input type="checkbox" checked={useElevation} onChange={(e) => set({ useElevation: e.target.checked })} />
                  </label>
                  {useElevation && (
                    <Slider label="Meaningful relief ≥" value={reliefThresholdM} min={2} max={30} step={1} onChange={(v) => set({ reliefThresholdM: v })} fmt={(v) => `${v} m`} />
                  )}
                </div>

                <div className="border-t border-sand-200 pt-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-sand-500">Acreage vs. cost</div>
                  <Slider label="Min stratum size" value={minStratumAcres} min={0} max={500} step={10} onChange={(v) => set({ minStratumAcres: v })} fmt={(v) => `${v} ac`} />
                  <Slider label="Min share of project" value={minSharePct} min={0} max={10} step={0.5} onChange={(v) => set({ minSharePct: v })} fmt={(v) => `${v}%`} />
                  <div className="mt-1 flex gap-1 rounded-full bg-sand-100 p-1 text-xs">
                    {(["tracking", "exclude"] as const).map((m) => (
                      <button key={m} type="button" onClick={() => set({ smallStratumMode: m })} className={`flex-1 rounded-full px-2 py-1.5 font-semibold ${smallStratumMode === m ? "bg-gold-700 text-white" : "text-sand-700"}`}>
                        {m === "tracking" ? "1 tracking pt" : "Exclude"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-sand-200 pt-3">
                  <label className="flex items-center justify-between text-sm font-semibold text-sand-800">
                    Cost per core
                    <span className="flex items-center gap-1">
                      $<input type="number" className="w-16 rounded-lg border border-sand-400 px-2 py-1 text-right" value={params.costPerCoreUsd} min={1} onChange={(e) => set({ costPerCoreUsd: Number(e.target.value) || 0 })} />
                    </span>
                  </label>
                </div>

                <button type="button" onClick={finalize} className="vch-btn-primary w-full">Finalize & export ↓</button>
                <p className="text-center text-[11px] text-sand-500">Exports one row per core (CSV + GeoJSON). Draft auto-saved locally.</p>
              </div>
            </div>

            {/* Stratum table */}
            <section className="vch-card">
              <h2 className="text-lg">Stratification plan</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-sand-300 text-xs uppercase tracking-wide text-sand-500">
                      <th className="py-2 pr-3">Texture</th>
                      <th className="py-2 pr-3 text-right">Acres</th>
                      <th className="py-2 pr-3 text-right">Share</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3 text-center">Elev split</th>
                      <th className="py-2 pr-3 text-right">Centroids</th>
                      <th className="py-2 pr-3 text-right">Cores</th>
                      <th className="py-2 pr-3 text-right">Gain SD</th>
                      <th className="py-2 pr-3 text-right">CI ± (pp)</th>
                      <th className="py-2 pr-3 text-right">Prior gain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.strata.map((s) => {
                      const overTarget = s.status === "sampled" && s.ci_half_width_ppts > params.targetCiHalfWidthPpts * 1.5;
                      return (
                        <tr key={s.stratum_id} className={`border-b border-sand-200 ${s.status === "excluded" ? "opacity-50" : ""}`}>
                          <td className="py-2 pr-3">
                            <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: textureColors[s.texture_class] }} />
                            {s.texture_class}
                          </td>
                          <td className="py-2 pr-3 text-right">{formatAcres(s.acres)}</td>
                          <td className="py-2 pr-3 text-right">{s.acres_share_pct.toFixed(1)}%</td>
                          <td className="py-2 pr-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.status === "sampled" ? "bg-moss/20 text-moss" : s.status === "tracking" ? "bg-gold-400/20 text-gold-800" : "bg-sand-200 text-sand-500"}`}>
                              {s.status}
                            </span>
                            {s.reason && <span className="ml-1 text-[11px] text-sand-500">{s.reason}</span>}
                          </td>
                          <td className="py-2 pr-3 text-center">{s.elevation_split ? "✓" : "—"}</td>
                          <td className="py-2 pr-3 text-right">{s.n_centroids}</td>
                          <td className="py-2 pr-3 text-right">{s.n_cores}</td>
                          <td className="py-2 pr-3 text-right">
                            {s.gain_sd_ppts.toFixed(2)}
                            {s.sd_source === "fabricated" && <sup className="text-sand-400"> demo</sup>}
                          </td>
                          <td className={`py-2 pr-3 text-right font-semibold ${overTarget ? "text-rust" : "text-moss"}`}>{fmtCi(s.ci_half_width_ppts)}</td>
                          <td className="py-2 pr-3 text-right text-xs text-sand-600">
                            {s.prior_oc_gain_ppts != null ? `${s.prior_oc_gain_ppts.toFixed(2)} pp${s.prior_creditable === false ? " (uncredited)" : ""}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-sand-500">
                CI shown in red exceeds 1.5× the target half-width (statistically weak for crediting). SD marked
                “demo” is fabricated where the stratum has no prior samples.
              </p>
            </section>

            {/* Output table */}
            <section className="vch-card">
              <div className="flex items-center justify-between">
                <h2 className="text-lg">Sampling table — one row per core ({plan.cores.length})</h2>
                <button type="button" onClick={finalize} className="vch-btn-secondary">Export CSV + GeoJSON</button>
              </div>
              <div className="max-h-96 overflow-auto rounded-2xl border border-sand-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-sand-100 text-[10px] uppercase tracking-wide text-sand-500">
                    <tr>
                      <th className="px-2 py-1.5">Sample UUID</th>
                      <th className="px-2 py-1.5">Barcode</th>
                      <th className="px-2 py-1.5">Lab no.</th>
                      <th className="px-2 py-1.5">Farmer</th>
                      <th className="px-2 py-1.5">Soil texture</th>
                      <th className="px-2 py-1.5">Band</th>
                      <th className="px-2 py-1.5 text-right">Lat</th>
                      <th className="px-2 py-1.5 text-right">Lon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.cores.map((c) => (
                      <tr
                        key={c.core_uuid}
                        onClick={() => setSelected({ kind: "core", id: c.core_uuid })}
                        className={`cursor-pointer border-b border-sand-100 hover:bg-sand-50 ${selected?.kind === "core" && selected.id === c.core_uuid ? "bg-gold-400/10" : ""}`}
                      >
                        <td className="px-2 py-1 font-mono">{c.core_uuid}</td>
                        <td className="px-2 py-1 font-mono">{c.barcode}</td>
                        <td className="px-2 py-1 font-mono">{c.lab_no}</td>
                        <td className="px-2 py-1">{c.farmer}</td>
                        <td className="px-2 py-1">{c.texture_class}</td>
                        <td className="px-2 py-1">{c.elevation_band}</td>
                        <td className="px-2 py-1 text-right">{c.lat}</td>
                        <td className="px-2 py-1 text-right">{c.lon}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt: (v: number) => string;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-sm font-semibold text-sand-800">
        {label}
        <span className="tabular-nums text-gold-800">{fmt(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-gold-700" />
    </label>
  );
}
