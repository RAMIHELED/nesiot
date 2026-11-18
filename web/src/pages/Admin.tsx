// Platform admin: all businesses with usage, open a new business, status + notes.
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "../supabase";
import { useSession } from "../lib/session";
import { normalizeIlMobile } from "../lib/phone";
import { waLink } from "../lib/whatsapp";

type Biz = {
  id: string; name: string; created_at: string; plan_status: "trial" | "active" | "paused"; admin_notes: string | null;
  owners: string | null; users_count: number; drivers_count: number; customers_count: number;
  rides_total: number; rides_30d: number; last_ride_added: string | null;
  monthly_price: number | null; started_on: string; trial_ends: string | null; is_open: boolean;
  last_payment_date: string | null; last_payment_amount: number | null; paid_total: number;
};
type Payment = { id: string; amount: number; paid_on: string; method: string | null; note: string | null };
const METHODS: Record<string, string> = { transfer: "העברה", bit: "ביט", cash: "מזומן", card: "אשראי", check: "צ׳ק", other: "אחר" };
const dmyDate = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
const todayIso = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" })).toLocaleDateString("en-CA");
type Filter = "all" | "trial" | "active" | "closed";

const STATUS: Record<Biz["plan_status"], string> = { trial: "ניסיון", active: "פעיל (משלם)", paused: "מושהה" };
const SITE = "https://nesiot-pied.vercel.app";

const ago = (iso: string | null) => {
  if (!iso) return "אף פעם";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return days === 0 ? "היום" : days === 1 ? "אתמול" : `לפני ${days} ימים`;
};
const dmy = (iso: string) => new Date(iso).toLocaleDateString("he-IL");

const welcome = (ownerName: string, email: string) => [
  `היי${ownerName ? ` ${ownerName}` : ""}, פתחתי לך חשבון במערכת ניהול הנסיעות 🚖`,
  "",
  "כניסה (מהטלפון):",
  `1. פתח את הקישור: ${SITE}`,
  `2. הכנס את המייל: ${email}`,
  "3. הקלד את הקוד שתקבל במייל",
  "4. בכרום: ⋮ ← \"הוספה למסך הבית\", ככה זה נפתח כמו אפליקציה",
  "5. במסך \"הגדרות\": \"הפעלת התראות במכשיר זה\"",
  "",
  "אני זמין לכל שאלה 🙂",
].join("\n");

export default function Admin() {
  const { isAdmin, loading, refreshOrgs, setOrgId } = useSession();
  const [list, setList] = useState<Biz[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", owner_email: "", owner_name: "", owner_phone: "", add_me: true, trial_days: "7", monthly_price: "250" });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; email: string; owner_name: string; phone: string; org_id: string; existed: boolean } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: "", status: "trial" as Biz["plan_status"], notes: "", price: "", started_on: "", trial_ends: "" });
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pay, setPay] = useState({ amount: "", paid_on: todayIso(), method: "transfer", note: "" });
  const [filter, setFilter] = useState<Filter>("all");

  const load = () =>
    supabase.rpc("admin_businesses").then(({ data, error }) => {
      if (error) return setError(error.message.includes("admin_businesses") ? "צריך להריץ את מיגרציה 0014" : error.message);
      setList((data ?? []) as Biz[]);
    });

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (loading) return <p className="muted">טוען…</p>;
  if (!isAdmin) return <Navigate to="/" replace />;

  const phoneBad = form.owner_phone.trim() !== "" && !normalizeIlMobile(form.owner_phone);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (phoneBad) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("admin-create-business", {
      body: { ...form, owner_phone: normalizeIlMobile(form.owner_phone) ?? null,
        trial_days: Number(form.trial_days || 0), monthly_price: form.monthly_price === "" ? null : Number(form.monthly_price) },
    });
    setBusy(false);
    if (error) {
      const ctx = (error as { context?: Response }).context;
      const detail = ctx ? await ctx.json().then((b) => b?.error).catch(() => null) : null;
      return setError(detail || error.message);
    }
    setCreated({
      name: form.name.trim(), email: form.owner_email.trim().toLowerCase(), owner_name: form.owner_name.trim(),
      phone: form.owner_phone, org_id: data.org_id, existed: data.owner_existed,
    });
    setForm({ name: "", owner_email: "", owner_name: "", owner_phone: "", add_me: true, trial_days: "7", monthly_price: "250" });
    load();
    refreshOrgs();
  };

  const loadPayments = (orgId: string) =>
    supabase.rpc("admin_payments", { p_org: orgId }).then(({ data }) =>
      setPayments(((data ?? []) as Payment[]).map((p) => ({ ...p, amount: Number(p.amount) }))));

  const startEdit = (b: Biz) => {
    setEditId(b.id);
    setEdit({
      name: b.name, status: b.plan_status, notes: b.admin_notes ?? "",
      price: b.monthly_price == null ? "" : String(b.monthly_price), started_on: b.started_on ?? "", trial_ends: b.trial_ends ?? "",
    });
    setPay({ amount: b.monthly_price ? String(b.monthly_price) : "", paid_on: todayIso(), method: "transfer", note: "" });
    setPayments([]);
    loadPayments(b.id);
  };

  const addPayment = async () => {
    const n = Number(pay.amount);
    if (!(n > 0) || !editId) return setError("סכום לא תקין");
    const { error } = await supabase.rpc("admin_add_payment", {
      p_org: editId, p_amount: n, p_paid_on: pay.paid_on || null, p_method: pay.method, p_note: pay.note,
    });
    if (error) return setError(error.message);
    setError(null);
    setEdit((e) => ({ ...e, status: "active" }));
    setPay((p) => ({ ...p, note: "" }));
    loadPayments(editId);
    load();
  };

  const deletePayment = async (id: string) => {
    if (!window.confirm("למחוק את התשלום?") || !editId) return;
    const { error } = await supabase.rpc("admin_delete_payment", { p_id: id });
    if (error) return setError(error.message);
    loadPayments(editId);
    load();
  };

  const saveEdit = async () => {
    const { error } = await supabase.rpc("admin_update_business", {
      p_org: editId, p_name: edit.name, p_status: edit.status, p_notes: edit.notes,
      p_price: edit.price === "" ? null : Number(edit.price),
      p_started_on: edit.started_on || null, p_trial_ends: edit.trial_ends || null,
    });
    if (error) return setError(error.message);
    setEditId(null);
    load();
    refreshOrgs();
  };

  const totals = {
    biz: list.length,
    paying: list.filter((b) => b.plan_status === "active").length,
    monthly: list.filter((b) => b.plan_status === "active").reduce((s, b) => s + Number(b.monthly_price ?? 0), 0),
    rides30: list.reduce((s, b) => s + b.rides_30d, 0),
  };
  const shown = list.filter((b) =>
    filter === "all" ? true
      : filter === "closed" ? !b.is_open
        : filter === "trial" ? b.is_open && b.plan_status === "trial"
          : b.is_open && b.plan_status === "active");

  return (
    <div className="stack">
      <Link to="/settings" className="small">→ הגדרות</Link>
      <h2>ניהול עסקים</h2>
      <div className="summary">
        <span className="chip">עסקים <b>{totals.biz}</b></span>
        <span className="chip">משלמים <b>{totals.paying}</b></span>
        <span className="chip">הכנסה חודשית <b>{totals.monthly.toLocaleString("he-IL")} ₪</b></span>
        <span className="chip">נסיעות ב-30 יום <b>{totals.rides30}</b></span>
      </div>
      {error && <p className="error">{error}</p>}

      {/* Open a business */}
      <form onSubmit={create} className="panel stack">
        <strong>פתיחת עסק חדש</strong>
        <input required placeholder="שם העסק (למשל: הסעות משה)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input required type="email" dir="ltr" placeholder="מייל של בעל העסק" value={form.owner_email}
          onChange={(e) => setForm({ ...form, owner_email: e.target.value })} />
        <div className="row">
          <input placeholder="שם בעל העסק" value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} />
          <input placeholder="נייד (לא חובה)" dir="ltr" inputMode="tel" value={form.owner_phone}
            onChange={(e) => setForm({ ...form, owner_phone: e.target.value })} />
        </div>
        {phoneBad && <span className="small error">מספר נייד לא תקין</span>}
        <div className="row">
          <label className="small">ימי ניסיון
            <input type="number" min={0} value={form.trial_days} onChange={(e) => setForm({ ...form, trial_days: e.target.value })} />
          </label>
          <label className="small">מחיר חודשי (₪)
            <input type="number" min={0} value={form.monthly_price} onChange={(e) => setForm({ ...form, monthly_price: e.target.value })} />
          </label>
        </div>
        <label className="row check small">
          <input type="checkbox" checked={form.add_me} onChange={(e) => setForm({ ...form, add_me: e.target.checked })} />
          הוסף אותי כמנהל בעסק (לתמיכה)
        </label>
        <button className="btn primary" disabled={busy}>{busy ? "פותח…" : "פתיחת העסק"}</button>
        <p className="small muted">נוצרים: העסק, משתמש לבעל העסק (נכנס עם קוד במייל) וכרטיס נהג "אני" על שמו. בסוף ימי הניסיון הגישה נסגרת לבד, אלא אם נרשם תשלום (0 = בלי הגבלה).</p>
      </form>

      {created && (
        <div className="panel stack">
          <strong className="ok-text">✓ העסק "{created.name}" נפתח</strong>
          {created.existed && <span className="small muted">למייל הזה כבר היה משתמש, הוא נוסף לעסק כבעלים.</span>}
          <div className="row">
            <a className="btn primary" target="_blank" rel="noreferrer"
              href={waLink(created.phone || null, welcome(created.owner_name, created.email))}>💬 שליחת הוראות כניסה</a>
            <button className="btn" onClick={() => { setOrgId(created.org_id); window.location.href = "/"; }}>מעבר לעסק</button>
          </div>
        </div>
      )}

      {/* All businesses */}
      <div className="summary">
        {([["all", "הכל"], ["trial", "בניסיון"], ["active", "משלמים"], ["closed", "סגורים"]] as [Filter, string][]).map(([k, label]) => (
          <button key={k} className={`chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>
            {label} <b>{k === "all" ? list.length : list.filter((b) => (k === "closed" ? !b.is_open : b.is_open && b.plan_status === k)).length}</b>
          </button>
        ))}
      </div>
      <ul className="cards">
        {shown.map((b) => editId === b.id ? (
          <li key={b.id} className="panel stack">
            <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as Biz["plan_status"] })}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <div className="row">
              <label className="small">מחיר חודשי (₪)
                <input type="number" min={0} value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} />
              </label>
              <label className="small">תאריך התחלה
                <input type="date" value={edit.started_on} onChange={(e) => setEdit({ ...edit, started_on: e.target.value })} />
              </label>
            </div>
            {edit.status === "trial" && (
              <label className="small">ניסיון עד (ריק = בלי הגבלה)
                <input type="date" value={edit.trial_ends} onChange={(e) => setEdit({ ...edit, trial_ends: e.target.value })} />
              </label>
            )}
            <textarea rows={2} placeholder="הערות (איש קשר, הסכמים…)" value={edit.notes}
              onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            <div className="row">
              <button className="btn primary" onClick={saveEdit}>שמירה</button>
              <button className="btn" onClick={() => setEditId(null)}>ביטול</button>
            </div>

            <div className="stack">
              <strong>תשלומים</strong>
              <div className="row">
                <input type="number" min={0} placeholder="סכום" style={{ maxWidth: 110 }} value={pay.amount}
                  onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
                <input type="date" value={pay.paid_on} onChange={(e) => setPay({ ...pay, paid_on: e.target.value })} />
                <select className="inline-select" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                  {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="row">
                <input placeholder="הערה (למשל: נובמבר)" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
                <button className="btn primary small" onClick={addPayment}>רישום תשלום</button>
              </div>
              <span className="small muted">רישום תשלום הופך את העסק ל"פעיל" ופותח את הגישה.</span>
              {payments.length === 0 ? <span className="small muted">עוד אין תשלומים.</span> : (
                <div className="stack small">
                  {payments.map((p) => (
                    <div key={p.id} className="row between">
                      <span>{dmyDate(p.paid_on)} · {p.amount.toLocaleString("he-IL")} ₪ · {METHODS[p.method ?? "other"] ?? p.method}{p.note ? ` · ${p.note}` : ""}</span>
                      <button className="btn link small" onClick={() => deletePayment(p.id)}>מחיקה</button>
                    </div>
                  ))}
                  <span className="muted">סה״כ שולם: {payments.reduce((s, p) => s + p.amount, 0).toLocaleString("he-IL")} ₪</span>
                </div>
              )}
            </div>
          </li>
        ) : (
          <li key={b.id} className="card clickable" onClick={() => startEdit(b)}>
            <div className="row between">
              <strong>{b.name}</strong>
              <span className={`badge ${b.plan_status === "active" ? "badge-self" : b.plan_status === "paused" ? "badge-debt-old" : ""}`}>{STATUS[b.plan_status]}</span>
            </div>
            <div className="small muted" dir="auto">{b.owners ?? "אין בעלים עדיין (לא נכנס)"}</div>
            <div className="small">
              {b.monthly_price != null ? `${Number(b.monthly_price).toLocaleString("he-IL")} ₪ לחודש` : "בלי מחיר"} · התחיל {dmyDate(b.started_on)}
              {b.plan_status === "trial" && b.trial_ends ? ` · ניסיון עד ${dmyDate(b.trial_ends)}` : ""}
            </div>
            <div className="small">
              {b.last_payment_date
                ? <>תשלום אחרון: <strong>{dmyDate(b.last_payment_date)}</strong> ({Number(b.last_payment_amount).toLocaleString("he-IL")} ₪) · סה״כ {Number(b.paid_total).toLocaleString("he-IL")} ₪</>
                : <span className="muted">עוד לא שילם</span>}
              {!b.is_open && <strong className="debt-text"> · סגור</strong>}
            </div>
            <div className="small">
              {b.rides_30d} נסיעות ב-30 יום · {b.rides_total} סה״כ · נסיעה אחרונה נוספה {ago(b.last_ride_added)}
            </div>
            <div className="small muted">
              {b.drivers_count} נהגים · {b.customers_count} לקוחות · {b.users_count} משתמשים · נפתח {dmy(b.created_at)}
            </div>
            {b.admin_notes && <div className="small">📝 {b.admin_notes}</div>}
          </li>
        ))}
      </ul>
      <p className="small muted">לחיצה על עסק: שינוי שם, סטטוס והערות. הסטטוס הוא לסימון בלבד ולא חוסם גישה.</p>
    </div>
  );
}
