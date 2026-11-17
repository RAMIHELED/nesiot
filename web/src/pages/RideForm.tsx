import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../supabase";
import { useOrgId } from "../lib/session";
import { money, today } from "../lib/format";
import { rideMessage, waLink } from "../lib/whatsapp";
import { driverAvailability, hhmm, interval, type Availability, type TimedRide } from "../lib/availability";
import VoiceButton from "../components/VoiceButton";
import { PAYMENT_METHODS } from "./Customers";
import type { Customer, Driver, ParsedRide, Ride } from "../types";

type Form = {
  customer_id: string;
  new_customer_name: string;
  new_customer_phone: string;
  driver_id: string;
  ride_date: string;
  ride_time: string;
  pickup: string;
  dropoff: string;
  flight_number: string;
  passengers: string;
  distance_km: string;
  duration_min: string;
  price: string;
  driver_cost: string;
  notes: string;
  status: "active" | "cancelled";
};

const emptyForm = (): Form => ({
  customer_id: "",
  new_customer_name: "",
  new_customer_phone: "",
  driver_id: "",
  ride_date: today(),
  ride_time: "",
  pickup: "",
  dropoff: "",
  flight_number: "",
  passengers: "",
  distance_km: "",
  duration_min: "",
  price: "",
  driver_cost: "",
  notes: "",
  status: "active",
});

const joinText = (base: string, add: string) => (base ? `${base}\n${add}` : add);
const routeKey = (p: string, d: string) => `${p.trim().toLowerCase()}|${d.trim().toLowerCase()}`;
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
const strOrNull = (s: string) => (s.trim() === "" ? null : s.trim());

export default function RideForm() {
  const { id } = useParams();
  const isNew = !id;
  const orgId = useOrgId();
  const navigate = useNavigate();

  const [form, setForm] = useState<Form>(emptyForm);
  const [source, setSource] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  // Other rides on the same date, to know which driver is free
  const [dayRides, setDayRides] = useState<TimedRide[]>([]);
  const [parsing, setParsing] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [priceListMsg, setPriceListMsg] = useState<string | null>(null);
  // Text that was in the box when the current recording started; new speech is appended to it
  const baseTextRef = useRef("");
  const [distanceMsg, setDistanceMsg] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState(false);
  // The pickup/dropoff pair the current distance belongs to
  const [measuredRoute, setMeasuredRoute] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(!isNew);
  const [recurringId, setRecurringId] = useState<string | null>(null);
  // "Paid on the spot" payment for this ride, if any
  const [ridePayment, setRidePayment] = useState<{ id: string; method: string | null; amount: number } | null>(null);
  const [payMethod, setPayMethod] = useState("cash");
  // Driver confirmation (as saved in the database)
  type Confirm = Pick<Ride, "driver_id" | "driver_status" | "driver_token" | "driver_sent_at" | "driver_responded_at" | "declined_driver_ids">;
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  // Load lists + existing ride
  useEffect(() => {
    supabase.from("customers").select("*").eq("org_id", orgId).order("name")
      .then(({ data }) => setCustomers((data ?? []) as Customer[]));
    supabase.from("drivers").select("*").eq("org_id", orgId).eq("active", true).order("is_self", { ascending: false }).order("name")
      .then(({ data }) => setDrivers((data ?? []) as Driver[]));
  }, [orgId]);

  useEffect(() => {
    if (isNew) {
      setForm(emptyForm());
      setSource("");
      setSaved(false);
      return;
    }
    supabase.from("rides").select("*").eq("id", id).single().then(({ data, error }) => {
      if (error || !data) {
        setError("הנסיעה לא נמצאה");
        return;
      }
      const r = data as Ride;
      setForm({
        customer_id: r.customer_id ?? "",
        new_customer_name: "",
        new_customer_phone: "",
        driver_id: r.driver_id ?? "",
        ride_date: r.ride_date,
        ride_time: r.ride_time?.slice(0, 5) ?? "",
        pickup: r.pickup ?? "",
        dropoff: r.dropoff ?? "",
        flight_number: r.flight_number ?? "",
        passengers: r.passengers?.toString() ?? "",
        distance_km: r.distance_km?.toString() ?? "",
        duration_min: r.duration_min?.toString() ?? "",
        price: r.price?.toString() ?? "",
        driver_cost: r.driver_cost?.toString() ?? "",
        notes: r.notes ?? "",
        status: r.status,
      });
      setSource(r.source_text ?? "");
      setRecurringId(r.recurring_id ?? null);
      supabase.from("customer_payments").select("id, method, amount").eq("ride_id", r.id).maybeSingle()
        .then(({ data }) => setRidePayment(data ? { ...data, amount: Number(data.amount) } : null));
      setConfirm({
        driver_id: r.driver_id, driver_status: r.driver_status ?? "none", driver_token: r.driver_token,
        driver_sent_at: r.driver_sent_at, driver_responded_at: r.driver_responded_at,
        declined_driver_ids: r.declined_driver_ids ?? [],
      });
      setMeasuredRoute(r.distance_km != null ? routeKey(r.pickup ?? "", r.dropoff ?? "") : null);
      setSaved(true);
    });
  }, [id, isNew]);

  useEffect(() => {
    if (!form.ride_date) return;
    supabase.from("rides")
      .select("id, driver_id, ride_date, ride_time, duration_min, pickup, dropoff, status")
      .eq("org_id", orgId).eq("ride_date", form.ride_date).eq("status", "active").not("driver_id", "is", null)
      .then(({ data }) => setDayRides((data ?? []) as TimedRide[]));
  }, [orgId, form.ride_date]);

  // Price memory: suggest price + subcontractor cost for customer & route
  useEffect(() => {
    if (!form.pickup.trim() || !form.dropoff.trim()) {
      setHint(null);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("suggest_price", {
        p_org: orgId,
        p_customer: form.customer_id || null,
        p_pickup: form.pickup,
        p_dropoff: form.dropoff,
      });
      const s = (data as { price: number | null; driver_cost: number | null; source: string }[] | null)?.[0];
      if (!s) {
        setHint(null);
        return;
      }
      const label = s.source === "last_ride" ? "מחיר אחרון ללקוח במסלול" : "מהמחירון";
      setHint(`${label}: ${money(s.price)} · עלות קבלן ${money(s.driver_cost)}`);
      setForm((f) => ({
        ...f,
        price: f.price || (s.price?.toString() ?? ""),
        driver_cost: f.driver_cost || (s.driver_cost?.toString() ?? ""),
      }));
    }, 500);
    return () => clearTimeout(t);
  }, [orgId, form.customer_id, form.pickup, form.dropoff]);

  // Estimated distance: calculated once per pickup/dropoff pair, can be edited by hand
  const measure = async (force = false) => {
    const key = routeKey(form.pickup, form.dropoff);
    if (!form.pickup.trim() || !form.dropoff.trim()) return;
    if (!force && key === measuredRoute) return;
    setMeasuring(true);
    setDistanceMsg(null);
    const { data, error } = await supabase.functions.invoke("estimate-distance", {
      body: { pickup: form.pickup, dropoff: form.dropoff, org_id: orgId },
    });
    setMeasuring(false);
    setMeasuredRoute(key);
    if (error || data?.distance_km == null) {
      setDistanceMsg("לא הצלחנו לחשב מרחק לכתובות האלה. אפשר להזין ידנית.");
      return;
    }
    setForm((f) => ({ ...f, distance_km: String(data.distance_km), duration_min: String(data.duration_min ?? "") }));
    setSaved(false);
    setDistanceMsg(data.source === "previous_ride" ? "לפי נסיעה קודמת במסלול הזה" : "חושב לפי Google Maps");
  };

  useEffect(() => {
    if (!form.pickup.trim() || !form.dropoff.trim()) return;
    const t = setTimeout(() => measure(false), 1200);
    return () => clearTimeout(t);
  }, [form.pickup, form.dropoff]);

  // Save this ride's price and contractor cost as the price for this route (customer-specific, or general)
  const saveToPriceList = async () => {
    setPriceListMsg(null);
    const customerId = form.customer_id || null;
    const key = (t: string) => t.trim().replace(/\s+/g, " ").toLowerCase();
    let query = supabase.from("price_list").select("id, pickup, dropoff").eq("org_id", orgId);
    query = customerId ? query.eq("customer_id", customerId) : query.is("customer_id", null);
    const { data: existing } = await query;
    const same = (existing ?? []).find((r) => key(r.pickup) === key(form.pickup) && key(r.dropoff) === key(form.dropoff));
    const row = {
      customer_id: customerId,
      pickup: form.pickup.trim(),
      dropoff: form.dropoff.trim(),
      price: numOrNull(form.price),
      driver_cost: numOrNull(form.driver_cost),
    };
    const { error } = same
      ? await supabase.from("price_list").update(row).eq("id", same.id)
      : await supabase.from("price_list").insert({ org_id: orgId, ...row });
    setPriceListMsg(error ? `שגיאה: ${error.message}` : same ? "עודכן במחירון ✓" : "נשמר במחירון ✓");
  };

  const markPaid = async () => {
    if (!id || !form.customer_id || !form.price) return;
    const { data, error } = await supabase.from("customer_payments").insert({
      org_id: orgId, customer_id: form.customer_id, ride_id: id, amount: Number(form.price), method: payMethod,
      paid_on: form.ride_date <= today() ? form.ride_date : today(),
    }).select("id, method, amount").single();
    if (error) return setError(error.message);
    setRidePayment({ ...data, amount: Number(data.amount) });
  };

  const unmarkPaid = async () => {
    if (!ridePayment) return;
    await supabase.from("customer_payments").delete().eq("id", ridePayment.id);
    setRidePayment(null);
  };

  const parse = async (textOverride?: string) => {
    const text = (textOverride ?? source).trim();
    if (!text) return;
    setParsing(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("parse-ride", {
      body: { text, org_id: orgId, today: today() },
    });
    setParsing(false);
    if (error || !data?.ride) {
      setError("הפענוח נכשל. אפשר למלא ידנית.");
      return;
    }
    const p = data.ride as ParsedRide;
    setForm((f) => ({
      ...f,
      customer_id: p.customer_id ?? f.customer_id,
      new_customer_name: !p.customer_id && p.customer_name ? p.customer_name : f.new_customer_name,
      new_customer_phone: !p.customer_id && p.customer_phone ? p.customer_phone : f.new_customer_phone,
      ride_date: p.ride_date ?? f.ride_date,
      ride_time: p.ride_time ?? f.ride_time,
      pickup: p.pickup ?? f.pickup,
      dropoff: p.dropoff ?? f.dropoff,
      flight_number: p.flight_number ?? f.flight_number,
      passengers: p.passengers?.toString() ?? f.passengers,
      price: p.price?.toString() ?? f.price,
      driver_cost: p.driver_cost?.toString() ?? f.driver_cost,
      driver_id: p.driver_id ?? f.driver_id,
      notes: p.notes ?? f.notes,
    }));
    setMissing(p.missing ?? []);
    setSaved(false);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    let customerId = form.customer_id || null;
    if (!customerId && form.new_customer_name.trim()) {
      const { data, error } = await supabase.from("customers")
        .insert({ org_id: orgId, name: form.new_customer_name.trim(), phone: strOrNull(form.new_customer_phone) })
        .select().single();
      if (error) {
        setSaving(false);
        setError(error.message);
        return;
      }
      customerId = (data as Customer).id;
      setCustomers((c) => [...c, data as Customer]);
    }

    const row = {
      org_id: orgId,
      customer_id: customerId,
      driver_id: form.driver_id || null,
      ride_date: form.ride_date,
      ride_time: strOrNull(form.ride_time),
      pickup: strOrNull(form.pickup),
      dropoff: strOrNull(form.dropoff),
      flight_number: strOrNull(form.flight_number)?.toUpperCase().replace(/\s/g, "") ?? null,
      passengers: numOrNull(form.passengers),
      price: numOrNull(form.price),
      driver_cost: numOrNull(form.driver_cost),
      distance_km: numOrNull(form.distance_km),
      duration_min: numOrNull(form.duration_min),
      notes: strOrNull(form.notes),
      status: form.status,
      source_text: strOrNull(source),
    };

    const CONFIRM_COLS = "id, driver_id, driver_status, driver_token, driver_sent_at, driver_responded_at, declined_driver_ids";
    const res = isNew
      ? await supabase.from("rides").insert(row).select(CONFIRM_COLS).single()
      : await supabase.from("rides").update(row).eq("id", id).select(CONFIRM_COLS).single();

    setSaving(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    setForm((f) => ({ ...f, customer_id: customerId ?? "", new_customer_name: "", new_customer_phone: "" }));
    setConfirm(res.data as unknown as Confirm);
    setSaved(true);
    if (isNew) navigate(`/rides/${(res.data as { id: string }).id}`, { replace: true });
  };

  const driver = drivers.find((d) => d.id === form.driver_id);

  const target = { id, ride_time: strOrNull(form.ride_time), duration_min: numOrNull(form.duration_min) };
  const availability = new Map<string, Availability>(
    drivers.map((d) => [d.id, driverAvailability(d.id, target, dayRides)]),
  );
  const availLabel = (a: Availability | undefined) => {
    if (!a || !form.ride_time) return "";
    if (a.kind === "free") return "✓ פנוי · ";
    const iv = interval(a.with);
    if (a.kind === "busy" && iv) return `✗ תפוס ${hhmm(iv.start)}–${hhmm(iv.end)} · `;
    return "? יש נסיעה בלי שעה · ";
  };
  // Free drivers first (keeps the owner on top within each group)
  const rank = (d: Driver) => {
    const k = availability.get(d.id)?.kind;
    const declinedRank = confirm?.declined_driver_ids?.includes(d.id) ? 10 : 0;
    return declinedRank + (k === "free" ? 0 : k === "unknown" ? 1 : 2) * 2 + (d.is_self ? 0 : 1);
  };
  const sortedDrivers = [...drivers].sort((a, b) => rank(a) - rank(b));
  const declinedNames = (confirm?.declined_driver_ids ?? [])
    .map((x) => drivers.find((d) => d.id === x)?.name).filter(Boolean) as string[];
  // The confirmation state applies only to the driver that is saved on the ride
  const confirmForDriver = confirm && driver && confirm.driver_id === driver.id ? confirm : null;
  const responseUrl = confirmForDriver?.driver_token ? `${window.location.origin}/d/${confirmForDriver.driver_token}` : null;

  const markSent = async () => {
    if (!id || !confirmForDriver || confirmForDriver.driver_status === "confirmed") return;
    const now = new Date().toISOString();
    await supabase.from("rides")
      .update({ driver_status: "sent", driver_sent_at: now, unconfirmed_alert_at: null }).eq("id", id);
    setConfirm({ ...confirmForDriver, driver_status: "sent", driver_sent_at: now });
  };

  const markConfirmed = async () => {
    if (!id) return;
    const now = new Date().toISOString();
    await supabase.from("rides").update({ driver_status: "confirmed", driver_responded_at: now }).eq("id", id);
    if (confirm) setConfirm({ ...confirm, driver_status: "confirmed", driver_responded_at: now });
  };
  const timeOf = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : "";
  const chosenAvail = driver ? availability.get(driver.id) : undefined;
  const freeCount = drivers.filter((d) => availability.get(d.id)?.kind === "free").length;
  const customer = customers.find((c) => c.id === form.customer_id);
  const profit = form.price && driver && !driver.is_self
    ? Number(form.price) - Number(form.driver_cost || 0) : null;

  const message = rideMessage({
    ride_date: form.ride_date,
    ride_time: strOrNull(form.ride_time),
    pickup: strOrNull(form.pickup),
    dropoff: strOrNull(form.dropoff),
    flight_number: strOrNull(form.flight_number),
    passengers: numOrNull(form.passengers),
    notes: strOrNull(form.notes),
    customer_name: customer?.name,
    customer_phone: customer?.phone,
    driver_cost: numOrNull(form.driver_cost),
    distance_km: numOrNull(form.distance_km),
    duration_min: numOrNull(form.duration_min),
    response_url: responseUrl,
  });

  return (
    <form onSubmit={save} className="stack">
      <h2>{isNew ? "נסיעה חדשה" : "פרטי נסיעה"}</h2>
      {!isNew && recurringId && (
        <p className="small">🔁 נסיעה קבועה. שינוי כאן משנה רק את התאריך הזה. <Link to={`/recurring?edit=${recurringId}`}>עריכת הנסיעה הקבועה</Link></p>
      )}
      {!isNew && !recurringId && saved && (
        <p className="small"><Link to={`/recurring?from=${id}`}>🔁 הפיכה לנסיעה קבועה</Link></p>
      )}

      <div className="panel stack">
        <label>
          הדביקו הודעה מוואטסאפ / מייל, או הקליטו
          <textarea rows={4} value={source} onChange={(e) => setSource(e.target.value)}
            placeholder="לדוגמה: מחר ב-5 בבוקר איסוף מרחוב הרצל 12 רמת גן לנתב״ג, טיסה LY315, 3 נוסעים" />
        </label>
        <div className="row">
          <VoiceButton
            label={source.trim() ? "🎤 הוספה בהקלטה" : "🎤 הקלטה"}
            onStart={() => { baseTextRef.current = source.trim(); }}
            onText={(t) => setSource(joinText(baseTextRef.current, t))}
            onEnd={(t) => parse(joinText(baseTextRef.current, t))}
          />
          <button type="button" className="btn primary" onClick={() => parse()} disabled={parsing || !source.trim()}>
            {parsing ? "מפענח…" : "✨ מלא אוטומטית"}
          </button>
          {source.trim() && (
            <button type="button" className="btn link small" onClick={() => { setSource(""); setMissing([]); }}>ניקוי</button>
          )}
        </div>
        {missing.length > 0 && (
          <div className="alert">
            חסר: {missing.join(", ")}
            <div className="small">אין צורך להקליט מההתחלה: לחצו "הוספה בהקלטה" ואמרו רק את מה שחסר.</div>
          </div>
        )}
      </div>

      <label>
        לקוח
        <select value={form.customer_id} onChange={(e) => set("customer_id", e.target.value)}>
          <option value="">— לקוח חדש / ללא —</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {!form.customer_id && (
        <div className="row">
          <input placeholder="שם לקוח חדש" value={form.new_customer_name}
            onChange={(e) => set("new_customer_name", e.target.value)} />
          <input placeholder="טלפון" dir="ltr" inputMode="tel" value={form.new_customer_phone}
            onChange={(e) => set("new_customer_phone", e.target.value)} />
        </div>
      )}

      <div className="row">
        <label>תאריך<input type="date" required value={form.ride_date} onChange={(e) => set("ride_date", e.target.value)} /></label>
        <label>שעה<input type="time" value={form.ride_time} onChange={(e) => set("ride_time", e.target.value)} /></label>
      </div>
      <label>איסוף<input value={form.pickup} onChange={(e) => set("pickup", e.target.value)} /></label>
      <label>יעד<input value={form.dropoff} onChange={(e) => set("dropoff", e.target.value)} /></label>
      <div className="row">
        <label>מספר טיסה<input dir="ltr" value={form.flight_number} onChange={(e) => set("flight_number", e.target.value)} /></label>
        <label>נוסעים<input type="number" min={1} inputMode="numeric" value={form.passengers} onChange={(e) => set("passengers", e.target.value)} /></label>
      </div>

      <label>
        נהג
        <select value={form.driver_id} onChange={(e) => set("driver_id", e.target.value)}>
          <option value="">— לא שובץ —</option>
          {sortedDrivers.map((d) => (
            <option key={d.id} value={d.id}>
              {confirm?.declined_driver_ids?.includes(d.id) ? "✗ סירב · " : availLabel(availability.get(d.id))}{d.is_self ? `${d.name} (אני)` : d.name} · {d.seats} מקומות{d.car_model ? ` · ${d.car_model}` : ""}
            </option>
          ))}
        </select>
      </label>
      {form.ride_time && drivers.length > 0 && (
        <p className="small muted">
          {freeCount} מתוך {drivers.length} נהגים פנויים בשעה {form.ride_time.slice(0, 5)}
          {form.duration_min ? "" : " (בלי מרחק משוער מניחים נסיעה של שעה)"}
        </p>
      )}
      {!form.driver_id && confirm?.driver_status === "declined" && declinedNames.length > 0 && (
        <div className="alert">✗ {declinedNames.join(", ")} לא יכול/ים לקחת את הנסיעה. בחרו נהג אחר.</div>
      )}
      {confirmForDriver && !driver!.is_self && form.status === "active" && (
        <div className="row small confirm-line">
          {confirmForDriver.driver_status === "confirmed" && <span className="ok-text">✓ {driver!.name} אישר{confirmForDriver.driver_responded_at ? ` (${timeOf(confirmForDriver.driver_responded_at)})` : ""}</span>}
          {confirmForDriver.driver_status === "sent" && (
            <>
              <span>⏳ נשלח ל{driver!.name} ב-{timeOf(confirmForDriver.driver_sent_at)}, ממתין לאישור</span>
              <button type="button" className="btn link small" onClick={markConfirmed}>אישר בטלפון</button>
            </>
          )}
          {confirmForDriver.driver_status === "none" && (
            <>
              <span className="muted">עוד לא נשלח לנהג</span>
              <button type="button" className="btn link small" onClick={markConfirmed}>סימון כאושר</button>
            </>
          )}
        </div>
      )}
      {form.driver_id && confirm && confirm.driver_id !== form.driver_id && !isNew && (
        <p className="small muted">שמרו כדי לשבץ את הנהג. אחרי השמירה יופיע כפתור שליחה עם קישור לאישור.</p>
      )}
      {chosenAvail?.kind === "busy" && (
        <div className="alert">
          ⚠️ ל{driver!.name} כבר יש נסיעה באותו זמן: {chosenAvail.with.ride_time?.slice(0, 5)} {chosenAvail.with.pickup ?? "?"} ← {chosenAvail.with.dropoff ?? "?"}
        </div>
      )}
      {driver && form.passengers && Number(form.passengers) > driver.seats && (
        <div className="alert">⚠️ {form.passengers} נוסעים, וברכב של {driver.name} יש רק {driver.seats} מקומות</div>
      )}

      <div className="row">
        <label>מחיר ללקוח ₪<input type="number" step="0.01" inputMode="decimal" value={form.price} onChange={(e) => set("price", e.target.value)} /></label>
        {!driver?.is_self && (
          <label>עלות קבלן ₪<input type="number" step="0.01" inputMode="decimal" value={form.driver_cost} onChange={(e) => set("driver_cost", e.target.value)} /></label>
        )}
      </div>
      {hint && <p className="small muted">💡 {hint}</p>}
      {!isNew && saved && form.customer_id && form.price && form.status === "active" && (
        <div className="row small paid-line">
          {ridePayment ? (
            <>
              <span className="ok-text">✓ שולם במקום ({PAYMENT_METHODS[ridePayment.method ?? "other"]}, {money(ridePayment.amount)})</span>
              <button type="button" className="btn link small" onClick={unmarkPaid}>ביטול</button>
            </>
          ) : (
            <>
              <span className="muted">תשלום:</span>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="inline-select">
                {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button type="button" className="btn small" onClick={markPaid}>✓ שולם במקום</button>
            </>
          )}
        </div>
      )}
      {form.pickup.trim() && form.dropoff.trim() && (form.price || form.driver_cost) && (
        <div className="row small">
          <button type="button" className="btn link small" onClick={saveToPriceList}>
            שמירת המחיר במחירון{customer ? ` ל${customer.name}` : " (כללי)"}
          </button>
          {priceListMsg && <span className="muted">{priceListMsg}</span>}
        </div>
      )}
      {profit != null && <p className="small">רווח מהנסיעה: <strong>{money(profit)}</strong></p>}

      <div className="row">
        <label>מרחק משוער (ק״מ)
          <input type="number" step="0.1" min={0} inputMode="decimal" value={form.distance_km}
            onChange={(e) => set("distance_km", e.target.value)} />
        </label>
        <label>זמן נסיעה (דק׳)
          <input type="number" min={0} inputMode="numeric" value={form.duration_min}
            onChange={(e) => set("duration_min", e.target.value)} />
        </label>
      </div>
      <div className="row small muted">
        <span>{measuring ? "מחשב מרחק…" : distanceMsg ?? ""}</span>
        {form.pickup.trim() && form.dropoff.trim() && !measuring && (
          <button type="button" className="btn link small" onClick={() => measure(true)}>חישוב מחדש</button>
        )}
      </div>

      <label>הערות<textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></label>

      {!isNew && (
        <label className="row check">
          <input type="checkbox" checked={form.status === "cancelled"}
            onChange={(e) => set("status", e.target.checked ? "cancelled" : "active")} />
          הנסיעה בוטלה
        </label>
      )}

      {error && <p className="error">{error}</p>}

      <div className="row sticky">
        <button className="btn primary big" disabled={saving}>{saving ? "שומר…" : saved && !isNew ? "נשמר ✓" : "שמירה"}</button>
        {saved && !isNew && driver && !driver.is_self && form.status === "active" && (
          <a className="btn whatsapp big" href={waLink(driver.phone, message)} target="_blank" rel="noreferrer" onClick={markSent}>
            {confirmForDriver?.driver_status === "sent" ? `שליחה שוב ל${driver.name}` : `שליחה ל${driver.name} בוואטסאפ`}
          </a>
        )}
      </div>
    </form>
  );
}
