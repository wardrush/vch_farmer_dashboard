import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  footnote?: ReactNode;
  demo?: boolean;
}

export function StatCard({ label, value, footnote, demo }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-sand-300 bg-white/80 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-sand-500">{label}</div>
        {demo && <span className="vch-demo-badge">demo</span>}
      </div>
      <div className="mt-1 text-2xl font-bold text-sand-950">{value}</div>
      {footnote && <div className="mt-2 text-xs text-sand-700">{footnote}</div>}
    </div>
  );
}
