import { useState, type FormEvent } from "react";
import { supabase } from "../supabase";
import { contactLink } from "../lib/contact";

export default function Login() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // shouldCreateUser:false → only invited users can sign in
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (!error) return setStep("code");
    const msg = (error.message || "").toLowerCase();
    if (error.status === 429 || msg.includes("rate limit") || msg.includes("security purposes")) {
      setError("נשלחו יותר מדי מיילים בזמן קצר. נסו שוב בעוד כמה דקות.");
    } else if (msg.includes("signups not allowed") || msg.includes("otp_disabled")) {
      setError("המייל הזה לא מורשה במערכת. פנו למנהל.");
    } else {
      setError(`שגיאה: ${error.message}`);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: "email",
    });
    setBusy(false);
    if (error) setError("הקוד שגוי או שפג תוקפו.");
  };

  return (
    <div className="login">
      <h1>נסיעות</h1>
      <p className="muted">ניהול נסיעות והסעות</p>
      {step === "email" ? (
        <form onSubmit={sendCode} className="stack">
          <label>
            מייל
            <input type="email" dir="ltr" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn primary" disabled={busy}>שלחו לי קוד</button>
        </form>
      ) : (
        <form onSubmit={verify} className="stack">
          <p>שלחנו מייל ל-<span dir="ltr">{email}</span>. לחצו על הקישור במייל, או הקלידו כאן את הקוד אם יש במייל קוד.</p>
          <label>
            קוד
            <input inputMode="numeric" dir="ltr" required autoComplete="one-time-code"
              value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button className="btn primary" disabled={busy}>כניסה</button>
          <button type="button" className="btn link" onClick={() => setStep("email")}>החלפת מייל</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}

      <div className="panel stack center-text">
        <strong>אין לכם עדיין חשבון?</strong>
        <span className="small muted">מערכת לסדרנים ולבעלי מוניות: נסיעות, נהגים, לקוחות ותשלומים. שבוע ניסיון בחינם.</span>
        <a className="btn" target="_blank" rel="noreferrer"
          href={contactLink("היי, אשמח לנסות את מערכת ניהול הנסיעות.\nשם העסק: \nהמייל שלי: " + (email.trim() || ""))}>
          💬 בקשת גישה בוואטסאפ
        </a>
        <a className="btn link small" href="/">מה המערכת יודעת לעשות?</a>
      </div>
    </div>
  );
}
