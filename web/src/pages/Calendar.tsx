import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../supabase";
import { useOrgId } from "../lib/session";
import { addDays, dayLabel, money, shortTime, today } from "../lib/format";
import { hhmm, interval } from "../lib/availability";
import type { Driver, RideWithNames } from "../types";

type Range = "day" | "week";
type Filter = "all" | "unassigned" | "assigned";
type Tag = "cancelled" | "unassigned" | "self" | "contractor";

const tagOf = (r: RideWithNames): Tag =>
  r.status === "cancelled" ? "cancelled" : !r.driver ? "unassigned" : r.driver.is_self ? "self" : "contractor";

export default function Calendar() {
  const orgId = useOrgId();
  const [start, setStart] = useState(today());
  const [range, setRange] = useState<Range>("day");
  const [filter, setFilter] = useState<Filter>("all");
  const [rides, setRides] = useState<RideWithNames[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
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

  useEffect(() => {
    supabase.from("drivers").select("*").eq("org_id", orgId).eq("active", true)
      .order("is_self", { ascending: false }).order("name")
      .then(({ data }) => setDrivers((data ?? []) as Driver[]));
  }, [orgId]);

  const active = rides.filter((r) => r.status === "active");
  const unassigned = active.filter((r) => !r.driver_id).length;

  const visible = rides.filter((r) =>
    filter === "all" ? true
      : filter === "unassigned" ? r.status === "active" && !r.driver_id
        : r.status === "active" && !!r.driver_id);

  const byDay = useMemo(() => {
    const map = new Map<string, RideWithNames[]>();
    for (const r of visible) {
      const list = map.get(r.ride_date) ?? [];
      list.push(r);
      map.set(r.ride_date, list);
    }
    return [...map.entries()];
  }, [visible]);

  const step = range === "day" ? 1 : 7;

  return (
    <div className="stack">
      <div className="row">
        <Link to="/rides/new" className="btn primary big">+ נסיעה חדשה</Link>
        <Link to="/recurring" className="btn">🔁 קבועות</Link>
      </div>

      <div className="row between">
        <button className="btn" onClick={() => setStart(addDays(start, -step))}>→</button>
        <div className="seg">
          <button className={range === "day" ? "on" : ""} onClick={() => setRange("day")}>יום</button>
          <button className={range === "week" ? "on" : ""} onClick={() => setRange("week")}>שבוע</button>
          <button onClick={() => setStart(today())}>היום</button>
        </div>
        <button className="btn" onClick={() => setStart(addDays(start, step))}>←</button>
      </div>

      {range === "day" && <h3 className="day">{dayLabel(start)}</h3>}

      {/* Summary + filter */}
      <div className="summary">
        <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
          הכל <b>{active.length}</b>
        </button>
        <button className={`chip chip-unassigned ${filter === "unassigned" ? "on" : ""}`} onClick={() => setFilter("unassigned")}>
          לא שובצו <b>{unassigned}</b>
        </button>
        <button className={`chip chip-assigned ${filter === "assigned" ? "on" : ""}`} onClick={() => setFilter("assigned")}>
          שובצו <b>{active.length - unassigned}</b>
        </button>
      </div>
      <div className="legend small">
        <span><i className="dot dot-unassigned" />לא שובץ</span>
        <span><i className="dot dot-self" />אני נוהג</span>
        <span><i className="dot dot-contractor" />קבלן</span>
        <span><i className="dot dot-cancelled" />בוטלה</span>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">טוען…</p>}
      {!loading && visible.length === 0 && <p className="muted center">אין נסיעות להצגה</p>}

      {byDay.map(([date, list]) => (
        <section key={date}>
          {range === "week" && <h3 className="day">{dayLabel(date)}</h3>}
          <ul className="cards">
            {list.map((r) => {
              const tag = tagOf(r);
              const profit = r.price != null ? r.price - (r.driver?.is_self ? 0 : r.driver_cost ?? 0) : null;
              return (
                <li key={r.id}>
                  <Link to={`/rides/${r.id}`} className={`card tag-${tag}`}>
                    <div className="row between">
                      <strong>{shortTime(r.ride_time) || "--:--"}{r.recurring_id ? " 🔁" : ""}</strong>
                      <span className={`badge badge-${tag}`}>
                        {tag === "cancelled" ? "בוטלה" : tag === "unassigned" ? "⚠️ לא שובץ"
                          : tag === "self" ? "אני" : r.driver!.name}
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

      {range === "day" && drivers.length > 0 && <DriversDay drivers={drivers} rides={active} />}
    </div>
  );
}

/** Who drives what today, and who is free */
function DriversDay({ drivers, rides }: { drivers: Driver[]; rides: RideWithNames[] }) {
  const rows = drivers.map((d) => {
    const mine = rides.filter((r) => r.driver_id === d.id);
    return { d, mine };
  });
  const free = rows.filter((x) => x.mine.length === 0);
  const busy = rows.filter((x) => x.mine.length > 0);

  return (
    <div className="panel stack">
      <strong>נהגים ביום הזה</strong>
      {busy.map(({ d, mine }) => (
        <div key={d.id} className="driver-row">
          <span className="driver-name">{d.is_self ? `${d.name} (אני)` : d.name}</span>
          <span className="slots">
            {mine.map((r) => {
              const iv = interval(r);
              return (
                <Link key={r.id} to={`/rides/${r.id}`} className="slot">
                  {iv ? `${hhmm(iv.start)}–${hhmm(iv.end)}` : "ללא שעה"}
                </Link>
              );
            })}
          </span>
        </div>
      ))}
      {free.length > 0 && (
        <div className="small">
          <span className="free-label">פנויים כל היום:</span> {free.map((x) => x.d.name).join(", ")}
        </div>
      )}
      <p className="small muted">זמן תפוס = משעת האיסוף ועד סוף הנסיעה המשוערת + חצי שעה (בלי מרחק משוער: שעה).</p>
    </div>
  );
}
