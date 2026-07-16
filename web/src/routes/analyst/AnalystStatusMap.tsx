import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Header } from "../../components/Header";
import { MapInlay } from "../../components/MapInlay";
import { getFieldsStatusGeoJson } from "../../lib/api";

const STATUS_LEGEND: Array<{ key: string; label: string; color: string }> = [
  { key: "pre_submission", label: "Pre-submission", color: "#ECE1CD" },
  { key: "submitted", label: "Submitted", color: "#D4A72C" },
  { key: "validated", label: "Validated", color: "#5B7B4C" },
  { key: "credited", label: "Credited", color: "#3E5C36" },
];

const PERIOD_LEGEND: Array<{ key: string; label: string; color: string }> = [
  { key: "S25_only", label: "S25 only", color: "#C7B08A" },
  { key: "S25+F25", label: "S25 + F25", color: "#5B7B4C" },
];

export function AnalystStatusMap() {
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection>();
  const [colorBy, setColorBy] = useState<"status_class" | "periods_covered">("status_class");
  const [selected, setSelected] = useState<{ op_code: string; op_label: string } | null>(null);

  useEffect(() => {
    getFieldsStatusGeoJson().then(setGeojson);
  }, []);

  const counts: Record<string, number> = {};
  if (geojson) {
    for (const f of geojson.features) {
      const key = (colorBy === "status_class" ? (f.properties as any)?.status_class : (f.properties as any)?.periods_covered) as string;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  const legend = colorBy === "status_class" ? STATUS_LEGEND : PERIOD_LEGEND;

  return (
    <div>
      <Header section="Analyst" />
      <main className="mx-auto max-w-6xl space-y-4 px-6 py-8">
        <Link to="/analyst" className="text-sm font-semibold text-gold-800 hover:underline">← All growers</Link>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl">Submission status map</h1>
          <div className="flex gap-1 rounded-full border border-sand-300 bg-white p-1 text-xs">
            <button
              className={`rounded-full px-3 py-1 font-semibold ${colorBy === "status_class" ? "bg-gold-700 text-white" : "text-sand-700"}`}
              onClick={() => setColorBy("status_class")}
            >
              Status
            </button>
            <button
              className={`rounded-full px-3 py-1 font-semibold ${colorBy === "periods_covered" ? "bg-gold-700 text-white" : "text-sand-700"}`}
              onClick={() => setColorBy("periods_covered")}
            >
              Period coverage
            </button>
          </div>
        </div>

        <MapInlay
          statusGeoJson={geojson}
          statusColorBy={colorBy}
          onStatusFieldClick={(props) => setSelected({ op_code: props.op_code as string, op_label: props.op_label as string })}
          height="560px"
        />

        <div className="flex flex-wrap gap-4">
          {legend.map((l) => (
            <div key={l.key} className="flex items-center gap-2 text-sm text-sand-700">
              <span className="h-3 w-3 rounded-sm" style={{ background: l.color }} />
              {l.label} ({counts[l.key] ?? 0})
            </div>
          ))}
        </div>

        {selected && (
          <div className="vch-card">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sand-950">{selected.op_label}</div>
              <Link to={`/analyst/op/${selected.op_code}`} className="text-sm font-semibold text-gold-800 hover:underline">
                Open per-farmer view →
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
