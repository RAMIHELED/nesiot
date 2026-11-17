import { useEffect, useMemo, useState } from "react";
import { useOrgId } from "../../lib/session";
import { addDays, dayLabel, money, today } from "../../lib/format";
import { loadMyRides, respond, type MyRide } from "../../lib/myRides";

export default function MyRides() {
  const orgId = useOrgId();
  const [rides, setRides] = useState<MyRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    loadMyRides(orgId, today(), addDays(today(), 30))
      .then((r) => { setRides(r); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [orgId]);

  const answer = async (r: MyRide, action: "confirm" | "decline") => {
    if (!r.driver_token) return;
    if (action === "decline" && !window.confirm("לא יכול לקחת את הנסיעה? הסדרן יקבל הודעה וישבץ נהג אחר.")) return;
    setBusyId(r.id);
    try {
      await respond(r.driver_token, action);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const byDay = useMemo(() => {
    const map = new Map<string, MyRide[]>();
    for (const r of rides) map.set(r.ride_date, [...(map.get(r.ride_date) ?? []), r]);
    return [...map.entries()];
  }, [rides]);

  const waiting = rides.filter((r) => r.status === "active" && r.driver_status !== "confirmed").length;

  return (
    <div className="stack">
      <h2>הנסיעות שלי</h2>
      {waiting > 0 && <div className="alert">⏳ {waiting} נסיעות מחכות לאישור שלך</div>}
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">טוען…</p>}
      {!loading && rides.length === 0 && <p className="muted center">אין לך נסיעות בחודש הקרוב.</p>}

      {byDay.map(([date, list]) => (
        <section key={date}>
          <h3 className="day">{dayLabel(date)}</h3>
          <ul className="cards">
            {list.map((r) => {
              const cancelled = r.status === "cancelled";
              return (
                <li key={r.id} className={`card ${cancelled ? "tag-cancelled" : r.driver_status === "confirmed" ? "tag-self" : "tag-unassigned"}`}>
                  <div className="row between">
                    <strong>{r.ride_time?.slice(0, 5) ?? "--:--"}</strong>
                    <span className={`badge ${r.driver_status === "confirmed" ? "badge-self" : ""}`}>
                      {cancelled ? "בוטלה" : r.driver_status === "confirmed" ? "✓ אישרת" : "⏳ ממתין לאישור"}
                    </span>
                  </div>
                  <div>📍 {r.pickup ?? "?"} ← 🏁 {r.dropoff ?? "?"}</div>
                  <div className="small muted">
                    {r.flight_number ? `✈️ ${r.flight_number} · ` : ""}
                    {r.passengers ? `👥 ${r.passengers} · ` : ""}
                    {r.distance_km ? `📏 ${r.distance_km} ק״מ · ` : ""}
                    {r.driver_cost != null ? `💰 ${money(r.driver_cost)}` : ""}
                  </div>
                  {r.customer_name && (
                    <div className="small">
                      👤 {r.customer_name}
                      {r.customer_phone && <> · <a href={`tel:${r.customer_phone}`} dir="ltr">{r.customer_phone}</a></>}
                    </div>
                  )}
                  {r.notes && <div className="small">📝 {r.notes}</div>}
                  {!cancelled && r.driver_token && (
                    <div className="row">
                      {r.driver_status !== "confirmed" && (
                        <button className="btn primary small" disabled={busyId === r.id} onClick={() => answer(r, "confirm")}>✓ מאשר</button>
                      )}
                      <button className="btn small danger-solid" disabled={busyId === r.id} onClick={() => answer(r, "decline")}>✗ לא יכול</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
