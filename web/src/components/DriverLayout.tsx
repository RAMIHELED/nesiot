import { NavLink, Outlet } from "react-router-dom";
import { useDriverOrgs, useSession } from "../lib/session";

export default function DriverLayout() {
  const { org } = useSession();
  const driverOrgs = useDriverOrgs();
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">נסיעות · נהג</span>
        <span className="muted small">{driverOrgs.length > 1 ? `${driverOrgs.length} עסקים` : org?.name}</span>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <nav className="tabbar tabbar-4">
        <NavLink to="/" end>הנסיעות שלי</NavLink>
        <NavLink to="/pay">תשלומים</NavLink>
        <NavLink to="/vacations">חופשות</NavLink>
        <NavLink to="/settings">הגדרות</NavLink>
      </nav>
    </div>
  );
}
