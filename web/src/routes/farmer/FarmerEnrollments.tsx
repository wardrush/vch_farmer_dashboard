import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Header } from "../../components/Header";
import { DemoBadge } from "../../components/DemoBadge";
import { getEnrollmentOverlay, getOpEnrollments } from "../../lib/api";
import type { EnrollmentsPayload } from "../../types";
import { formatAcres, formatDate, formatUsd } from "../../lib/format";

export function FarmerEnrollments() {
  const { opCode } = useParams<{ opCode: string }>();
  const [data, setData] = useState<EnrollmentsPayload | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!opCode) return;
    getOpEnrollments(opCode).then((payload) => {
      const merged = {
        ...payload,
        enrollments: payload.enrollments.map((e) => {
          const overlay = getEnrollmentOverlay(e.enrollment_id);
          return overlay ? { ...e, docs_received: overlay.docs_received, docs_needed: overlay.docs_needed } : e;
        }),
      };
      setData(merged);
    });
  }, [opCode]);

  if (!data) {
    return (
      <Shell opCode={opCode}>
        <p className="text-sand-600">Loading…</p>
      </Shell>
    );
  }

  return (
    <Shell opCode={opCode}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-sand-300 bg-white/90 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sand-500">Total acres enrolled</div>
          <div className="mt-1 text-2xl font-bold">{formatAcres(data.rollup.total_acres)}</div>
        </div>
        <div className="rounded-2xl border border-sand-300 bg-white/90 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sand-500">Grower with us since</div>
          <div className="mt-1 text-2xl font-bold">{data.rollup.grower_since.slice(0, 4)}</div>
        </div>
        <div className="rounded-2xl border border-sand-300 bg-white/90 p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-sand-500">Credits distributed</div>
            {data.rollup.credits_distributed_usd != null && <DemoBadge />}
          </div>
          <div className="mt-1 text-2xl font-bold">
            {data.rollup.credits_distributed_usd != null ? formatUsd(data.rollup.credits_distributed_usd) : "—"}
          </div>
          {data.rollup.credits_distributed_usd == null && (
            <div className="mt-1 text-xs text-sand-600">First distribution follows validation.</div>
          )}
        </div>
      </div>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg">Enrollment sets</h2>
        {data.enrollments.map((e) => {
          const isOpen = expanded === e.enrollment_id;
          return (
            <div key={e.enrollment_id} className="rounded-2xl border border-sand-300 bg-white/90">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : e.enrollment_id)}
                className="flex w-full items-center justify-between p-4 text-left"
              >
                <div>
                  <div className="font-semibold text-sand-950">{e.entity_name}</div>
                  <div className="text-xs text-sand-600">
                    {e.distributor} · {formatAcres(e.total_acreage)} total / {formatAcres(e.billed_acreage)} billed · {e.tote_count} totes
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full border border-sand-400 px-3 py-1 text-xs font-semibold capitalize text-sand-700">
                    {e.status.replace("_", " ")}
                  </span>
                  <DemoBadge />
                  <span className="text-sand-500">{isOpen ? "▲" : "▼"}</span>
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-sand-200 p-4 text-sm">
                  <div className="mb-3 grid grid-cols-2 gap-3 text-xs text-sand-600">
                    <div>Submitted: {formatDate(e.submitted_at)}</div>
                    <div>Bill of sale: {formatDate(e.bill_of_sale_at)}</div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-sand-500">Submitted</div>
                      <ul className="space-y-1">
                        {e.docs_received.map((d) => (
                          <li key={d} className="flex items-center gap-2 text-sand-800">
                            <span className="text-moss">✓</span> {d}
                          </li>
                        ))}
                        {e.docs_received.length === 0 && <li className="text-sand-500">None yet</li>}
                      </ul>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-sand-500">Still needed</div>
                      <ul className="space-y-1">
                        {e.docs_needed.map((d) => (
                          <li key={d} className="flex items-center gap-2 text-sand-800">
                            <span className="text-rust">•</span> {d}
                          </li>
                        ))}
                        {e.docs_needed.length === 0 && <li className="text-sand-500">Nothing outstanding</li>}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </Shell>
  );
}

function Shell({ opCode, children }: { opCode?: string; children: React.ReactNode }) {
  return (
    <div>
      <Header section="Grower Dashboard" />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link to={`/farmer/${opCode}`} className="text-sm font-semibold text-gold-800 hover:underline">
          ← Back to project status
        </Link>
        <h1 className="mb-6 mt-1 text-3xl">Enrollments</h1>
        {children}
      </main>
    </div>
  );
}
