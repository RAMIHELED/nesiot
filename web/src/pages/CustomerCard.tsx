// Customer card: details, balance + payments, ride history, statement to WhatsApp.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../supabase";
import { useCanEdit, useSession } from "../lib/session";
import { money, today } from "../lib/format";
import { waLink, toWaPhone } from "../lib/whatsapp";
import { allocate, monthText, openDebtText, type StmtPayment, type StmtRide } from "../lib/statement";
import type { Customer } from "../types";
import { CustomerAccount, CustomerFields, shortDate, toDraft, toRow, type Balance, type Draft } from "./Customers";

type RideRow = StmtRide & { driver_id: string | null; drivers: { name: string } | null };

const HISTORY_PAGE = 30;
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${Number(m)}/${y}`;
};

export default function CustomerCard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const { org } = useSession();
  const t = today();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [balance, setBalance] = useState<Balance | undefined>();
  const [rides, setRides] = useState<RideRow[]>([]);
  const [payments, setPayments] = useState<StmtPayment[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(toDraft());
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"history" | "upcoming">("history");
  const [limit, setLimit] = useState(HISTORY_PAGE);
  const [stmtMode, setStmtMode] = useState<"debt" | "month">("debt");
  const [stmtMonth, setStmtMonth] = useState(t.slice(0, 7));
  const [copied, setCopied] = useState(false);

  const load = () => {
    if (!id) return;
    supabase.from("customers").select("*").eq("id", id).maybeSingle().then(({ data }) => {
      if (!data) return setNotFound(true);
      setCustomer(data as Customer);
      setDraft(toDraft(data as Customer));
    });
    supabase.from("customer_balances").select("*").eq("customer_id", id).maybeSingle().then(({ data }) => {
      if (data) setBalance({ ...data, rides_total: Number(data.rides_total), paid_total: Number(data.paid_total), balance: Number(data.balance) } as Balance);
    });
    supabase.from("rides")
      .select("id, ride_date, ride_time, pickup, dropoff, price, status, driver_id, drivers(name)")
      .eq("customer_id", id).order("ride_date", { ascending: false }).order("ride_time", { ascending: false })
      .then(({ data }) => setRides((data ?? []) as unknown as RideRow[]));
    supabase.from("customer_payments").select("amount, ride_id, paid_on").eq("customer_id", id)
      .then(({ data }) => setPayments((data ?? []).map((p) => ({ ...p, amount: Number(p.amount) })) as StmtPayment[]));
  };

  useEffect(load, [id]);

  const dues = useMemo(() => new Map(allocate(rides, payments, t).map((r) => [r.id, r])), [rides, payments, t]);
  const past = rides.filter((r) => r.ride_date <= t);
  const upcoming = rides.filter((r) => r.ride_date > t).reverse();
  const activePast = past.filter((r) => r.status === "active");
  const bal = balance?.balance ?? 0;

  // History grouped by month, with the month total
  const groups = useMemo(() => {
    const shown = past.slice(0, limit);
    const map = new Map<string, RideRow[]>();
    for (const r of shown) {
      const k = r.ride_date.slice(0, 7);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.entries()];
  }, [past, limit]);
  const monthTotal = (ym: string) => past
    .filter((r) => r.status === "active" && r.ride_date.startsWith(ym))
    .reduce((s, r) => s + Number(r.price ?? 0), 0);

  const months = useMemo(() => [...new Set(rides.filter((r) => r.status === "active").map((r) => r.ride_date.slice(0, 7)))].sort().reverse(), [rides]);

  const stmtText = customer
    ? stmtMode === "debt"
      ? openDebtText(customer.name, org?.name ?? "", [...dues.values()], bal, t)
      : monthText(customer.name, org?.name ?? "", rides, stmtMonth, bal)
    : "";

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("customers").update(toRow(draft)).eq("id", id);
    if (error) return setError(error.message);
    setEditing(false);
    setError(null);
    load();
  };

  const remove = async () => {
    if (!customer) return;
    if (rides.length > 0) {
      return setError(`ל${customer.name} יש ${rides.length} נסיעות במערכת, ולכן אי אפשר למחוק אותו. אפשר לערוך את הפרטים.`);
    }
    if (!window.confirm(`למחוק את ${customer.name}?`)) return;
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) return setError(error.message);
    navigate("/customers");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(stmtText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("ההעתקה לא הצליחה. אפשר לסמן את הטקסט ולהעתיק ידנית.");
    }
  };

  if (notFound) return <div className="stack"><p>הלקוח לא נמצא.</p><Link to="/customers">← לקוחות</Link></div>;
  if (!customer) return <p className="muted">טוען…</p>;

  const wa = toWaPhone(customer.phone);

  return (
    <div className="stack">
      <Link to="/customers" className="small">→ לכל הלקוחות</Link>

      {/* Details */}
      <div className="panel stack">
        {editing ? (
          <form onSubmit={save} className="stack">
            <CustomerFields d={draft} set={setDraft} />
            <div className="row">
              <button className="btn primary">שמירה</button>
              <button type="button" className="btn" onClick={() => { setEditing(false); setDraft(toDraft(customer)); }}>ביטול</button>
              <button type="button" className="btn danger" onClick={remove}>מחיקה</button>
            </div>
          </form>
        ) : (
          <>
            <div className="row between">
              <h2 style={{ margin: 0 }}>{customer.name}</h2>
              <span className="badge">{customer.kind === "company" ? "חברה" : "פרטי"}</span>
            </div>
            {customer.phone && (
              <div className="row">
                <span dir="ltr">{customer.phone}</span>
                <a className="btn small" href={`tel:${customer.phone}`}>📞 חיוג</a>
                {wa && <a className="btn small" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">💬 וואטסאפ</a>}
              </div>
            )}
            {customer.email && <span className="small" dir="ltr">{customer.email}</span>}
            {customer.notes && <span className="small muted">{customer.notes}</span>}
            <div className="small muted">
              {activePast.length} נסיעות שבוצעו
              {activePast[0] ? ` · אחרונה ${shortDate(activePast[0].ride_date)}` : ""}
              {upcoming[0] ? ` · הבאה ${shortDate(upcoming[0].ride_date)}` : ""}
            </div>
            {canEdit && (
              <div className="row">
                <button className="btn" onClick={() => setEditing(true)}>עריכת פרטים</button>
                <Link className="btn primary" to={`/rides/new?customer=${customer.id}`}>+ נסיעה חדשה</Link>
              </div>
            )}
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      {/* Balance + payments */}
      <div className="panel">
        <CustomerAccount customer={customer} balance={balance} onChange={load} canEdit={canEdit} />
      </div>

      {/* Statement */}
      <div className="panel stack">
        <strong>דף חשבון לשליחה</strong>
        <div className="summary">
          <button className={`chip ${stmtMode === "debt" ? "on" : ""}`} onClick={() => setStmtMode("debt")}>חוב פתוח</button>
          <button className={`chip ${stmtMode === "month" ? "on" : ""}`} onClick={() => setStmtMode("month")}>ריכוז חודשי</button>
          {stmtMode === "month" && (
            <select className="inline-select" value={stmtMonth} onChange={(e) => setStmtMonth(e.target.value)}>
              {(months.includes(stmtMonth) ? months : [stmtMonth, ...months]).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          )}
        </div>
        {stmtMode === "debt" && bal <= 0 ? (
          <p className="small ok-text">אין חוב פתוח ✓</p>
        ) : (
          <>
            <pre className="statement">{stmtText}</pre>
            <div className="row">
              <a className="btn primary" href={waLink(customer.phone, stmtText)} target="_blank" rel="noreferrer">💬 שליחה בוואטסאפ</a>
              <button className="btn" onClick={copy}>{copied ? "הועתק ✓" : "העתקה"}</button>
            </div>
            {!wa && <p className="small muted">אין ללקוח טלפון נייד תקין: וואטסאפ ייפתח לבחירת איש קשר.</p>}
          </>
        )}
      </div>

      {/* Rides */}
      <div className="stack">
        <div className="summary">
          <button className={`chip ${tab === "history" ? "on" : ""}`} onClick={() => setTab("history")}>היסטוריה <b>{past.length}</b></button>
          <button className={`chip ${tab === "upcoming" ? "on" : ""}`} onClick={() => setTab("upcoming")}>עתידיות <b>{upcoming.length}</b></button>
        </div>

        {tab === "upcoming" && (
          upcoming.length === 0 ? <p className="small muted">אין נסיעות עתידיות.</p> : (
            <ul className="cards">{upcoming.map((r) => <RideItem key={r.id} r={r} />)}</ul>
          )
        )}

        {tab === "history" && (
          past.length === 0 ? <p className="small muted">עוד אין נסיעות.</p> : (
            <>
              {groups.map(([ym, list]) => (
                <div key={ym} className="stack">
                  <div className="row between small muted month-head">
                    <strong>{monthLabel(ym)}</strong>
                    <span>{money(monthTotal(ym))}</span>
                  </div>
                  <ul className="cards">
                    {list.map((r) => <RideItem key={r.id} r={r} due={dues.get(r.id)?.due} />)}
                  </ul>
                </div>
              ))}
              {past.length > limit && (
                <button className="btn" onClick={() => setLimit(limit + HISTORY_PAGE)}>הצגת עוד</button>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}

function RideItem({ r, due }: { r: RideRow; due?: number }) {
  const navigate = useNavigate();
  const cancelled = r.status === "cancelled";
  const paidState = due === undefined ? null
    : due <= 0 ? <span className="badge">שולם ✓</span>
      : due < Number(r.price ?? 0) ? <span className="badge badge-debt">נותר {money(due)}</span>
        : <span className="badge badge-debt">לא שולם</span>;
  return (
    <li className={`card clickable ${cancelled ? "cancelled" : ""}`} onClick={() => navigate(`/rides/${r.id}`)}>
      <div className="row between">
        <span>
          <strong>{shortDate(r.ride_date)}</strong>{r.ride_time ? ` ${r.ride_time.slice(0, 5)}` : ""}
          {cancelled ? " · בוטלה" : ""}
        </span>
        <span>{money(r.price)}</span>
      </div>
      <div className="row between small muted">
        <span>{[r.pickup, r.dropoff].filter(Boolean).join(" ← ") || "—"}{r.drivers?.name ? ` · ${r.drivers.name}` : ""}</span>
        {!cancelled && paidState}
      </div>
    </li>
  );
}
