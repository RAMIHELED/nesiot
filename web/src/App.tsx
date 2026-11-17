import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "./lib/session";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Calendar from "./pages/Calendar";
import RideForm from "./pages/RideForm";
import Customers from "./pages/Customers";
import Drivers from "./pages/Drivers";
import MonthEnd from "./pages/MonthEnd";
import Prices from "./pages/Prices";
import Recurring from "./pages/Recurring";
import Settings from "./pages/Settings";
import DriverResponse from "./pages/DriverResponse";
import VacationsPage from "./pages/VacationsPage";

export default function App() {
  const { session, loading, org, signOut } = useSession();
  const location = useLocation();

  // Public page for drivers (no login): /d/<token>
  if (location.pathname.startsWith("/d/")) {
    return (
      <Routes>
        <Route path="/d/:token" element={<DriverResponse />} />
      </Routes>
    );
  }

  if (loading) return <div className="center muted">טוען…</div>;
  if (!session) return <Login />;
  if (!org) {
    return (
      <div className="center">
        <p>המשתמש עדיין לא משויך לעסק. פנו למנהל המערכת.</p>
        <button className="btn" onClick={signOut}>יציאה</button>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Calendar />} />
        <Route path="/rides/new" element={<RideForm />} />
        <Route path="/rides/:id" element={<RideForm />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/drivers" element={<Drivers />} />
        <Route path="/vacations" element={<VacationsPage />} />
        <Route path="/prices" element={<Prices />} />
        <Route path="/recurring" element={<Recurring />} />
        <Route path="/month" element={<MonthEnd />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
