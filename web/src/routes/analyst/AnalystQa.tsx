import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Header } from "../../components/Header";
import { StatCard } from "../../components/StatCard";
import { getQa } from "../../lib/api";
import type { QaJson } from "../../types";

export function AnalystQa() {
  const [qa, setQa] = useState<QaJson | null>(null);

  useEffect(() => {
    getQa().then(setQa);
  }, []);

  if (!qa) {
    return (
      <div>
        <Header section="Analyst" />
        <main className="mx-auto max-w-5xl px-6 py-10 text-sand-600">Loading…</main>
      </div>
    );
  }

  return (
    <div>
      <Header section="Analyst" />
      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <Link to="/analyst" className="text-sm font-semibold text-gold-800 hover:underline">← All growers</Link>
        <h1 className="text-3xl">Data quality</h1>
        <p className="text-sand-700">
          Every raw name variant is resolved through one crosswalk (docs/IDENTITY_CROSSWALK.md) instead of ad-hoc
          matching per report — this is the page that shows the crosswalk is trustworthy.
        </p>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(qa.crosswalk_resolution_counts).map(([k, v]) => (
            <StatCard key={k} label={k.replace("_", " ")} value={v} />
          ))}
        </section>

        <section className="vch-card">
          <h2 className="text-lg">Unresolved name variants</h2>
          <p className="text-sm text-sand-600">
            Raw values that appeared in a source but never matched an operation — reviewed by hand, not silently
            dropped.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-sand-500">
                <th className="py-1">Raw value</th>
                <th className="py-1">Source</th>
                <th className="py-1">Rows</th>
                <th className="py-1">Best fuzzy score</th>
              </tr>
            </thead>
            <tbody>
              {qa.unresolved_variants.map((u, i) => (
                <tr key={i} className="border-t border-sand-200">
                  <td className="py-1.5">{u.raw_value}</td>
                  <td className="py-1.5 text-sand-600">{u.source}</td>
                  <td className="py-1.5">{u.row_count}</td>
                  <td className="py-1.5">{u.best_score != null ? u.best_score.toFixed(0) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="vch-card">
          <h2 className="text-lg">Unmatched samples ({qa.n_unmatched_samples})</h2>
          <p className="text-sm text-sand-600">
            Lab rows that couldn&rsquo;t be tied to a field/customer with confidence — this is the exact category the
            barcoded sampling system going forward is meant to eliminate.
          </p>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 bg-sand-100 text-left text-xs uppercase tracking-wide text-sand-500">
                  <th className="py-1 px-2">Lab result</th>
                  <th className="py-1 px-2">Customer</th>
                  <th className="py-1 px-2">Farm business</th>
                  <th className="py-1 px-2">Period</th>
                  <th className="py-1 px-2">TRS</th>
                </tr>
              </thead>
              <tbody>
                {qa.unmatched_samples_preview.map((r, i) => (
                  <tr key={i} className="border-t border-sand-200">
                    <td className="px-2 py-1">{String(r.lab_result_id)}</td>
                    <td className="px-2 py-1">{String(r.customer_raw ?? "—")}</td>
                    <td className="px-2 py-1">{String(r.farm_business_raw ?? "—")}</td>
                    <td className="px-2 py-1">{String(r.period ?? "—")}</td>
                    <td className="px-2 py-1">{String(r.trs ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="vch-card">
          <h2 className="text-lg">Outlier flags</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {(["spatial", "toc", "bd_flag"] as const).map((k) => (
              <div key={k}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-sand-500">{k}</div>
                <ul className="text-sm text-sand-800">
                  {Object.entries(qa.outlier_counts[k]).map(([label, count]) => (
                    <li key={label} className="flex justify-between border-t border-sand-200 py-1">
                      <span>{label}</span>
                      <span className="font-semibold">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {qa.unresolved_enrollments.length > 0 && (
          <section className="vch-card">
            <h2 className="text-lg">Unresolved enrollments</h2>
            <p className="text-sm text-sand-600">Real distributor rows that don&rsquo;t match any operation in this cohort.</p>
            <ul className="space-y-1 text-sm">
              {qa.unresolved_enrollments.map((e) => (
                <li key={e.enrollment_id} className="flex justify-between border-t border-sand-200 py-1">
                  <span>{e.farmer_name} / {e.entity_name}</span>
                  <span className="font-semibold text-rust">UNRESOLVED</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
