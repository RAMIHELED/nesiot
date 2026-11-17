import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "../supabase";
import { useOrgId } from "../lib/session";
import { money, today } from "../lib/format";
import type { Customer } from "../types";

type Draft = { name: string; phone: string; email: string; kind: "private" | "company"; notes: string };

type Balance = {
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

const toDraft = (c?: Customer): Draft => ({
  name: c?.name ?? "",
  phone: c?.phone ?? "",
  email: c?.email ?? "",
  kind: c?.kind ?? "private",
  notes: c?.notes ?? "",
});

const toRow = (d: Draft) => ({
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
const shortDate = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

export default function Customers() {
  const orgId = useOrgId();
  const [list, setList] = useState<Customer[]>([]);
  const [balances, setBalances] = useState<Map<string, Balance>>(new Map());
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"debt" | "name">("debt");
  const [onlyDebt, setOnlyDebt] = useState(false);
  const [newDraft, setNewDraft] = useState<Draft>(toDraft());
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(toDraft());
  const [error, setError] = useState<string | null>(null);

  const load = () => {
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

  const startEdit = (c: Customer) => {
    setEditId(c.id);
    setEdit(toDraft(c));
    setError(null);
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("customers").update(toRow(edit)).eq("id", editId);
    if (error) return setError(error.message);
    setEditId(null);
    load();
  };

  const remove = async (c: Customer) => {
    const { count } = await supabase.from("rides").select("id", { count: "exact", head: true }).eq("customer_id", c.id);
    if (count && count > 0) {
      setError(`ל${c.name} יש ${count} נסיעות במערכת, ולכן אי אפשר למחוק אותו. אפשר לערוך את הפרטים.`);
      return;
    }
    if (!window.confirm(`למחוק את ${c.name}?`)) return;
    const { error } = await supabase.from("customers").delete().eq("id", c.id);
    if (error) return setError(error.message);
    setEditId(null);
    load();
  };

  const debtOf = (id: string) => balances.get(id)?.balance ?? 0;
  const totalDebt = [...balances.values()].reduce((s, b) => s + Math.max(0, b.balance), 0);
  const debtors = [...balances.values()].filter((b) => b.balance > 0).length;

  const shown = useMemo(() => {
    const f = list.filter((c) =>
      (!q || c.name.includes(q) || (c.phone ?? "").includes(q)) && (!onlyDebt || debtOf(c.id) > 0));
    return sort === "debt"
      ? [...f].sort((a, b) => debtOf(b.id) - debtOf(a.id) || a.name.localeCompare(b.name, "he"))
      : f;
  }, [list, balances, q, sort, onlyDebt]);

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

      <input placeholder="חיפוש לפי שם או טלפון" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="row">
        <div className="seg">
          <button className={sort === "debt" ? "on" : ""} onClick={() => setSort("debt")}>לפי חוב</button>
          <button className={sort === "name" ? "on" : ""} onClick={() => setSort("name")}>לפי שם</button>
        </div>
        <label className="row check small">
          <input type="checkbox" checked={onlyDebt} onChange={(e) => setOnlyDebt(e.target.checked)} />
          רק חייבים
        </label>
      </div>
      {error && <p className="error">{error}</p>}

      <ul className="cards">
        {shown.map((c) => {
          const b = balances.get(c.id);
          const age = daysSince(b?.oldest_unpaid_date ?? null);
          const old = b && b.balance > 0 && age !== null && age > OLD_DEBT_DAYS;
          return editId === c.id ? (
            <li key={c.id} className="panel stack">
              <form onSubmit={saveEdit} className="stack">
                <CustomerFields d={edit} set={setEdit} />
                <div className="row">
                  <button className="btn primary">שמירה</button>
                  <button type="button" className="btn" onClick={() => setEditId(null)}>סגירה</button>
                  <button type="button" className="btn danger" onClick={() => remove(c)}>מחיקה</button>
                </div>
              </form>
              {balances.size > 0 && <CustomerAccount customer={c} balance={b} onChange={load} />}
            </li>
          ) : (
            <li key={c.id} className={`card clickable ${old ? "debt-old" : ""}`} onClick={() => startEdit(c)}>
              <div className="row between">
                <strong>{c.name}</strong>
                {b && b.balance > 0
                  ? <span className={`badge ${old ? "badge-debt-old" : "badge-debt"}`}>חוב {money(b.balance)}</span>
                  : b && b.balance < 0
                    ? <span className="badge">זכות {money(-b.balance)}</span>
                    : <span className="badge">{c.kind === "company" ? "חברה" : "פרטי"}</span>}
              </div>
              <div className="row between small muted">
                <span>{c.phone && <span dir="ltr">{c.phone}</span>}</span>
                {b && b.balance > 0 && age !== null && (
                  <span>{old ? "⚠️ " : ""}חוב הכי ותיק: {age} ימים</span>
                )}
              </div>
              {c.notes && <span className="small muted">{c.notes}</span>}
            </li>
          );
        })}
      </ul>
      <p className="small muted">לחיצה על לקוח פותחת עריכה, יתרה ורישום תשלום. חוב = נסיעות שכבר בוצעו פחות תשלומים. חוב ותיק מ-{OLD_DEBT_DAYS} יום מסומן באדום.</p>

      <form onSubmit={add} className="panel stack">
        <strong>לקוח חדש</strong>
        <CustomerFields d={newDraft} set={setNewDraft} />
        <button className="btn primary">הוספה</button>
      </form>
    </div>
  );
}

/** Balance, record a payment, recent payments */
function CustomerAccount({ customer, balance, onChange }: { customer: Customer; balance?: Balance; onChange: () => void }) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("transfer");
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const loadPayments = () =>
    supabase.from("customer_payments").select("id, amount, paid_on, method, note, ride_id")
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

      <form onSubmit={pay} className="stack">
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
      </form>

      {payments.length > 0 && (
        <div className="stack">
          <span className="small muted">תשלומים אחרונים</span>
          {payments.map((p) => (
            <div key={p.id} className="row between small">
              <span>
                {shortDate(p.paid_on)} · {money(p.amount)} · {PAYMENT_METHODS[p.method ?? "other"] ?? ""}
                {p.ride_id ? " · במקום" : ""}{p.note ? ` · ${p.note}` : ""}
              </span>
              <button type="button" className="btn link small" onClick={() => removePayment(p)}>מחיקה</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomerFields({ d, set }: { d: Draft; set: (d: Draft) => void }) {
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
