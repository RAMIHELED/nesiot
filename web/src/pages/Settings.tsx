import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../supabase";
import { useSession } from "../lib/session";
import { disablePush, enablePush, getPushState, sendTestPush, type PushState } from "../lib/push";

const pushText: Record<PushState, string> = {
  unsupported: "הדפדפן הזה לא תומך בהתראות. בטלפון אנדרואיד השתמשו ב-Chrome.",
  "ios-not-installed": "באייפון: קודם מוסיפים את האתר למסך הבית (שיתוף ← הוספה למסך הבית), פותחים משם, ואז מפעילים התראות.",
  "no-key": "ההתראות עוד לא הוגדרו במערכת (חסר מפתח VAPID).",
  denied: "ההתראות חסומות. אפשר לאשר אותן בהגדרות האתר בדפדפן.",
  off: "ההתראות כבויות במכשיר הזה.",
  on: "ההתראות פועלות במכשיר הזה ✓",
};

export default function Settings() {
  const { session, org, orgs, setOrgId, signOut } = useSession();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [push, setPush] = useState<PushState | null>(null);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(60);
  const [digest, setDigest] = useState(true);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    getPushState().then(setPush).catch(() => setPush("unsupported"));
  }, []);

  useEffect(() => {
    if (!org) return;
    supabase.from("organizations").select("reminder_minutes, digest_enabled").eq("id", org.id).single()
      .then(({ data }) => {
        if (data) {
          setMinutes(data.reminder_minutes);
          setDigest(data.digest_enabled);
        }
      });
  }, [org]);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.functions.invoke("invite-user", {
      body: { email, org_id: org.id, role: "member" },
    });
    setBusy(false);
    setMsg(error ? "ההזמנה נכשלה" : `${email} יכול/ה עכשיו להיכנס עם קוד במייל`);
    if (!error) setEmail("");
  };

  const [pushBusy, setPushBusy] = useState(false);
  const togglePush = async () => {
    setPushMsg(null);
    setPushBusy(true);
    try {
      const next = push === "on" ? await disablePush() : await enablePush();
      setPush(next);
      if (next === "on") setPushMsg("ההתראות הופעלו ✓ עכשיו אפשר לשלוח בדיקה.");
    } catch (err) {
      setPushMsg(`שגיאה: ${(err as Error).message}`);
    } finally {
      setPushBusy(false);
    }
  };

  const test = async () => {
    setPushMsg(null);
    try {
      const r = await sendTestPush();
      setPushMsg(
        r.sent > 0 ? `נשלחה התראת בדיקה (${r.sent} מכשירים)`
          : r.devices === 0 ? "לא נמצא מכשיר רשום. כבו והפעילו שוב את ההתראות."
            : `המכשיר רשום (${r.devices}) אבל השליחה נכשלה. כנראה מפתח ה-VAPID בשרת לא תואם למפתח באתר.`,
      );
    } catch (err) {
      setPushMsg(`שגיאה: ${(err as Error).message}`);
    }
  };

  const saveReminders = async (e: FormEvent) => {
    e.preventDefault();
    if (!org) return;
    const { error } = await supabase.from("organizations")
      .update({ reminder_minutes: minutes, digest_enabled: digest }).eq("id", org.id);
    setSavedMsg(error ? `שגיאה: ${error.message}` : "נשמר ✓");
  };

  return (
    <div className="stack">
      <h2>הגדרות</h2>
      <div className="card">
        <div className="small muted">מחובר/ת כ</div>
        <div dir="ltr">{session?.user.email}</div>
      </div>

      {orgs.length > 1 && (
        <label>
          עסק
          <select value={org?.id} onChange={(e) => setOrgId(e.target.value)}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      )}

      <div className="panel stack">
        <strong>תזכורות לפני נסיעה</strong>
        <p className="small">{push ? pushText[push] : "בודק…"}</p>
        {(push === "on" || push === "off") && (
          <div className="row">
            <button className={`btn ${push === "on" ? "" : "primary"}`} onClick={togglePush} disabled={pushBusy}>
              {pushBusy ? "רגע…" : push === "on" ? "כיבוי התראות במכשיר הזה" : "הפעלת התראות במכשיר הזה"}
            </button>
            {push === "on" && <button className="btn" onClick={test}>שליחת בדיקה</button>}
          </div>
        )}
        {pushMsg && <p className="small">{pushMsg}</p>}

        {org?.role === "owner" && (
          <form onSubmit={saveReminders} className="stack">
            <label>
              כמה זמן לפני הנסיעה להזכיר
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {[15, 30, 45, 60, 90, 120, 180].map((m) => (
                  <option key={m} value={m}>{m < 60 ? `${m} דקות` : m === 60 ? "שעה" : `${m / 60} שעות`}</option>
                ))}
              </select>
            </label>
            <label className="row check">
              <input type="checkbox" checked={digest} onChange={(e) => setDigest(e.target.checked)} />
              סיכום של מחר בכל ערב ב-20:00 (כמה נסיעות, ומה עוד לא שובץ)
            </label>
            <button className="btn">שמירה</button>
            {savedMsg && <p className="small">{savedMsg}</p>}
          </form>
        )}
      </div>

      {org?.role === "owner" && (
        <form onSubmit={invite} className="panel stack">
          <strong>הוספת משתמש לעסק</strong>
          <input type="email" dir="ltr" required placeholder="email@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn primary" disabled={busy}>הוספה</button>
          {msg && <p className="small">{msg}</p>}
        </form>
      )}

      <button className="btn" onClick={signOut}>יציאה</button>
    </div>
  );
}
