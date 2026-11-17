import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import { useCanEdit, useOrgId } from "../lib/session";
import { money, today } from "../lib/format";
import type { Customer, Driver, Ride } from "../types";

export type RecurringRide = {
  id: string;
  org_id: string;
  customer_id: string | null;
  driver_id: string | null;
  weekdays: number[];
  ride_time: string;
  start_date: string;
  end_date: string | null;
  pickup: string;
  dropoff: string;
  passengers: number | null;
  price: number | null;
  driver_cost: number | null;
  distance_km: number | null;
  duration_min: number | null;
  notes: string | null;
  active: boolean;
  customer: { name: string } | null;
  driver: { name: string; is_self: boolean } | null;
};

type Draft = {
  weekdays: number[];
  ride_time: string;
  start_date: string;
  end_date: string;
  customer_id: string;
  driver_id: string;
  pickup: string;
  dropoff: string;
  passengers: string;
  price: string;
  driver_cost: string;
  notes: string;
};

const DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

const emptyDraft = (): Draft => ({
  weekdays: [], ride_time: "", start_date: today(), end_date: "",
  customer_id: "", driver_id: "", pickup: "", dropoff: "",
  passengers: "", price: "", driver_cost: "", notes: "",
});

const toDraft = (t: RecurringRide): Draft => ({
  weekdays: t.weekdays,
  ride_time: t.ride_time.slice(0, 5),
  start_date: t.start_date,
  end_date: t.end_date ?? "",
  customer_id: t.customer_id ?? "",
  driver_id: t.driver_id ?? "",
  pickup: t.pickup,
  dropoff: t.dropoff,
  passengers: t.passengers?.toString() ?? "",
  price: t.price?.toString() ?? "",
  driver_cost: t.driver_cost?.toString() ?? "",
  notes: t.notes ?? "",
});

const num = (s: string) => (s.trim() === "" ? null : Number(s));
const str = (s: string) => (s.trim() === "" ? null : s.trim());
const dowOf = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};

export function daysLabel(days: number[]) {
  const sorted = [...days].sort();
  if (sorted.length === 7) return "כל יום";
  if (sorted.join() === "0,1,2,3,4") return "ראשון–חמישי";
  if (sorted.length === 1) return `כל יום ${DAY_NAMES[sorted[0]]}`;
  return sorted.map((d) => DAYS[d]).join(" ");
}

export default function Recurring() {
  const orgId = useOrgId();
  const canEdit = useCanEdit();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<RecurringRide[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [newDraft, setNewDraft] = useState<Draft>(emptyDraft());
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    supabase.from("recurring_rides")
      .select("*, customer:customers(name), driver:drivers(name, is_self)")
      .eq("org_id", orgId).order("active", { ascending: false }).order("ride_time")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setList((data ?? []) as RecurringRide[]);
        return (data ?? []) as RecurringRide[];
      });

  useEffect(() => {
    load().then((rows) => {
      const editParam = params.get("edit");
      const t = editParam && rows.find((r) => r.id === editParam);
      if (t) {
        setEditId(t.id);
        setEdit(toDraft(t));
      }
    });
    supabase.from("customers").select("*").eq("org_id", orgId).order("name")
      .then(({ data }) => setCustomers((data ?? []) as Customer[]));
    supabase.from("drivers").select("*").eq("org_id", orgId).eq("active", true)
      .order("is_self", { ascending: false }).order("name")
      .then(({ data }) => setDrivers((data ?? []) as Driver[]));
  }, [orgId]);

  // "Make recurring" from an existing ride: prefill the new template
  useEffect(() => {
    const from = params.get("from");
    if (!from) return;
    supabase.from("rides").select("*").eq("id", from).single().then(({ data }) => {
      if (!data) return;
      const r = data as Ride;
      setNewDraft({
        weekdays: [dowOf(r.ride_date)],
        ride_time: r.ride_time?.slice(0, 5) ?? "",
        start_date: r.ride_date > today() ? r.ride_date : today(),
        end_date: "",
        customer_id: r.customer_id ?? "",
        driver_id: r.driver_id ?? "",
        pickup: r.pickup ?? "",
        dropoff: r.dropoff ?? "",
        passengers: r.passengers?.toString() ?? "",
        price: r.price?.toString() ?? "",
        driver_cost: r.driver_cost?.toString() ?? "",
        notes: r.notes ?? "",
      });
      setNotice("מילאנו את הפרטים מהנסיעה. בחרו ימים ושמרו.");
      setParams({}, { replace: true });
    });
  }, []);

  const validate = (d: Draft) => {
    if (d.weekdays.length === 0) return "בחרו לפחות יום אחד בשבוע.";
    if (!d.ride_time) return "צריך שעת איסוף.";
    if (!d.pickup.trim() || !d.dropoff.trim()) return "צריך איסוף ויעד.";
    if (d.end_date && d.end_date < d.start_date) return "תאריך הסיום לפני תאריך ההתחלה.";
    return null;
  };

  // Distance for the route, so driver availability and reminders work well
  const measure = async (d: Draft) => {
    const { data } = await supabase.functions.invoke("estimate-distance", {
      body: { pickup: d.pickup, dropoff: d.dropoff, org_id: orgId },
    });
    return data?.distance_km != null
      ? { distance_km: data.distance_km as number, duration_min: (data.duration_min as number) ?? null }
      : { distance_km: null, duration_min: null };
  };

  const toRow = (d: Draft) => ({
    weekdays: [...d.weekdays].sort(),
    ride_time: d.ride_time,
    start_date: d.start_date || today(),
    end_date: d.end_date || null,
    customer_id: d.customer_id || null,
    driver_id: d.driver_id || null,
    pickup: d.pickup.trim(),
    dropoff: d.dropoff.trim(),
    passengers: num(d.passengers),
    price: num(d.price),
    driver_cost: num(d.driver_cost),
    notes: str(d.notes),
  });

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate(newDraft);
    if (v) return setError(v);
    setBusy(true);
    setError(null);
    setNotice(null);
    const dist = await measure(newDraft);
    const { error } = await supabase.from("recurring_rides").insert({ org_id: orgId, ...toRow(newDraft), ...dist });
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    const { data: created } = await supabase.rpc("generate_recurring_rides", { p_org: orgId, p_days: 14 });
    setBusy(false);
    setNewDraft(emptyDraft());
    setNotice(`נשמר ✓ נוצרו ${created ?? 0} נסיעות לשבועיים הקרובים.`);
    load();
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate(edit);
    if (v) return setError(v);
    const old = list.find((t) => t.id === editId)!;
    setBusy(true);
    setError(null);
    const routeChanged = old.pickup !== edit.pickup.trim() || old.dropoff !== edit.dropoff.trim();
    const dist = routeChanged ? await measure(edit) : {};
    const { error } = await supabase.from("recurring_rides").update({ ...toRow(edit), ...dist }).eq("id", editId);
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    const { data: created } = old.active
      ? await supabase.rpc("rebuild_recurring_ride", { p_template: editId, p_days: 14 })
      : { data: 0 };
    setBusy(false);
    setEditId(null);
    setNotice(old.active ? `עודכן ✓ הנסיעות מחר והלאה נבנו מחדש (${created ?? 0}). נסיעות של היום לא השתנו.` : "עודכן ✓");
    load();
  };

  const stop = async (t: RecurringRide) => {
    if (!window.confirm("להפסיק את הנסיעה הקבועה? הנסיעות שלה ממחר והלאה יימחקו (חוץ מכאלה שכבר חויבו או שולמו).")) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("stop_recurring_ride", { p_template: t.id });
    setBusy(false);
    if (error) return setError(error.message);
    setEditId(null);
    setNotice(`הופסקה ✓ נמחקו ${data ?? 0} נסיעות עתידיות.`);
    load();
  };

  const resume = async (t: RecurringRide) => {
    setBusy(true);
    await supabase.from("recurring_rides").update({ active: true }).eq("id", t.id);
    const { data } = await supabase.rpc("generate_recurring_rides", { p_org: orgId, p_days: 14 });
    setBusy(false);
    setNotice(`הופעלה מחדש ✓ נוצרו ${data ?? 0} נסיעות.`);
    load();
  };

  const remove = async (t: RecurringRide) => {
    if (!window.confirm("למחוק את התבנית? נסיעות שכבר נוצרו יישארו ביומן.")) return;
    const { error } = await supabase.from("recurring_rides").delete().eq("id", t.id);
    if (error) return setError(error.message);
    setEditId(null);
    load();
  };

  return (
    <div className="stack">
      <h2>נסיעות קבועות</h2>
      <p className="small muted">
        נסיעה שחוזרת בימים קבועים. המערכת יוצרת אותה ביומן שבועיים קדימה, וכל יום מתעדכן אוטומטית.
        אפשר לשנות או לבטל נסיעה בודדת ביומן בלי לגעת בשאר.
      </p>

      {error && <p className="error">{error}</p>}
      {notice && <p className="small">{notice}</p>}
      {list.length === 0 && <p className="muted center">אין עדיין נסיעות קבועות.</p>}

      <ul className="cards">
        {list.map((t) =>
          editId === t.id ? (
            <li key={t.id}>
              <form onSubmit={saveEdit} className="panel stack">
                <fieldset disabled={!canEdit} className="plain stack"><TemplateFields d={edit} set={setEdit} customers={customers} drivers={drivers} /></fieldset>
                <p className="small muted">שמירה תבנה מחדש את הנסיעות של התבנית ממחר והלאה. שינויים שעשיתם בנסיעה בודדת עתידית יוחלפו.</p>
                <div className="row">
                  {canEdit && <button className="btn primary" disabled={busy}>{busy ? "שומר…" : "שמירה"}</button>}
                  <button type="button" className="btn" onClick={() => setEditId(null)}>ביטול</button>
                  {canEdit && (t.active
                    ? <button type="button" className="btn danger" onClick={() => stop(t)}>הפסקה</button>
                    : <button type="button" className="btn danger" onClick={() => remove(t)}>מחיקה</button>)}
                </div>
              </form>
            </li>
          ) : (
            <li key={t.id} className={`card clickable ${t.active ? "" : "dim"}`}
              onClick={() => { setEditId(t.id); setEdit(toDraft(t)); setError(null); }}>
              <div className="row between">
                <strong>🔁 {daysLabel(t.weekdays)} · {t.ride_time.slice(0, 5)}</strong>
                <span className="badge">{t.active ? (t.driver ? (t.driver.is_self ? "אני" : t.driver.name) : "לא שובץ") : "מופסקת"}</span>
              </div>
              <div>{t.pickup} ← {t.dropoff}</div>
              <div className="row between small muted">
                <span>
                  {t.customer?.name ?? "ללא לקוח"}
                  {t.passengers ? ` · ${t.passengers} נוסעים` : ""}
                  {t.end_date ? ` · עד ${t.end_date.split("-").reverse().join("/")}` : ""}
                </span>
                <span>{money(t.price)}</span>
              </div>
              {!t.active && canEdit && (
                <button className="btn small" onClick={(e) => { e.stopPropagation(); resume(t); }}>הפעלה מחדש</button>
              )}
            </li>
          ),
        )}
      </ul>

      {canEdit && <form onSubmit={add} className="panel stack">
        <strong>נסיעה קבועה חדשה</strong>
        <TemplateFields d={newDraft} set={setNewDraft} customers={customers} drivers={drivers} />
        <button className="btn primary" disabled={busy}>{busy ? "שומר…" : "שמירה ויצירת נסיעות"}</button>
      </form>}
    </div>
  );
}

function TemplateFields({ d, set, customers, drivers }: {
  d: Draft; set: (d: Draft) => void; customers: Customer[]; drivers: Driver[];
}) {
  const toggleDay = (i: number) =>
    set({ ...d, weekdays: d.weekdays.includes(i) ? d.weekdays.filter((x) => x !== i) : [...d.weekdays, i] });
  return (
    <>
      <div className="stack">
        <span className="small muted">ימים</span>
        <div className="weekdays">
          {DAYS.map((label, i) => (
            <button type="button" key={i} className={`daybtn ${d.weekdays.includes(i) ? "on" : ""}`} onClick={() => toggleDay(i)}>
              {label}
            </button>
          ))}
        </div>
        <div className="row small">
          <button type="button" className="btn link small" onClick={() => set({ ...d, weekdays: [0, 1, 2, 3, 4] })}>א׳–ה׳</button>
          <button type="button" className="btn link small" onClick={() => set({ ...d, weekdays: [0, 1, 2, 3, 4, 5, 6] })}>כל יום</button>
        </div>
      </div>
      <div className="row">
        <label>שעת איסוף<input type="time" required value={d.ride_time} onChange={(e) => set({ ...d, ride_time: e.target.value })} /></label>
        <label>נוסעים<input type="number" min={1} inputMode="numeric" value={d.passengers} onChange={(e) => set({ ...d, passengers: e.target.value })} /></label>
      </div>
      <div className="row">
        <label>מתאריך<input type="date" value={d.start_date} onChange={(e) => set({ ...d, start_date: e.target.value })} /></label>
        <label>עד תאריך (לא חובה)<input type="date" value={d.end_date} onChange={(e) => set({ ...d, end_date: e.target.value })} /></label>
      </div>
      <label>
        לקוח
        <select value={d.customer_id} onChange={(e) => set({ ...d, customer_id: e.target.value })}>
          <option value="">— ללא —</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label>איסוף<input required value={d.pickup} onChange={(e) => set({ ...d, pickup: e.target.value })} /></label>
      <label>יעד<input required value={d.dropoff} onChange={(e) => set({ ...d, dropoff: e.target.value })} /></label>
      <label>
        נהג קבוע
        <select value={d.driver_id} onChange={(e) => set({ ...d, driver_id: e.target.value })}>
          <option value="">— לא שובץ (אשבץ כל פעם) —</option>
          {drivers.map((x) => <option key={x.id} value={x.id}>{x.is_self ? `${x.name} (אני)` : x.name}</option>)}
        </select>
      </label>
      <div className="row">
        <label>מחיר ללקוח ₪<input type="number" step="0.01" min={0} inputMode="decimal" value={d.price} onChange={(e) => set({ ...d, price: e.target.value })} /></label>
        <label>עלות לקבלן ₪<input type="number" step="0.01" min={0} inputMode="decimal" value={d.driver_cost} onChange={(e) => set({ ...d, driver_cost: e.target.value })} /></label>
      </div>
      <label>הערות<input value={d.notes} onChange={(e) => set({ ...d, notes: e.target.value })} /></label>
    </>
  );
}
