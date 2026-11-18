import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "./lib/session";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Calendar from "./pages/Calendar";
import RideForm from "./pages/RideForm";
import Customers from "./pages/Customers";
import CustomerCard from "./pages/CustomerCard";
import Admin from "./pages/Admin";
import Drivers from "./pages/Drivers";
import MonthEnd from "./pages/MonthEnd";
import Prices from "./pages/Prices";
import Recurring from "./pages/Recurring";
import Settings from "./pages/Settings";
import DriverResponse from "./pages/DriverResponse";
import VacationsPage from "./pages/VacationsPage";
import DriverLayout from "./components/DriverLayout";
import AccountClosed from "./components/AccountClosed";
import MyRides from "./pages/driver/MyRides";
import MyPay from "./pages/driver/MyPay";
import MyVacations from "./pages/driver/MyVacations";

export default function App() {
  const { session, loading, org, signOut, isAdmin } = useSession();
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

  // Trial ended or business paused: the database hides the data, explain instead of showing empty screens
  if (!org.is_open && !isAdmin) return <AccountClosed />;

  // Drivers get their own small app: only their rides, payments and vacations
  if (org.role === "driver") {
    return (
      <Routes>
        <Route element={<DriverLayout />}>
          <Route path="/" element={<MyRides />} />
          <Route path="/pay" element={<MyPay />} />
          <Route path="/vacations" element={<MyVacations />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Calendar />} />
        <Route path="/rides/new" element={<RideForm />} />
        <Route path="/rides/:id" element={<RideForm />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerCard />} />
        <Route path="/drivers" element={<Drivers />} />
        <Route path="/vacations" element={<VacationsPage />} />
        <Route path="/prices" element={<Prices />} />
        <Route path="/recurring" element={<Recurring />} />
        <Route path="/month" element={<MonthEnd />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
