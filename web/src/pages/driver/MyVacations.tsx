import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../../supabase";
import { useSession } from "../../lib/session";
import { addDays, today } from "../../lib/format";
import { loadAbsences, rangeLabel, type Absence } from "../../lib/absences";

export default function MyVacations() {
  const { org } = useSession();
  const orgId = org!.id;
  const myDriverId = org!.driver_id!;
  const [list, setList] = useState<Absence[]>([]);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  // The database returns only his own vacations and days off for everyone
  const load = () => loadAbsences(orgId, today(), addDays(today(), 365)).then(setList);

  useEffect(() => {
    load();
  }, [orgId]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (to < from) return setMsg("תאריך הסיום לפני תאריך ההתחלה.");
    const { error } = await supabase.from("driver_absences").insert({
      org_id: orgId, driver_id: myDriverId, start_date: from, end_date: to, note: note.trim() || null,
    });
    if (error) return setMsg(`שגיאה: ${error.message}`);
    setNote("");
    setMsg("נשמר ✓ הסדרן יראה את החופשה.");
    load();
  };

  const remove = async (a: Absence) => {
    if (!window.confirm(`למחוק את החופשה ${rangeLabel(a)}?`)) return;
    await supabase.from("driver_absences").delete().eq("id", a.id);
    load();
  };

  return (
    <div className="stack">
      <h2>🏖 החופשות שלי</h2>
      {list.length === 0 && <p className="muted small">אין חופשות קרובות.</p>}
      {list.map((a) => (
        <div key={a.id} className="row between card">
          <span>{a.driver_id === null ? "כל הנהגים · " : ""}{rangeLabel(a)}{a.note ? ` · ${a.note}` : ""}</span>
          {a.driver_id === myDriverId && <button className="btn link small" onClick={() => remove(a)}>מחיקה</button>}
        </div>
      ))}

      <form onSubmit={add} className="panel stack">
        <strong>דיווח חופשה</strong>
        <div className="row">
          <label>מתאריך<input type="date" required value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></label>
          <label>עד תאריך<input type="date" required value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <input placeholder="הערה (לא חובה)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn primary">שמירה</button>
        {msg && <p className="small">{msg}</p>}
      </form>
    </div>
  );
}
