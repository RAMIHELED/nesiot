import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../supabase";
import { dayLabel, money } from "../lib/format";

// Public page the driver opens from the WhatsApp link. No login.
type View = {
  business: string;
  driver_name: string;
  ride_date: string;
  ride_time: string;
  pickup: string | null;
  dropoff: string | null;
  flight_number: string | null;
  passengers: number | null;
  notes: string | null;
  driver_cost: number | null;
  distance_km: number | null;
  duration_min: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  driver_status: "none" | "sent" | "confirmed" | "declined";
  cancelled: boolean;
  expired: boolean;
};

async function call(token: string, action: "view" | "confirm" | "decline") {
  const { data, error } = await supabase.functions.invoke("driver-response", { body: { token, action } });
  if (error) {
    // Error responses still carry a JSON body with the reason
    const ctx = (error as { context?: Response }).context;
    const body = ctx ? await ctx.json().catch(() => null) : null;
    return { error: (body?.error as string) ?? "error", ride: body?.ride as View | undefined };
  }
  return { ride: data.ride as View };
}

export default function DriverResponse() {
  const { token = "" } = useParams();
  const [ride, setRide] = useState<View | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    call(token, "view").then((r) => {
      if (r.ride) {
        setRide(r.ride);
        setState("ready");
      } else {
        setState(r.error === "not_found" ? "not_found" : "error");
      }
    });
  }, [token]);

  const answer = async (action: "confirm" | "decline") => {
    if (action === "decline" && !window.confirm("לא יכול לקחת את הנסיעה? הסדרן יקבל הודעה וישבץ נהג אחר.")) return;
    setBusy(true);
    setMsg(null);
    const r = await call(token, action);
    setBusy(false);
    if (r.ride) setRide(r.ride);
    if (r.error === "cancelled") setMsg("הנסיעה בוטלה.");
    else if (r.error === "expired") setMsg("הנסיעה כבר עברה.");
    else if (r.error === "not_found") setState("not_found");
    else if (r.error) setMsg("משהו השתבש. נסו שוב או התקשרו לסדרן.");
  };

  if (state === "loading") return <div className="center muted">טוען…</div>;
  if (state === "not_found") {
    return (
      <div className="driver-page center">
        <h2>הקישור לא פעיל</h2>
        <p className="muted">ייתכן שהנסיעה הועברה לנהג אחר, או שכבר עניתם עליה. לשאלות התקשרו לסדרן.</p>
      </div>
    );
  }
  if (state === "error" || !ride) {
    return <div className="driver-page center"><p className="error">לא הצלחנו לטעון את הנסיעה. נסו שוב מאוחר יותר.</p></div>;
  }

  const closed = ride.cancelled || ride.expired;

  return (
    <div className="driver-page stack">
      <div className="muted small">{ride.business}</div>
      <h2>שלום {ride.driver_name}, נסיעה בשבילך</h2>

      <div className="panel stack">
        <div className="big-line">📅 {dayLabel(ride.ride_date)}{ride.ride_time ? ` · ${ride.ride_time}` : ""}</div>
        {ride.pickup && <div>📍 איסוף: <strong>{ride.pickup}</strong></div>}
        {ride.dropoff && <div>🏁 יעד: <strong>{ride.dropoff}</strong></div>}
        {ride.flight_number && <div>✈️ טיסה: <span dir="ltr">{ride.flight_number}</span></div>}
        {ride.passengers && <div>👥 נוסעים: {ride.passengers}</div>}
        {ride.distance_km && <div>📏 {ride.distance_km} ק״מ{ride.duration_min ? ` (~${ride.duration_min} דק׳)` : ""}</div>}
        {ride.customer_name && (
          <div>
            👤 {ride.customer_name}
            {ride.customer_phone && <> · <a href={`tel:${ride.customer_phone}`} dir="ltr">{ride.customer_phone}</a></>}
          </div>
        )}
        {ride.driver_cost != null && <div>💰 תשלום: <strong>{money(ride.driver_cost)}</strong></div>}
        {ride.notes && <div>📝 {ride.notes}</div>}
      </div>

      {ride.cancelled && <div className="alert">הנסיעה בוטלה.</div>}
      {ride.expired && !ride.cancelled && <div className="alert">הנסיעה כבר עברה.</div>}

      {!closed && ride.driver_status === "confirmed" && (
        <div className="ok-box">✓ אישרת את הנסיעה. תודה!</div>
      )}
      {!closed && ride.driver_status === "declined" && (
        <div className="alert">סימנת שאתה לא יכול. הסדרן קיבל הודעה.</div>
      )}

      {!closed && ride.driver_status !== "declined" && (
        <div className="stack">
          {ride.driver_status !== "confirmed" && (
            <button className="btn primary big" disabled={busy} onClick={() => answer("confirm")}>✓ מאשר, אני לוקח</button>
          )}
          <button className="btn big danger-solid" disabled={busy} onClick={() => answer("decline")}>
            ✗ לא יכול לקחת
          </button>
        </div>
      )}
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}
