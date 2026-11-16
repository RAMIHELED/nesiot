import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../supabase";
import { useOrgId } from "../lib/session";
import { addDays, dayLabel, money, shortTime, today } from "../lib/format";
import type { RideWithNames } from "../types";

type Range = "day" | "week";

export default function Calendar() {
  const orgId = useOrgId();
  const [start, setStart] = useState(today());
  const [range, setRange] = useState<Range>("week");
  const [rides, setRides] = useState<RideWithNames[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const end = range === "day" ? start : addDays(start, 6);

  useEffect(() => {
    setLoading(true);
    supabase
      .from("rides")
      .select("*, customer:customers(name), driver:drivers(name, is_self)")
      .eq("org_id", orgId)
      .gte("ride_date", start)
      .lte("ride_date", end)
      .order("ride_date")
      .order("ride_time", { nullsFirst: true })
      .then(({ data, error }) => {
        setError(error ? error.message : null);
        setRides((data ?? []) as RideWithNames[]);
        setLoading(false);
      });
  }, [orgId, start, end]);

  const byDay = useMemo(() => {
    const map = new Map<string, RideWithNames[]>();
    for (const r of rides) {
      const list = map.get(r.ride_date) ?? [];
      list.push(r);
      map.set(r.ride_date, list);
    }
    return [...map.entries()];
  }, [rides]);

  const unassigned = rides.filter((r) => r.status === "active" && !r.driver_id).length;
  const step = range === "day" ? 1 : 7;

  return (
    <div className="stack">
      <Link to="/rides/new" className="btn primary big">+ נסיעה חדשה</Link>

      <div className="row between">
        <button className="btn" onClick={() => setStart(addDays(start, -step))}>→</button>
        <div className="seg">
          <button className={range === "day" ? "on" : ""} onClick={() => setRange("day")}>יום</button>
          <button className={range === "week" ? "on" : ""} onClick={() => setRange("week")}>שבוע</button>
          <button onClick={() => setStart(today())}>היום</button>
        </div>
        <button className="btn" onClick={() => setStart(addDays(start, step))}>←</button>
      </div>

      {unassigned > 0 && <div className="alert">{unassigned} נסיעות עדיין לא שובצו</div>}
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">טוען…</p>}
      {!loading && rides.length === 0 && <p className="muted center">אין נסיעות בטווח הזה</p>}

      {byDay.map(([date, list]) => (
        <section key={date}>
          <h3 className="day">{dayLabel(date)}</h3>
          <ul className="cards">
            {list.map((r) => {
              const tag = r.status === "cancelled" ? "cancelled"
                : !r.driver ? "unassigned" : r.driver.is_self ? "self" : "contractor";
              const profit = r.price != null ? r.price - (r.driver?.is_self ? 0 : r.driver_cost ?? 0) : null;
              return (
                <li key={r.id}>
                  <Link to={`/rides/${r.id}`} className={`card tag-${tag}`}>
                    <div className="row between">
                      <strong>{shortTime(r.ride_time) || "--:--"}</strong>
                      <span className="badge">
                        {tag === "cancelled" ? "בוטלה" : tag === "unassigned" ? "לא שובץ"
                          : tag === "self" ? "שלי" : r.driver!.name}
                      </span>
                    </div>
                    <div>{r.pickup ?? "?"} ← {r.dropoff ?? "?"}</div>
                    <div className="row between small muted">
                      <span>
                        {r.customer?.name ?? "ללא לקוח"}
                        {r.flight_number ? ` · ${r.flight_number}` : ""}
                        {r.passengers ? ` · ${r.passengers} נוסעים` : ""}
                        {r.distance_km ? ` · ${r.distance_km} ק״מ` : ""}
                      </span>
                      <span>{money(r.price)}{profit != null && tag === "contractor" ? ` (רווח ${money(profit)})` : ""}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
