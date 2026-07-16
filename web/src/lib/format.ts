export function formatAcres(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })} ac`;
}

export function formatTonnes(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} tonnes C`;
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function formatUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s + "T00:00:00");
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
