import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import VoiceButton from "../components/VoiceButton";
import { loadAbsences, rangeLabel, type Absence } from "../lib/absences";
import { addDays, today } from "../lib/format";
import { supabase } from "../supabase";
import { useCanEdit, useOrgId, useSession } from "../lib/session";
import { normalizeIlMobile } from "../lib/phone";
import type { Driver } from "../types";

type Draft = { name: string; phone: string; is_self: boolean; notes: string; seats: number; car_model: string; car_plate: string };

const SEAT_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 20];

const toDraft = (d?: Driver): Draft => ({
  name: d?.name ?? "",
  phone: d?.phone ?? "",
  is_self: d?.is_self ?? false,
  notes: d?.notes ?? "",
  seats: d?.seats ?? 5,
  car_model: d?.car_model ?? "",
  car_plate: d?.car_plate ?? "",
});

// Returns the row to save, or an error message
const toRow = (d: Draft) => {
  const phone = normalizeIlMobile(d.phone);
  if (!phone) return { row: null, error: "מספר הטלפון לא תקין. צריך מספר נייד ישראלי, לדוגמה 050-1234567." };
  return {
    error: null,
    row: {
      name: d.name.trim(),
      phone,
      is_self: d.is_self,
      notes: d.notes.trim() || null,
      seats: d.seats,
      car_model: d.car_model.trim() || null,
      car_plate: d.car_plate.trim() || null,
    },
  };
};

export default function Drivers() {
  const orgId = useOrgId();
  const canEdit = useCanEdit();
  const { org } = useSession();
  const isOwner = org?.role === "owner";
  // Drivers who can log in to the app (owner only)
  const [appUsers, setAppUsers] = useState<Map<string, { user_id: string; email: string | null }>>(new Map());
  const [inviteFor, setInviteFor] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const loadAppUsers = () => {
    if (!isOwner) return;
    supabase.from("memberships").select("user_id, email, driver_id").eq("org_id", orgId).eq("role", "driver")
      .then(({ data }) => setAppUsers(new Map((data ?? []).map((m) => [m.driver_id as string, { user_id: m.user_id, email: m.email }]))));
  };

  const inviteDriver = async (d: Driver) => {
    setInviteMsg(null);
    const { data, error } = await supabase.functions.invoke("invite-user", {
      body: { email: inviteEmail, org_id: orgId, role: "driver", driver_id: d.id },
    });
    if (error || !data?.ok) return setInviteMsg("ההזמנה נכשלה. בדקו את המייל.");
    setInviteMsg(`${d.name} יכול להיכנס עכשיו עם ${inviteEmail}. שלחו לו את כתובת האתר.`);
    setInviteFor(null);
    setInviteEmail("");
    loadAppUsers();
  };

  const revokeDriver = async (d: Driver) => {
    const u = appUsers.get(d.id);
    if (!u || !window.confirm(`לבטל את הגישה של ${d.name} לאפליקציה?`)) return;
    await supabase.from("memberships").delete().eq("org_id", orgId).eq("user_id", u.user_id);
    loadAppUsers();
  };
  const [list, setList] = useState<Driver[]>([]);
  const [newDraft, setNewDraft] = useState<Draft>(toDraft());
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(toDraft());
  const [error, setError] = useState<string | null>(null);
  const [absences, setAbsences] = useState<Absence[]>([]);

  const load = () =>
    supabase.from("drivers").select("*").eq("org_id", orgId)
      .order("is_self", { ascending: false }).order("name")
      .then(({ data }) => setList((data ?? []) as Driver[]));

  // Current and future vacations (up to a year ahead)
  const loadAbs = () => loadAbsences(orgId, today(), addDays(today(), 365)).then(setAbsences);

  useEffect(() => {
    load();
    loadAbs();
    loadAppUsers();
  }, [orgId]);

  const vacationsOf = (driverId: string) => absences.filter((a) => a.driver_id === driverId);
  const allDrivers = absences.filter((a) => a.driver_id === null);
  const isNow = (a: Absence) => a.start_date <= today() && today() <= a.end_date;

  const selfTaken = (exceptId?: string) => list.some((d) => d.is_self && d.id !== exceptId);

  // Voice / pasted text → fields of the new driver
  const [voiceText, setVoiceText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const baseTextRef = useRef("");
  const joinText = (base: string, add: string) => (base ? `${base}\n${add}` : add);

  const parseDriver = async (textOverride?: string) => {
    const text = (textOverride ?? voiceText).trim();
    if (!text) return;
    setParsing(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("parse-driver", { body: { text, org_id: orgId } });
    setParsing(false);
    if (error || !data?.driver) {
      setError("הפענוח נכשל. אפשר למלא ידנית.");
      return;
    }
    const p = data.driver as { name: string | null; phone: string | null; seats: number | null; car_model: string | null; notes: string | null; missing?: string[] };
    setNewDraft((d) => ({
      ...d,
      name: p.name ?? d.name,
      phone: p.phone ? normalizeIlMobile(p.phone) ?? p.phone : d.phone,
      seats: p.seats && p.seats > 0 && p.seats <= 60 ? p.seats : d.seats,
      car_model: p.car_model ?? d.car_model,
      notes: p.notes ?? d.notes,
    }));
    setMissing(p.missing ?? []);
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const r = toRow(newDraft);
    if (!r.row) return setError(r.error ?? "שגיאה");
    const { error } = await supabase.from("drivers").insert({ org_id: orgId, ...r.row });
    if (error) return setError(error.message);
    setNewDraft(toDraft());
    setVoiceText("");
    setMissing([]);
    setError(null);
    load();
  };

  const startEdit = (d: Driver) => {
    setEditId(d.id);
    setEdit(toDraft(d));
    setError(null);
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    const r = toRow(edit);
    if (!r.row) return setError(r.error ?? "שגיאה");
    const { error } = await supabase.from("drivers").update(r.row).eq("id", editId);
    if (error) return setError(error.message);
    setEditId(null);
    load();
  };

  const toggleActive = async (d: Driver) => {
    await supabase.from("drivers").update({ active: !d.active }).eq("id", d.id);
    load();
  };

  const remove = async (d: Driver) => {
    const { count } = await supabase.from("rides").select("id", { count: "exact", head: true }).eq("driver_id", d.id);
    if (count && count > 0) {
      setError(`ל${d.name} יש ${count} נסיעות במערכת, ולכן אי אפשר למחוק אותו. אפשר להשבית אותו במקום.`);
      return;
    }
    if (!window.confirm(`למחוק את ${d.name}?`)) return;
    const { error } = await supabase.from("drivers").delete().eq("id", d.id);
    if (error) return setError(error.message);
    setEditId(null);
    load();
  };

  return (
    <div className="stack">
      <div className="row between">
        <h2>נהגים וקבלני משנה</h2>
        <Link to="/vacations" className="btn">🏖 חופשות</Link>
      </div>
      {allDrivers.length > 0 && (
        <div className="alert small">
          🏖 חופשה לכל הנהגים: {allDrivers.map((a) => `${rangeLabel(a)}${a.note ? ` (${a.note})` : ""}`).join(" · ")}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {inviteMsg && <p className="small">{inviteMsg}</p>}

      <ul className="cards">
        {list.map((d) =>
          editId === d.id ? (
            <li key={d.id}>
              <form onSubmit={saveEdit} className="panel stack">
                <fieldset disabled={!canEdit} className="plain stack"><DriverFields d={edit} set={setEdit} canBeSelf={!selfTaken(d.id)} /></fieldset>
                <div className="row">
                  {canEdit && <button className="btn primary">שמירה</button>}
                  <button type="button" className="btn" onClick={() => setEditId(null)}>{canEdit ? "ביטול" : "סגירה"}</button>
                  {canEdit && <button type="button" className="btn danger" onClick={() => remove(d)}>מחיקה</button>}
                </div>
              </form>
            </li>
          ) : (
            <li key={d.id} className={`card clickable ${d.active ? "" : "dim"}`} onClick={() => startEdit(d)}>
              <div className="row between">
                <strong>{d.name}{d.is_self ? " (אני)" : ""}{d.active ? "" : " · מושבת"}</strong>
                {canEdit && <button className="btn link small" onClick={(e) => { e.stopPropagation(); toggleActive(d); }}>
                  {d.active ? "השבתה" : "הפעלה"}
                </button>}
              </div>
              <span className="small muted">
                {d.phone && <span dir="ltr">{d.phone}</span>}
                {` · ${d.seats} מקומות`}
                {d.car_model ? ` · ${d.car_model}` : ""}
                {d.car_plate ? ` · ${d.car_plate}` : ""}
              </span>
              {d.notes && <span className="small muted">{d.notes}</span>}
              <div className="vac-row" onClick={(e) => e.stopPropagation()}>
                {vacationsOf(d.id).map((a) => (
                  <span key={a.id} className={`vac-chip ${isNow(a) ? "now" : ""}`}>
                    🏖 {isNow(a) ? "עכשיו · " : ""}{rangeLabel(a)}{a.note ? ` · ${a.note}` : ""}
                  </span>
                ))}
                {canEdit && <Link to={`/vacations?driver=${d.id}`} className="vac-add">+ חופשה</Link>}
              </div>
              {isOwner && !d.is_self && (
                <div className="vac-row small" onClick={(e) => e.stopPropagation()}>
                  {appUsers.has(d.id) ? (
                    <>
                      <span className="app-on">📱 באפליקציה · <span dir="ltr">{appUsers.get(d.id)!.email}</span></span>
                      <button type="button" className="btn link small" onClick={() => revokeDriver(d)}>ביטול גישה</button>
                    </>
                  ) : inviteFor === d.id ? (
                    <>
                      <input type="email" dir="ltr" className="inline-input" placeholder="email@example.com"
                        value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                      <button type="button" className="btn small primary" disabled={!inviteEmail.includes("@")} onClick={() => inviteDriver(d)}>הזמנה</button>
                      <button type="button" className="btn link small" onClick={() => setInviteFor(null)}>ביטול</button>
                    </>
                  ) : (
                    <button type="button" className="btn link small" onClick={() => { setInviteFor(d.id); setInviteEmail(""); }}>📱 הזמנה לאפליקציה</button>
                  )}
                </div>
              )}
            </li>
          ),
        )}
      </ul>
      <p className="small muted">לחיצה על נהג פותחת עריכה. נהג מושבת לא מופיע בבחירת נהג לנסיעה.</p>

      {canEdit && <form onSubmit={add} className="panel stack">
        <strong>נהג חדש</strong>
        <label>
          אפשר להקליט או להדביק, לדוגמה: "משה כהן, 050-1234567, טויוטה סיינה, 7 מקומות"
          <textarea rows={2} value={voiceText} onChange={(e) => setVoiceText(e.target.value)} />
        </label>
        <div className="row">
          <VoiceButton
            label={voiceText.trim() ? "🎤 הוספה בהקלטה" : "🎤 הקלטה"}
            onStart={() => { baseTextRef.current = voiceText.trim(); }}
            onText={(t) => setVoiceText(joinText(baseTextRef.current, t))}
            onEnd={(t) => parseDriver(joinText(baseTextRef.current, t))}
          />
          <button type="button" className="btn primary" onClick={() => parseDriver()} disabled={parsing || !voiceText.trim()}>
            {parsing ? "מפענח…" : "✨ מלא אוטומטית"}
          </button>
          {voiceText.trim() && (
            <button type="button" className="btn link small" onClick={() => { setVoiceText(""); setMissing([]); }}>ניקוי</button>
          )}
        </div>
        {missing.length > 0 && (
          <div className="alert">
            חסר: {missing.join(", ")}
            <div className="small">לחצו "הוספה בהקלטה" ואמרו רק את מה שחסר.</div>
          </div>
        )}
        <DriverFields d={newDraft} set={setNewDraft} canBeSelf={!selfTaken()} />
        <button className="btn primary">הוספה</button>
      </form>}
    </div>
  );
}

function DriverFields({ d, set, canBeSelf }: { d: Draft; set: (d: Draft) => void; canBeSelf: boolean }) {
  return (
    <>
      <input required placeholder="שם" value={d.name} onChange={(e) => set({ ...d, name: e.target.value })} />
      <input required placeholder="טלפון נייד (חובה, לשליחה בוואטסאפ)" dir="ltr" inputMode="tel" type="tel"
        value={d.phone} onChange={(e) => set({ ...d, phone: e.target.value })} />
      {d.phone.trim() !== "" && !normalizeIlMobile(d.phone) && (
        <span className="small error">מספר נייד לא תקין (לדוגמה 050-1234567)</span>
      )}
      <div className="row">
        <label>
          מקומות ברכב
          <select value={d.seats} onChange={(e) => set({ ...d, seats: Number(e.target.value) })}>
            {[...new Set([...SEAT_OPTIONS, d.seats])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>
          דגם רכב (לא חובה)
          <input placeholder="לדוגמה: טויוטה קורולה" value={d.car_model} onChange={(e) => set({ ...d, car_model: e.target.value })} />
        </label>
      </div>
      <label>
        מספר רכב (לא חובה, נשלח ללקוח)
        <input placeholder="לדוגמה: 12-345-67" dir="ltr" value={d.car_plate} onChange={(e) => set({ ...d, car_plate: e.target.value })} />
      </label>
      <input placeholder="הערות" value={d.notes} onChange={(e) => set({ ...d, notes: e.target.value })} />
      {(canBeSelf || d.is_self) && (
        <label className="row check">
          <input type="checkbox" checked={d.is_self} onChange={(e) => set({ ...d, is_self: e.target.checked })} />
          זה אני (בעל העסק)
        </label>
      )}
    </>
  );
}
