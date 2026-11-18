import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabase";
import { useCanEdit, useOrgId } from "../lib/session";
import { money, today } from "../lib/format";
import type { Customer } from "../types";

export type Draft = { name: string; phone: string; email: string; kind: "private" | "company"; notes: string };

export type Balance = {
  customer_id: string;
  rides_total: number;
  paid_total: number;
  balance: number;
  oldest_unpaid_date: string | null;
  last_payment_date: string | null;
};

type Payment = {
  id: string;
  amount: number;
  paid_on: string;
  method: string | null;
  note: string | null;
  ride_id: string | null;
  collected_by?: string | null;
};

export const PAYMENT_METHODS: Record<string, string> = {
  cash: "מזומן",
  transfer: "העברה",
  bit: "ביט",
  card: "אשראי",
  check: "צ׳ק",
  other: "אחר",
};

const OLD_DEBT_DAYS = 30;
const REGULAR_RIDES = 3;   // "קבוע" = at least this many rides
const PAGE = 50;           // customers shown before "show more"

type Stats = { customer_id: string; rides_count: number; last_ride_date: string | null; next_ride_date: string | null };

export const toDraft = (c?: Customer): Draft => ({
  name: c?.name ?? "",
  phone: c?.phone ?? "",
  email: c?.email ?? "",
  kind: c?.kind ?? "private",
  notes: c?.notes ?? "",
});

export const toRow = (d: Draft) => ({
  name: d.name.trim(),
  phone: d.phone.trim() || null,
  email: d.email.trim() || null,
  kind: d.kind,
  notes: d.notes.trim() || null,
});

const daysSince = (iso: string | null) => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = today().split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 864e5);
};
export const shortDate = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

export default function Customers() {
  const orgId = useOrgId();
  const canEdit = useCanEdit();
  const [list, setList] = useState<Customer[]>([]);
  const [balances, setBalances] = useState<Map<string, Balance>>(new Map());
  const [q, setQ] = useState("");
  type Sort = "recent" | "debt" | "rides" | "name";
  type Filter = "all" | "debt" | "regular" | "once" | "none";
  const [sort, setSort] = useState<Sort>("recent");
  const [filter, setFilter] = useState<Filter>("all");
  const [stats, setStats] = useState<Map<string, Stats>>(new Map());
  const [limit, setLimit] = useState(PAGE);
  const [newDraft, setNewDraft] = useState<Draft>(toDraft());
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    supabase.from("customer_stats").select("*").eq("org_id", orgId)
      .then(({ data, error }) => {
        if (error) return; // migration 0012 not run yet
        setStats(new Map((data ?? []).map((x) => [x.customer_id, { ...x, rides_count: Number(x.rides_count) } as Stats])));
      });
    supabase.from("customers").select("*").eq("org_id", orgId).order("name")
      .then(({ data }) => setList((data ?? []) as Customer[]));
    supabase.from("customer_balances").select("*").eq("org_id", orgId)
      .then(({ data, error }) => {
        if (error) return; // migration 0008 not run yet: show the list without debts
        setBalances(new Map((data ?? []).map((b) => [b.customer_id, {
          ...b,
          rides_total: Number(b.rides_total),
          paid_total: Number(b.paid_total),
          balance: Number(b.balance),
        } as Balance])));
      });
  };

  useEffect(() => {
    load();
  }, [orgId]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("customers").insert({ org_id: orgId, ...toRow(newDraft) });
    if (error) return setError(error.message);
    setNewDraft(toDraft());
    setError(null);
    load();
  };

  const debtOf = (id: string) => balances.get(id)?.balance ?? 0;
  const totalDebt = [...balances.values()].reduce((s, b) => s + Math.max(0, b.balance), 0);
  const debtors = [...balances.values()].filter((b) => b.balance > 0).length;

  const countOf = (id: string) => stats.get(id)?.rides_count ?? 0;
  // Most recent activity: last ride, or the next one if it never rode yet
  const recentOf = (id: string) => stats.get(id)?.last_ride_date ?? stats.get(id)?.next_ride_date ?? "";
  const regularCount = list.filter((c) => countOf(c.id) >= REGULAR_RIDES).length;
  const onceCount = list.filter((c) => countOf(c.id) === 1).length;

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const digits = q.replace(/\D/g, "");
    const f = list.filter((c) => {
      const hay = `${c.name} ${c.email ?? ""} ${c.notes ?? ""}`.toLowerCase();
      const phoneDigits = (c.phone ?? "").replace(/\D/g, "");
      const textOk = words.every((w) => hay.includes(w)) || (digits.length >= 3 && phoneDigits.includes(digits));
      if (!textOk) return false;
      const n = countOf(c.id);
      return filter === "all" ? true
        : filter === "debt" ? debtOf(c.id) > 0
          : filter === "regular" ? n >= REGULAR_RIDES
            : filter === "once" ? n === 1
              : n === 0;
    });
    const byName = (a: Customer, b: Customer) => a.name.localeCompare(b.name, "he");
    const sorted = [...f].sort((a, b) =>
      sort === "debt" ? debtOf(b.id) - debtOf(a.id) || byName(a, b)
        : sort === "recent" ? recentOf(b.id).localeCompare(recentOf(a.id)) || byName(a, b)
          : sort === "rides" ? countOf(b.id) - countOf(a.id) || byName(a, b)
            : byName(a, b));
    return sorted;
  }, [list, balances, stats, q, sort, filter]);

  useEffect(() => setLimit(PAGE), [q, sort, filter]);

  return (
    <div className="stack">
      <h2>לקוחות</h2>

      {balances.size > 0 && (
        <div className="debt-summary">
          <div>
            <div className="small muted">סה״כ חובות פתוחים</div>
            <div className="debt-total">{money(totalDebt)}</div>
          </div>
          <div className="small muted">{debtors} לקוחות חייבים</div>
        </div>
      )}

      <input type="search" placeholder="🔍 חיפוש: שם, טלפון (גם חלקי), מייל או הערה" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="summary">
        <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>הכל <b>{list.length}</b></button>
        {debtors > 0 && <button className={`chip chip-unassigned ${filter === "debt" ? "on" : ""}`} onClick={() => setFilter("debt")}>חייבים <b>{debtors}</b></button>}
        {stats.size > 0 && <>
          <button className={`chip ${filter === "regular" ? "on" : ""}`} onClick={() => setFilter("regular")}>קבועים <b>{regularCount}</b></button>
          <button className={`chip ${filter === "once" ? "on" : ""}`} onClick={() => setFilter("once")}>חד-פעמיים <b>{onceCount}</b></button>
        </>}
      </div>
      <label className="row small sort-row">
        <span className="muted">מיון:</span>
        <select className="inline-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="recent">נסיעה אחרונה</option>
          <option value="debt">חוב</option>
          <option value="rides">הכי הרבה נסיעות</option>
          <option value="name">שם</option>
        </select>
        <span className="muted">{shown.length} לקוחות</span>
      </label>
      {error && <p className="error">{error}</p>}

      <ul className="cards">
        {shown.slice(0, limit).map((c) => {
          const b = balances.get(c.id);
          const age = daysSince(b?.oldest_unpaid_date ?? null);
          const old = b && b.balance > 0 && age !== null && age > OLD_DEBT_DAYS;
          return (
            <li key={c.id} className={`card clickable ${old ? "debt-old" : ""}`} onClick={() => navigate(`/customers/${c.id}`)}>
              <div className="row between">
                <strong>{c.name}</strong>
                {b && b.balance > 0
                  ? <span className={`badge ${old ? "badge-debt-old" : "badge-debt"}`}>חוב {money(b.balance)}</span>
                  : b && b.balance < 0
                    ? <span className="badge">זכות {money(-b.balance)}</span>
                    : <span className="badge">{c.kind === "company" ? "חברה" : "פרטי"}</span>}
              </div>
              <div className="row between small muted">
                <span>
                  {c.phone && <span dir="ltr">{c.phone}</span>}
                  {stats.get(c.id) && (
                    <>
                      {c.phone ? " · " : ""}
                      {countOf(c.id) === 0 ? "בלי נסיעות" : `${countOf(c.id)} נסיעות`}
                      {stats.get(c.id)!.last_ride_date ? ` · אחרונה ${shortDate(stats.get(c.id)!.last_ride_date!)}` : ""}
                      {stats.get(c.id)!.next_ride_date ? ` · הבאה ${shortDate(stats.get(c.id)!.next_ride_date!)}` : ""}
                    </>
                  )}
                </span>
                {b && b.balance > 0 && age !== null && (
                  <span>{old ? "⚠️ " : ""}חוב הכי ותיק: {age} ימים</span>
                )}
              </div>
              {c.notes && <span className="small muted">{c.notes}</span>}
            </li>
          );
        })}
      </ul>
      {shown.length > limit && (
        <button className="btn" onClick={() => setLimit(limit + PAGE)}>הצגת עוד {Math.min(PAGE, shown.length - limit)} לקוחות</button>
      )}
      <p className="small muted">לחיצה על לקוח פותחת את כרטיס הלקוח: היסטוריה, תשלומים ודף חשבון לוואטסאפ. חוב = נסיעות שכבר בוצעו פחות תשלומים. חוב ותיק מ-{OLD_DEBT_DAYS} יום מסומן באדום.</p>

      {canEdit && <form onSubmit={add} className="panel stack">
        <strong>לקוח חדש</strong>
        <CustomerFields d={newDraft} set={setNewDraft} />
        <button className="btn primary">הוספה</button>
      </form>}
    </div>
  );
}

/** Balance, record a payment, recent payments */
export function CustomerAccount({ customer, balance, onChange, canEdit }: { customer: Customer; balance?: Balance; onChange: () => void; canEdit: boolean }) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("transfer");
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const loadPayments = () =>
    supabase.from("customer_payments").select("id, amount, paid_on, method, note, ride_id, collected_by")
      .eq("customer_id", customer.id).order("paid_on", { ascending: false }).limit(10)
      .then(({ data }) => setPayments((data ?? []) as Payment[]));

  useEffect(() => {
    loadPayments();
  }, [customer.id]);

  const pay = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!(n > 0)) return setMsg("סכום לא תקין.");
    const { error } = await supabase.from("customer_payments").insert({
      org_id: customer.org_id, customer_id: customer.id, amount: n, method, paid_on: paidOn, note: note.trim() || null,
    });
    if (error) return setMsg(`שגיאה: ${error.message}`);
    setAmount("");
    setNote("");
    setMsg(`נרשם תשלום של ${money(n)} ✓`);
    loadPayments();
    onChange();
  };

  const removePayment = async (p: Payment) => {
    if (!window.confirm(`למחוק את התשלום של ${money(p.amount)} מ-${shortDate(p.paid_on)}?`)) return;
    await supabase.from("customer_payments").delete().eq("id", p.id);
    loadPayments();
    onChange();
  };

  const bal = balance?.balance ?? 0;

  return (
    <div className="stack account">
      <div className="row between">
        <strong>חשבון</strong>
        <span className={bal > 0 ? "debt-text" : "ok-text"}>
          {bal > 0 ? `חוב ${money(bal)}` : bal < 0 ? `זכות ${money(-bal)}` : "אין חוב ✓"}
        </span>
      </div>
      <div className="small muted">
        נסיעות שבוצעו {money(balance?.rides_total ?? 0)} · שולם {money(balance?.paid_total ?? 0)}
      </div>

      {canEdit && <form onSubmit={pay} className="stack">
        <div className="row">
          <label>סכום ₪
            <input type="number" step="0.01" min={0} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label>אמצעי
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <label>תאריך<input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
          <label>הערה<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="למשל: חשבונית 1052" /></label>
        </div>
        <div className="row">
          <button className="btn primary">רישום תשלום</button>
          {bal > 0 && (
            <button type="button" className="btn link small" onClick={() => setAmount(String(bal))}>כל החוב ({money(bal)})</button>
          )}
        </div>
        {msg && <p className="small">{msg}</p>}
      </form>}

      {payments.length > 0 && (
        <div className="stack">
          <span className="small muted">תשלומים אחרונים</span>
          {payments.map((p) => (
            <div key={p.id} className="row between small">
              <span>
                {shortDate(p.paid_on)} · {money(p.amount)} · {PAYMENT_METHODS[p.method ?? "other"] ?? ""}
                {p.collected_by ? " · נגבה ע״י הנהג" : p.ride_id ? " · במקום" : ""}{p.note && !p.collected_by ? ` · ${p.note}` : ""}
              </span>
              {canEdit && <button type="button" className="btn link small" onClick={() => removePayment(p)}>מחיקה</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CustomerFields({ d, set }: { d: Draft; set: (d: Draft) => void }) {
  return (
    <>
      <input required placeholder="שם" value={d.name} onChange={(e) => set({ ...d, name: e.target.value })} />
      <input placeholder="טלפון" dir="ltr" inputMode="tel" value={d.phone} onChange={(e) => set({ ...d, phone: e.target.value })} />
      <input placeholder="מייל" dir="ltr" type="email" value={d.email} onChange={(e) => set({ ...d, email: e.target.value })} />
      <select value={d.kind} onChange={(e) => set({ ...d, kind: e.target.value as Draft["kind"] })}>
        <option value="private">פרטי</option>
        <option value="company">חברה</option>
      </select>
      <input placeholder="הערות" value={d.notes} onChange={(e) => set({ ...d, notes: e.target.value })} />
    </>
  );
}
