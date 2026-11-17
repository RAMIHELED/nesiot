import { useState, type FormEvent } from "react";
import { supabase } from "../supabase";
import { addDays, today } from "../lib/format";
import { rangeLabel, type Absence } from "../lib/absences";
import type { Driver } from "../types";

type Conflict = { id: string; ride_date: string; ride_time: string | null; pickup: string | null; dropoff: string | null; driver_id: string | null };

/** Vacations / days off: list, add, delete, and rides that clash with a new vacation */
export default function Vacations({ orgId, drivers, absences, onChange }: {
  orgId: string; drivers: Driver[]; absences: Absence[]; onChange: () => void;
}) {
  const [driverId, setDriverId] = useState<string>("");
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<{ absence: Absence; rides: Conflict[] } | null>(null);

  const nameOf = (id: string | null) =>
    id === null ? "כל הנהגים" : drivers.find((d) => d.id === id)?.name ?? "נהג";

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setConflicts(null);
    if (to < from) return setMsg("תאריך הסיום לפני תאריך ההתחלה.");
    const { data, error } = await supabase.from("driver_absences").insert({
      org_id: orgId, driver_id: driverId || null, start_date: from, end_date: to, note: note.trim() || null,
    }).select().single();
    if (error) return setMsg(`שגיאה: ${error.message}`);
    const absence = data as Absence;

    // Rides already assigned in this period
    let q = supabase.from("rides").select("id, ride_date, ride_time, pickup, dropoff, driver_id")
      .eq("org_id", orgId).eq("status", "active").gte("ride_date", from).lte("ride_date", to)
      .order("ride_date").order("ride_time");
    q = driverId ? q.eq("driver_id", driverId) : q.not("driver_id", "is", null);
    const { data: rides } = await q;
    if (rides && rides.length > 0) setConflicts({ absence, rides: rides as Conflict[] });
    else setMsg("נשמר ✓");

    setNote("");
    onChange();
  };

  const unassign = async () => {
    if (!conflicts) return;
    const ids = conflicts.rides.map((r) => r.id);
    const { error } = await supabase.from("rides").update({ driver_id: null }).in("id", ids);
    if (error) return setMsg(`שגיאה: ${error.message}`);
    setMsg(`השיבוץ הוסר מ-${ids.length} נסיעות. הן מסומנות בצהוב ביומן.`);
    setConflicts(null);
  };

  const remove = async (a: Absence) => {
    if (!window.confirm(`למחוק את החופשה של ${nameOf(a.driver_id)} (${rangeLabel(a)})?`)) return;
    await supabase.from("driver_absences").delete().eq("id", a.id);
    onChange();
  };

  const isNow = (a: Absence) => a.start_date <= today() && today() <= a.end_date;

  return (
    <div className="panel stack">
      <strong>🏖 חופשות וימי היעדרות</strong>

      {absences.length === 0 && <p className="small muted">אין חופשות קרובות.</p>}
      {absences.map((a) => (
        <div key={a.id} className="row between small">
          <span>
            {isNow(a) ? "🟢 עכשיו · " : ""}<strong>{nameOf(a.driver_id)}</strong> · {rangeLabel(a)}{a.note ? ` · ${a.note}` : ""}
          </span>
          <button type="button" className="btn link small" onClick={() => remove(a)}>מחיקה</button>
        </div>
      ))}

      <form onSubmit={add} className="stack">
        <label>
          מי
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">כל הנהגים (חג, העסק סגור)</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.is_self ? `${d.name} (אני)` : d.name}</option>)}
          </select>
        </label>
        <div className="row">
          <label>מתאריך<input type="date" required value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></label>
          <label>עד תאריך<input type="date" required value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="row small">
          <button type="button" className="btn link small" onClick={() => setTo(from)}>יום אחד</button>
          <button type="button" className="btn link small" onClick={() => setTo(addDays(from, 6))}>שבוע</button>
        </div>
        <input placeholder="הערה (לא חובה), למשל: מילואים, אילת" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn primary">הוספת חופשה</button>
      </form>

      {conflicts && (
        <div className="alert stack">
          <span>
            ⚠️ ל{nameOf(conflicts.absence.driver_id)} יש {conflicts.rides.length} נסיעות משובצות בתקופה הזו:
          </span>
          {conflicts.rides.slice(0, 8).map((r) => (
            <span key={r.id} className="small">
              {r.ride_date.split("-").reverse().slice(0, 2).join("/")} {r.ride_time?.slice(0, 5) ?? ""} · {r.pickup ?? "?"} ← {r.dropoff ?? "?"}
              {conflicts.absence.driver_id === null ? ` · ${nameOf(r.driver_id)}` : ""}
            </span>
          ))}
          {conflicts.rides.length > 8 && <span className="small">ועוד {conflicts.rides.length - 8}…</span>}
          <div className="row">
            <button type="button" className="btn small" onClick={unassign}>הסרת השיבוץ מהנסיעות האלה</button>
            <button type="button" className="btn link small" onClick={() => setConflicts(null)}>להשאיר כמו שזה</button>
          </div>
        </div>
      )}
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}
