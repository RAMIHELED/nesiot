import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../../supabase";
import { useDriverOrgs, useSession } from "../../lib/session";
import { today } from "../../lib/format";
import { rangeLabel, type Absence } from "../../lib/absences";

export default function MyVacations() {
  const { org } = useSession();
  const driverOrgs = useDriverOrgs();
  const multi = driverOrgs.length > 1;
  const orgName = (id: string) => driverOrgs.find((o) => o.id === id)?.name ?? "";

  const [list, setList] = useState<Absence[]>([]);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [note, setNote] = useState("");
  const [allBusinesses, setAllBusinesses] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  // The database returns only his own vacations (in every business) and days off for everyone
  const load = () =>
    supabase.from("driver_absences").select("*").gte("end_date", today()).order("start_date")
      .then(({ data }) => setList((data ?? []) as Absence[]));

  useEffect(() => {
    load();
  }, [driverOrgs.length]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (to < from) return setMsg("תאריך הסיום לפני תאריך ההתחלה.");
    const targets = multi && allBusinesses ? driverOrgs : driverOrgs.filter((o) => o.id === org?.id);
    const rows = targets.map((o) => ({
      org_id: o.id, driver_id: o.driver_id, start_date: from, end_date: to, note: note.trim() || null,
    }));
    const { error } = await supabase.from("driver_absences").insert(rows);
    if (error) return setMsg(`שגיאה: ${error.message}`);
    setNote("");
    setMsg(rows.length > 1 ? `נשמר ✓ ב-${rows.length} עסקים.` : "נשמר ✓ הסדרן יראה את החופשה.");
    load();
  };

  const isMine = (a: Absence) => a.driver_id !== null && driverOrgs.some((o) => o.driver_id === a.driver_id);

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
          <span>
            {a.driver_id === null ? "כל הנהגים · " : ""}{rangeLabel(a)}{a.note ? ` · ${a.note}` : ""}
            {multi ? ` · ${orgName(a.org_id)}` : ""}
          </span>
          {isMine(a) && <button className="btn link small" onClick={() => remove(a)}>מחיקה</button>}
        </div>
      ))}

      <form onSubmit={add} className="panel stack">
        <strong>דיווח חופשה</strong>
        <div className="row">
          <label>מתאריך<input type="date" required value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></label>
          <label>עד תאריך<input type="date" required value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <input placeholder="הערה (לא חובה)" value={note} onChange={(e) => setNote(e.target.value)} />
        {multi && (
          <label className="row check small">
            <input type="checkbox" checked={allBusinesses} onChange={(e) => setAllBusinesses(e.target.checked)} />
            בכל העסקים שאני עובד איתם ({driverOrgs.map((o) => o.name).join(", ")})
          </label>
        )}
        <button className="btn primary">שמירה</button>
        {msg && <p className="small">{msg}</p>}
      </form>
    </div>
  );
}
