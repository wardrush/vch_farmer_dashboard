import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Header } from "../../components/Header";
import { StageTracker } from "../../components/StageTracker";
import { StatCard } from "../../components/StatCard";
import { MapInlay } from "../../components/MapInlay";
import { FilterChips } from "../../components/FilterChips";
import { useLiveOp, creditsSubmitted } from "../../lib/useLiveOp";
import { getOpFieldsGeoJson, getOpSamplesGeoJson, getOpStrat } from "../../lib/api";
import { downloadText } from "../../lib/csv";
import { MACRO_STAGES, MACRO_STAGE_LABEL, MACRO_STAGE_SHORT, MICRO_STAGES, MICRO_STAGE_LABEL, MICRO_STAGE_SHORT, MICRO_STAGE_COPY } from "../../content/stageCopy";
import { formatAcres, formatNumber, formatTonnes } from "../../lib/format";
import type { StratJson, SamplePointProperties } from "../../types";

type PeriodFilter = "all" | "2024" | "2025" | "S24" | "F24" | "S25" | "F25";

export function AnalystOp() {
  const { opCode } = useParams<{ opCode: string }>();
  const { profile, loading } = useLiveOp(opCode);
  const [fieldsGeoJson, setFieldsGeoJson] = useState<GeoJSON.FeatureCollection>();
  const [samplesGeoJson, setSamplesGeoJson] = useState<GeoJSON.FeatureCollection>();
  const [strat, setStrat] = useState<StratJson | null>(null);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("all");
  const [selectedPoint, setSelectedPoint] = useState<SamplePointProperties | null>(null);

  useEffect(() => {
    if (!opCode) return;
    getOpFieldsGeoJson(opCode).then(setFieldsGeoJson);
    getOpSamplesGeoJson(opCode).then(setSamplesGeoJson);
    getOpStrat(opCode).then(setStrat);
  }, [opCode]);

  const filteredCount = useMemo(() => {
    if (!samplesGeoJson) return 0;
    if (periodFilter === "all") return samplesGeoJson.features.length;
    return samplesGeoJson.features.filter((f) => {
      const period = (f.properties as any)?.period as string;
      if (periodFilter === "2024") return period === "S24" || period === "F24";
      if (periodFilter === "2025") return period === "S25" || period === "F25";
      return period === periodFilter;
    }).length;
  }, [samplesGeoJson, periodFilter]);

  if (loading || !profile) {
    return (
      <div>
        <Header section="Analyst" />
        <main className="mx-auto max-w-6xl px-6 py-10 text-sand-600">Loading…</main>
      </div>
    );
  }

  const showCredits = creditsSubmitted(profile.current_micro_stage);

  function exportSamplesCsv() {
    if (!opCode) return;
    fetch(`/data/analyst/ops/${opCode}/samples.csv`).then(async (r) => {
      if (!r.ok) return;
      const text = await r.text();
      if (periodFilter === "all") {
        downloadText(`${opCode}_samples.csv`, text);
        return;
      }
      const [header, ...rows] = text.split("\n");
      const periodColIdx = header.split(",").indexOf("period");
      const filtered = rows.filter((row) => {
        const cols = row.split(",");
        const p = cols[periodColIdx];
        if (periodFilter === "2024") return p === "S24" || p === "F24";
        if (periodFilter === "2025") return p === "S25" || p === "F25";
        return p === periodFilter;
      });
      downloadText(`${opCode}_samples_${periodFilter}.csv`, [header, ...filtered].join("\n"));
    });
  }

  function exportOpJson() {
    downloadText(`${opCode}_op.json`, JSON.stringify({ profile, strat }, null, 2), "application/json");
  }

  return (
    <div>
      <Header section="Analyst" />
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <div>
          <Link to="/analyst" className="text-sm font-semibold text-gold-800 hover:underline">← All growers</Link>
          <h1 className="mt-1 text-3xl">{profile.op_label}</h1>
        </div>

        <section className="vch-card">
          <StageTracker stageIds={[...MACRO_STAGES]} labels={MACRO_STAGE_SHORT} fullLabels={MACRO_STAGE_LABEL} currentStage={profile.macro_stage} size="macro" />
          <StageTracker stageIds={[...MICRO_STAGES]} labels={MICRO_STAGE_SHORT} fullLabels={MICRO_STAGE_LABEL} currentStage={profile.current_micro_stage} size="micro" copy={MICRO_STAGE_COPY} />
          <Link to={`/analyst/sampling?op=${profile.op_code}`} className="inline-flex items-center gap-1 text-sm font-semibold text-gold-800 hover:underline">
            Plan soil sampling for this project →
          </Link>
        </section>

        <div className="grid gap-6 lg:grid-cols-[55%_1fr]">
          <MapInlay fieldsGeoJson={fieldsGeoJson} clusterBboxes={profile.cluster_bboxes} opBounds={profile.op_bounds} />
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Acres" value={formatAcres(profile.acres_submitted)} />
            <StatCard label="Fields" value={profile.n_fields} />
            <StatCard label="Creditable acres" value={formatAcres(strat?.creditable_acres)} />
            <StatCard label="Samples" value={strat?.n_samples ?? "—"} />
            {showCredits && <StatCard label="Credited (current cycle)" value={formatTonnes(profile.credited_t)} />}
          </div>
        </div>

        {strat && (
          <section className="vch-card">
            <h2 className="text-lg">Stratification (Table 13 shape)</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <StatCard label="Textures" value={strat.n_textures} />
              <StatCard label="Total acres" value={formatAcres(strat.total_acres)} />
              <StatCard label="Creditable acres" value={formatAcres(strat.creditable_acres)} />
              <StatCard label="Fields" value={strat.n_fields} />
              <StatCard label="Samples" value={strat.n_samples} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-sand-500">
                    <th className="py-1">Texture</th>
                    <th className="py-1">Acres</th>
                    <th className="py-1">Density (t/ac-ft)</th>
                    <th className="py-1">Gain % (mean)</th>
                    <th className="py-1">Gain % (lower-90)</th>
                    <th className="py-1">Gain (t/ac-ft)</th>
                    <th className="py-1">Est. gain (t)</th>
                    <th className="py-1">Creditable?</th>
                  </tr>
                </thead>
                <tbody>
                  {strat.strata
                    .filter((r) => r.texture_class)
                    .map((r) => (
                      <tr key={r.texture_class} className={`border-t border-sand-200 ${r.creditable ? "bg-moss/10" : ""}`}>
                        <td className="py-1.5 font-semibold">{r.texture_class}</td>
                        <td className="py-1.5">{formatAcres(r.acres)}</td>
                        <td className="py-1.5">{r.avg_density_t_acft ? formatNumber(r.avg_density_t_acft, 1) : "—"}</td>
                        <td className="py-1.5">{r.oc_gain_ppts != null ? r.oc_gain_ppts.toFixed(3) : "—"}</td>
                        <td className="py-1.5">{r.oc_gain_lower90_ppts != null ? r.oc_gain_lower90_ppts.toFixed(3) : "—"}</td>
                        <td className="py-1.5">{r.gain_t_acft != null ? r.gain_t_acft.toFixed(2) : "—"}</td>
                        <td className="py-1.5">{r.est_gain_t != null ? formatNumber(r.est_gain_t) : "—"}</td>
                        <td className="py-1.5">
                          {r.creditable ? (
                            <span className="rounded-full bg-moss/20 px-2 py-0.5 text-xs font-semibold text-moss">credited stratum</span>
                          ) : (
                            <span className="text-xs text-sand-500">
                              {r.oc_gain_lower90_ppts != null && r.oc_gain_lower90_ppts <= 0 ? "lower90≤0" : "<5 PLSS sections"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-sand-700">Baseline vs treated (S25 vs F25 mean TOC)</h3>
              <div className="space-y-2">
                {strat.strata.filter((r) => r.toc_baseline_mean_pct != null && r.toc_monitoring_mean_pct != null).map((r) => {
                  const max = Math.max(r.toc_baseline_mean_pct ?? 0, r.toc_monitoring_mean_pct ?? 0, 0.1);
                  return (
                    <div key={r.texture_class} className="text-xs">
                      <div className="mb-0.5 flex justify-between text-sand-600">
                        <span className="font-semibold text-sand-800">{r.texture_class}</span>
                        <span>
                          S25 n={r.n_points_baseline} · F25 n={r.n_points_monitoring}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="h-3 rounded bg-sand-400" style={{ width: `${((r.toc_baseline_mean_pct ?? 0) / max) * 100}%` }} />
                        <span className="text-sand-600">{r.toc_baseline_mean_pct?.toFixed(2)}%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="h-3 rounded bg-moss" style={{ width: `${((r.toc_monitoring_mean_pct ?? 0) / max) * 100}%` }} />
                        <span className="text-sand-600">{r.toc_monitoring_mean_pct?.toFixed(2)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <section className="vch-card">
          <div className="flex items-center justify-between">
            <h2 className="text-lg">Sample map</h2>
            <span className="text-xs text-sand-500">{filteredCount} points</span>
          </div>
          <FilterChips
            options={[
              { value: "all", label: "All" },
              { value: "2024", label: "2024" },
              { value: "2025", label: "2025" },
              { value: "S24", label: "S24" },
              { value: "F24", label: "F24" },
              { value: "S25", label: "S25" },
              { value: "F25", label: "F25" },
            ]}
            value={periodFilter}
            onChange={setPeriodFilter}
          />
          <MapInlay
            fieldsGeoJson={fieldsGeoJson}
            fieldsFillOpacity={0.12}
            samplesGeoJson={samplesGeoJson}
            samplesPeriodFilter={periodFilter === "all" || periodFilter === "2024" || periodFilter === "2025" ? null : periodFilter}
            onSampleClick={(props) => setSelectedPoint(props as unknown as SamplePointProperties)}
            opBounds={profile.op_bounds}
          />
          {selectedPoint && (
            <div className="rounded-2xl border border-sand-300 bg-sand-50 p-4 text-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold">{selectedPoint.texture_class ?? "Unknown texture"} · {selectedPoint.period}</span>
                {!(selectedPoint.has_dc && selectedPoint.has_bd) && (
                  <span className="rounded-full bg-rust/10 px-2 py-0.5 text-xs font-semibold text-rust">partial point</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-sand-700">
                <div>TRS: {selectedPoint.trs} ({selectedPoint.trs_confidence})</div>
                <div>Match: {selectedPoint.match_completeness}</div>
                <div>Has DC: {selectedPoint.has_dc ? "yes" : "no"}</div>
                <div>Has BD: {selectedPoint.has_bd ? "yes" : "no"}</div>
                <div>State/Region: {selectedPoint.state} / {selectedPoint.region}</div>
                <div>Lat/Lon: {selectedPoint.lat?.toFixed(4)}, {selectedPoint.lon?.toFixed(4)}</div>
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <button className="vch-btn-secondary" onClick={exportSamplesCsv}>Export Samples CSV</button>
            <button className="vch-btn-secondary" onClick={exportOpJson}>Export Op JSON</button>
          </div>
        </section>
      </main>
    </div>
  );
}
