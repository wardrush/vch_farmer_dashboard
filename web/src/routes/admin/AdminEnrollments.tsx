import { Fragment, useEffect, useMemo, useState } from "react";
import { Header } from "../../components/Header";
import { StatCard } from "../../components/StatCard";
import { getEnrollmentOverlay, updateEnrollmentDocs } from "../../lib/api";
import { formatAcres, formatDate } from "../../lib/format";
import type { EnrollmentRecord } from "../../types";

const DOC_CHECKLIST = ["FSA Form 578", "Signed landholder agreement", "W-9", "Bill of sale"];

type EnrollmentRow = EnrollmentRecord;

export function AdminEnrollments() {
  const [rows, setRows] = useState<EnrollmentRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    setLoading(true);
    const all = (await fetch("/data/admin/enrollments-all.json").then((r) => r.json())) as EnrollmentRecord[];
    const merged = all.map((e) => {
      const overlay = getEnrollmentOverlay(e.enrollment_id);
      return overlay ? { ...e, docs_received: overlay.docs_received, docs_needed: overlay.docs_needed } : e;
    });
    setRows(merged);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const rollup = useMemo(() => {
    const totalAcres = rows.reduce((s, r) => s + r.total_acreage, 0);
    const missingDocs = rows.filter((r) => r.docs_needed.length > 0).length;
    return { totalEnrollments: rows.length, totalAcres, missingDocs };
  }, [rows]);

  async function toggleDoc(row: EnrollmentRow, doc: string) {
    const received = row.docs_received.includes(doc);
    const docs_received = received ? row.docs_received.filter((d) => d !== doc) : [...row.docs_received, doc];
    const docs_needed = DOC_CHECKLIST.filter((d) => !docs_received.includes(d));
    await updateEnrollmentDocs({ enrollment_id: row.enrollment_id, docs_received, docs_needed });
    setRows((prev) => prev.map((r) => (r.enrollment_id === row.enrollment_id ? { ...r, docs_received, docs_needed } : r)));
  }

  return (
    <div>
      <Header section="Admin" />
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <h1 className="text-3xl">Enrollments</h1>
        <p className="text-sm text-sand-600">
          The backing view for the farmer&rsquo;s Enrollments page — farmers see this read-only; edits here go live
          immediately.
        </p>

        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total enrollments" value={rollup.totalEnrollments} />
          <StatCard label="Total acres" value={formatAcres(rollup.totalAcres)} />
          <StatCard label="Ops with missing docs" value={rollup.missingDocs} />
        </div>

        {loading ? (
          <p className="text-sand-600">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-sand-300">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-sand-100">
                <tr className="text-left">
                  <th className="px-3 py-2">Farmer</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Op code</th>
                  <th className="px-3 py-2">Distributor</th>
                  <th className="px-3 py-2">Total ac</th>
                  <th className="px-3 py-2">Billed ac</th>
                  <th className="px-3 py-2">Totes</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Bill of sale</th>
                  <th className="px-3 py-2">Submitted</th>
                  <th className="px-3 py-2">Docs</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isOpen = openId === r.enrollment_id;
                  const unresolved = r.op_code === "UNRESOLVED";
                  return (
                    <Fragment key={r.enrollment_id}>
                      <tr
                        className={`cursor-pointer border-t border-sand-200 ${i % 2 === 1 ? "bg-sand-50/60" : ""} hover:bg-sand-100`}
                        onClick={() => setOpenId(isOpen ? null : r.enrollment_id)}
                      >
                        <td className="px-3 py-2">{r.farmer_name}</td>
                        <td className="px-3 py-2">{r.entity_name}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                              unresolved ? "border-rust bg-rust/10 text-rust" : "border-sand-400 text-sand-700"
                            }`}
                          >
                            {r.op_code}
                          </span>
                        </td>
                        <td className="px-3 py-2">{r.distributor}</td>
                        <td className="px-3 py-2">{formatAcres(r.total_acreage)}</td>
                        <td className="px-3 py-2">{formatAcres(r.billed_acreage)}</td>
                        <td className="px-3 py-2">{r.tote_count}</td>
                        <td className="px-3 py-2 capitalize">{r.status.replace("_", " ")}</td>
                        <td className="px-3 py-2">{formatDate(r.bill_of_sale_at)}</td>
                        <td className="px-3 py-2">{formatDate(r.submitted_at)}</td>
                        <td className="px-3 py-2">
                          {r.docs_needed.length === 0 ? (
                            <span className="text-moss">{r.docs_received.length}/{DOC_CHECKLIST.length} received</span>
                          ) : (
                            <span className="text-rust">{r.docs_received.length}/{DOC_CHECKLIST.length} received</span>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={11} className="border-t border-sand-200 bg-sand-50 p-4">
                            <div className="flex flex-wrap gap-3">
                              {DOC_CHECKLIST.map((doc) => {
                                const received = r.docs_received.includes(doc);
                                return (
                                  <label
                                    key={doc}
                                    className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                                      received ? "border-moss bg-moss/10 text-moss" : "border-sand-400 bg-white text-sand-700"
                                    }`}
                                  >
                                    <input type="checkbox" checked={received} onChange={() => toggleDoc(r, doc)} />
                                    {doc}
                                  </label>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
