import { NavLink, Outlet } from "react-router-dom";
import { ROLE_LABELS, useSession } from "../lib/session";

export default function Layout() {
  const { org } = useSession();
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">נסיעות</span>
        <span className="muted small">{org?.name}</span>
      </header>
      {org?.role === "viewer" && <div className="readonly-banner">👁 {ROLE_LABELS.viewer}: אפשר לראות הכל, בלי לשנות</div>}
      <main className="content">
        <Outlet />
      </main>
      <nav className="tabbar">
        <NavLink to="/" end>יומן</NavLink>
        <NavLink to="/customers">לקוחות</NavLink>
        <NavLink to="/drivers">נהגים</NavLink>
        <NavLink to="/prices">מחירון</NavLink>
        <NavLink to="/month">סוף חודש</NavLink>
        <NavLink to="/settings">הגדרות</NavLink>
      </nav>
    </div>
  );
}
