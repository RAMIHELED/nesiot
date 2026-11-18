// Customer statement: which past rides are still unpaid, and the WhatsApp text.
// Same rule as the customer_balances view: debt = past active rides − all payments.
// A "paid on the spot" payment covers its own ride first; everything else is
// counted against the oldest rides first (FIFO).

export type StmtRide = {
  id: string;
  ride_date: string;
  ride_time: string | null;
  pickup: string | null;
  dropoff: string | null;
  price: number | null;
  status: "active" | "cancelled";
};

export type StmtPayment = { amount: number; ride_id: string | null; paid_on: string };

export type RideDue = StmtRide & { due: number; covered: number };

const shortDate = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");
const fullDate = (iso: string) => iso.split("-").reverse().join("/");
const nis = (n: number) => `${Number(n).toLocaleString("he-IL", { maximumFractionDigits: 2 })} ₪`;
const route = (r: StmtRide) => [r.pickup, r.dropoff].filter(Boolean).join(" ← ") || "נסיעה";

/** Past active rides with how much of each is still owed. */
export function allocate(rides: StmtRide[], payments: StmtPayment[], todayIso: string): RideDue[] {
  const past = rides
    .filter((r) => r.status === "active" && r.ride_date <= todayIso)
    .sort((a, b) => a.ride_date.localeCompare(b.ride_date) || (a.ride_time ?? "").localeCompare(b.ride_time ?? ""));
  const out = past.map((r) => ({ ...r, covered: 0, due: Number(r.price ?? 0) }));
  let pool = 0;
  for (const p of payments) {
    const r = p.ride_id ? out.find((x) => x.id === p.ride_id) : undefined;
    if (r) {
      const use = Math.min(r.due, Number(p.amount));
      r.covered += use;
      r.due -= use;
      pool += Number(p.amount) - use;
    } else {
      pool += Number(p.amount);
    }
  }
  for (const r of out) {
    if (pool <= 0) break;
    const use = Math.min(r.due, pool);
    r.covered += use;
    r.due -= use;
    pool -= use;
  }
  return out.map((r) => ({ ...r, due: round(r.due), covered: round(r.covered) }));
}

const round = (n: number) => Math.round(n * 100) / 100;

/** WhatsApp text listing the rides still open and the total to pay. */
export function openDebtText(customerName: string, orgName: string, dues: RideDue[], balance: number, todayIso: string): string {
  const open = dues.filter((r) => r.due > 0);
  const lines = [
    `שלום ${customerName},`,
    `דף חשבון מ${orgName} נכון ל-${fullDate(todayIso)}:`,
    "",
    ...open.map((r) =>
      `• ${shortDate(r.ride_date)} · ${route(r)} · ${nis(r.due)}${r.covered > 0 ? ` (יתרה מתוך ${nis(Number(r.price ?? 0))})` : ""}`),
    "",
    `סה״כ לתשלום: ${nis(Math.max(0, balance))}`,
    "תודה!",
  ];
  return lines.join("\n");
}

/** WhatsApp text with all rides of one month (YYYY-MM) and the month total. */
export function monthText(customerName: string, orgName: string, rides: StmtRide[], month: string, balance: number): string {
  const inMonth = rides
    .filter((r) => r.status === "active" && r.ride_date.startsWith(month))
    .sort((a, b) => a.ride_date.localeCompare(b.ride_date) || (a.ride_time ?? "").localeCompare(b.ride_time ?? ""));
  const total = inMonth.reduce((s, r) => s + Number(r.price ?? 0), 0);
  const [y, m] = month.split("-");
  return [
    `שלום ${customerName},`,
    `ריכוז נסיעות מ${orgName} לחודש ${Number(m)}/${y}:`,
    "",
    ...inMonth.map((r) => `• ${shortDate(r.ride_date)}${r.ride_time ? ` ${r.ride_time.slice(0, 5)}` : ""} · ${route(r)} · ${nis(Number(r.price ?? 0))}`),
    "",
    `${inMonth.length} נסיעות · סה״כ החודש: ${nis(total)}`,
    balance > 0 ? `יתרת חוב כוללת עד היום: ${nis(balance)}` : "",
    "תודה!",
  ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n");
}
