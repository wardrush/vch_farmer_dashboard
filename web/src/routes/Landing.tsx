import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Header } from "../components/Header";
import { getOpsIndex } from "../lib/api";
import type { OpIndexRow } from "../types";
import { formatAcres } from "../lib/format";

export function Landing() {
  const [ops, setOps] = useState<OpIndexRow[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    getOpsIndex().then(setOps);
  }, []);

  const filtered = ops?.filter((o) => o.op_label.toLowerCase().includes(q.toLowerCase())) ?? [];

  return (
    <div>
      <Header section="Grower Dashboard" />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-4xl">Find your project</h1>
        <p className="mt-2 text-sand-700">
          This demo skips real sign-in — pick your operation below to see your project status, map, and enrollments.
        </p>
        <input
          className="vch-input mt-6 w-full"
          placeholder="Search by name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {filtered.map((op) => (
            <Link
              key={op.op_code}
              to={`/farmer/${op.op_code}`}
              className="rounded-2xl border border-sand-300 bg-white/90 p-4 transition hover:border-gold-700 hover:shadow-sm"
            >
              <div className="font-semibold text-sand-950">{op.op_label}</div>
              <div className="mt-1 text-xs text-sand-600">
                {op.state ?? "—"} · {formatAcres(op.acres)} · {op.n_fields} fields
              </div>
            </Link>
          ))}
          {ops === null && <p className="text-sand-600">Loading growers…</p>}
          {ops !== null && filtered.length === 0 && <p className="text-sand-600">No growers match &ldquo;{q}&rdquo;.</p>}
        </div>
      </main>
    </div>
  );
}
