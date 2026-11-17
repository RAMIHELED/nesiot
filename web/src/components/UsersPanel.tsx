import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../supabase";
import { ROLE_LABELS, useSession, type Role } from "../lib/session";

type Member = { user_id: string; role: Role; email: string | null; driver_id: string | null; driver: { name: string } | null };

/** Owner: who has access to the business, change role, remove, invite */
export default function UsersPanel() {
  const { session, org } = useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "viewer">("member");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    if (!org) return;
    supabase.from("memberships").select("user_id, role, email, driver_id, driver:drivers(name)")
      .eq("org_id", org.id).order("role")
      .then(({ data }) => setMembers((data ?? []) as unknown as Member[]));
  };

  useEffect(() => {
    load();
  }, [org?.id]);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.functions.invoke("invite-user", {
      body: { email, org_id: org.id, role },
    });
    setBusy(false);
    setMsg(error ? "ההזמנה נכשלה" : `${email} יכול/ה עכשיו להיכנס (${ROLE_LABELS[role]})`);
    if (!error) {
      setEmail("");
      load();
    }
  };

  const changeRole = async (m: Member, next: Role) => {
    const { error } = await supabase.from("memberships").update({ role: next })
      .eq("org_id", org!.id).eq("user_id", m.user_id);
    if (error) return setMsg(`שגיאה: ${error.message}`);
    load();
  };

  const removeUser = async (m: Member) => {
    if (!window.confirm(`להסיר את הגישה של ${m.email ?? "המשתמש"}?`)) return;
    const { error } = await supabase.from("memberships").delete().eq("org_id", org!.id).eq("user_id", m.user_id);
    if (error) return setMsg(`שגיאה: ${error.message}`);
    load();
  };

  return (
    <div className="panel stack">
      <strong>משתמשים בעסק</strong>
      {members.map((m) => {
        const me = m.user_id === session?.user.id;
        return (
          <div key={m.user_id} className="row between small user-row">
            <span>
              <span dir="ltr">{m.email ?? "—"}</span>
              {me ? " (אני)" : ""}
              {m.role === "driver" && m.driver ? ` · ${m.driver.name}` : ""}
            </span>
            <span className="row">
              {me || m.role === "driver" || m.role === "owner" ? (
                <span className="role-badge">{ROLE_LABELS[m.role]}</span>
              ) : (
                <select className="inline-select" value={m.role} onChange={(e) => changeRole(m, e.target.value as Role)}>
                  <option value="member">{ROLE_LABELS.member}</option>
                  <option value="viewer">{ROLE_LABELS.viewer}</option>
                </select>
              )}
              {!me && <button className="btn link small" onClick={() => removeUser(m)}>הסרה</button>}
            </span>
          </div>
        );
      })}
      <p className="small muted">
        מנהל: עושה הכל חוץ מניהול משתמשים · צפייה בלבד: רואה הכל ולא משנה · נהג: רק הנסיעות שלו (מוזמנים ממסך נהגים).
      </p>

      <form onSubmit={invite} className="stack">
        <strong className="small">הוספת משתמש</strong>
        <input type="email" dir="ltr" required placeholder="email@example.com"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value as "member" | "viewer")}>
          <option value="member">{ROLE_LABELS.member} – עריכה מלאה</option>
          <option value="viewer">{ROLE_LABELS.viewer}</option>
        </select>
        <button className="btn primary" disabled={busy}>הוספה</button>
        {msg && <p className="small">{msg}</p>}
      </form>
    </div>
  );
}
