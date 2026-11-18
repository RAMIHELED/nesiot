// Shown instead of the app when the business's trial ended or it was paused.
// The database already hides the data; this screen explains why and how to reopen.
import { useSession } from "../lib/session";
import { contactLink } from "../lib/contact";

export default function AccountClosed() {
  const { org, orgs, setOrgId, signOut } = useSession();
  if (!org) return null;
  const trialEnded = org.plan_status === "trial";
  const others = orgs.filter((o) => o.id !== org.id && o.is_open);
  const text = trialEnded
    ? `היי רמי, תקופת הניסיון של "${org.name}" במערכת הנסיעות הסתיימה. אשמח להמשיך.`
    : `היי רמי, החשבון של "${org.name}" במערכת הנסיעות סגור. אשמח לפתוח אותו מחדש.`;

  return (
    <div className="login stack">
      <h1>נסיעות</h1>
      <div className="panel stack">
        <strong>{trialEnded ? "תקופת הניסיון הסתיימה" : "החשבון סגור כרגע"}</strong>
        <p>
          הגישה ל"{org.name}" סגורה. הנתונים שמורים ולא נמחקו, והם יחזרו מיד אחרי חידוש המנוי.
        </p>
        <a className="btn primary" href={contactLink(text)} target="_blank" rel="noreferrer">💬 לחידוש בוואטסאפ</a>
      </div>
      {others.length > 0 && (
        <div className="stack">
          <span className="small muted">עסקים אחרים שלך:</span>
          {others.map((o) => <button key={o.id} className="btn" onClick={() => setOrgId(o.id)}>{o.name}</button>)}
        </div>
      )}
      <button className="btn link" onClick={signOut}>יציאה</button>
    </div>
  );
}

/** Small banner during the last week of a trial */
export function TrialBanner({ daysLeft, orgName }: { daysLeft: number; orgName: string }) {
  if (daysLeft > 7) return null;
  const when = daysLeft <= 0 ? "מסתיימת היום" : daysLeft === 1 ? "מסתיימת מחר" : `נשארו ${daysLeft} ימים`;
  return (
    <div className="readonly-banner">
      ⏳ תקופת ניסיון: {when}.{" "}
      <a href={contactLink(`היי רמי, אני משתמש במערכת הנסיעות ("${orgName}") ורוצה להמשיך אחרי הניסיון.`)}
        target="_blank" rel="noreferrer">להמשך בוואטסאפ</a>
    </div>
  );
}
