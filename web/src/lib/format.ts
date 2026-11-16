// Dates are handled as local "YYYY-MM-DD" strings (Asia/Jerusalem on the user's phone).

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function today(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toISODate(new Date(y, m - 1, d + days));
}

const dayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const t = today();
  const prefix = iso === t ? "היום · " : iso === addDays(t, 1) ? "מחר · " : "";
  return `${prefix}יום ${dayNames[date.getDay()]} ${d}/${m}`;
}

export function shortTime(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${Number(n).toLocaleString("he-IL", { maximumFractionDigits: 2 })} ₪`;
}

export function monthRange(month: string): { from: string; to: string } {
  // month = "YYYY-MM"
  const [y, m] = month.split("-").map(Number);
  const from = toISODate(new Date(y, m - 1, 1));
  const to = toISODate(new Date(y, m, 0));
  return { from, to };
}
