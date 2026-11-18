import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../supabase";
import { useCanEdit, useOrgId, useSession } from "../lib/session";
import { addDays, dayLabel, money, shortTime, today } from "../lib/format";
import { hhmm, interval } from "../lib/availability";
import { customerReminderMessage, scheduleMessage, toWaPhone, waLink } from "../lib/whatsapp";
import { absenceOf, allOff, loadAbsences, type Absence } from "../lib/absences";
import type { Driver, RideWithNames } from "../types";

type Range = "day" | "week";
type Filter = "all" | "unassigned" | "assigned" | "unconfirmed";
type Tag = "cancelled" | "unassigned" | "self" | "contractor";

const tagOf = (r: RideWithNames): Tag =>
  r.status === "cancelled" ? "cancelled" : !r.driver ? "unassigned" : r.driver.is_self ? "self" : "contractor";

export default function Calendar() {
  const orgId = useOrgId();
  const canEdit = useCanEdit();
  const [start, setStart] = useState(today());
  const [range, setRange] = useState<Range>("day");
  const [filter, setFilter] = useState<Filter>("all");
  const [rides, setRides] = useState<RideWithNames[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const end = range === "day" ? start : addDays(start, 6);

  useEffect(() => {
    setLoading(true);
    supabase
      .from("rides")
      .select("*, customer:customers(name, phone), driver:drivers(name, is_self, phone, car_model, car_plate)")
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
    loadAbsences(orgId, start, end).then(setAbsences);
  }, [orgId, start, end]);

  useEffect(() => {
    supabase.from("drivers").select("*").eq("org_id", orgId).eq("active", true)
      .order("is_self", { ascending: false }).order("name")
      .then(({ data }) => setDrivers((data ?? []) as Driver[]));
  }, [orgId]);

  const active = rides.filter((r) => r.status === "active");
  const unassigned = active.filter((r) => !r.driver_id).length;
  // Contractor rides the driver has not confirmed yet
  const isUnconfirmed = (r: RideWithNames) =>
    r.status === "active" && !!r.driver && !r.driver.is_self && r.driver_status !== "confirmed";
  const unconfirmed = active.filter(isUnconfirmed).length;
  const driverName = (id: string) => drivers.find((d) => d.id === id)?.name;

  const visible = rides.filter((r) =>
    filter === "all" ? true
      : filter === "unassigned" ? r.status === "active" && !r.driver_id
        : filter === "unconfirmed" ? isUnconfirmed(r)
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
        {canEdit && <Link to="/rides/new" className="btn primary big">+ נסיעה חדשה</Link>}
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
      {range === "day" && allOff(start, absences) && (
        <div className="alert">🏖 כל הנהגים בחופשה היום{allOff(start, absences)!.note ? ` (${allOff(start, absences)!.note})` : ""}</div>
      )}

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
        {unconfirmed > 0 && (
          <button className={`chip chip-unassigned ${filter === "unconfirmed" ? "on" : ""}`} onClick={() => setFilter("unconfirmed")}>
            ⏳ לא אישרו <b>{unconfirmed}</b>
          </button>
        )}
      </div>
      <div className="legend small">
        <span><i className="dot dot-unassigned" />לא שובץ</span>
        <span><i className="dot dot-self" />אני נוהג</span>
        <span><i className="dot dot-contractor" />קבלן</span>
        <span><i className="dot dot-cancelled" />בוטלה</span>
        <span>✓ אישר · ⏳ ממתין לאישור</span>
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
                          : tag === "self" ? "אני"
                            : `${r.driver_status === "confirmed" ? "✓ " : r.driver_status === "sent" ? "⏳ " : ""}${r.driver!.name}`}
                      </span>
                    </div>
                    <div>{r.pickup ?? "?"} ← {r.dropoff ?? "?"}</div>
                    {tag === "unassigned" && r.driver_status === "declined" && r.declined_driver_ids?.length > 0 && (
                      <div className="small declined">✗ {r.declined_driver_ids.map(driverName).filter(Boolean).join(", ")} סירב</div>
                    )}
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

      {range === "day" && canEdit && active.some((r) => r.customer_id) && (
        <CustomersDay rides={active} date={start}
          onSent={(ids, at) => setRides((rs) => rs.map((r) => ids.includes(r.id) ? { ...r, customer_reminded_at: at } : r))} />
      )}

      {range === "day" && drivers.length > 0 && (
        <DriversDay drivers={drivers} rides={active} date={start} absences={absences} canEdit={canEdit}
          onSent={(ids, at) => setRides((rs) => rs.map((r) => ids.includes(r.id) ? { ...r, driver_status: "sent", driver_sent_at: at } : r))} />
      )}
    </div>
  );
}

/** Who drives what today, and who is free */
function DriversDay({ drivers, rides, date, absences, canEdit, onSent }: {
  drivers: Driver[]; rides: RideWithNames[]; date: string; absences: Absence[];
  canEdit: boolean; onSent: (rideIds: string[], at: string) => void;
}) {
  const [sentNow, setSentNow] = useState<Set<string>>(new Set());

  const scheduleFor = (d: Driver, mine: RideWithNames[]) => scheduleMessage(d.name, date, mine.map((r) => ({
    ride_time: r.ride_time, pickup: r.pickup, dropoff: r.dropoff, flight_number: r.flight_number,
    passengers: r.passengers, notes: r.notes, driver_cost: r.driver_cost,
    customer_name: r.customer?.name, customer_phone: r.customer?.phone,
    response_url: r.driver_status !== "confirmed" && r.driver_token ? `${window.location.origin}/d/${r.driver_token}` : null,
  })));

  // Opening WhatsApp counts as sending: rides wait for the driver's confirmation from now
  const markSent = async (d: Driver, mine: RideWithNames[]) => {
    setSentNow((s) => new Set(s).add(d.id));
    const ids = mine.filter((r) => r.driver_status === "none").map((r) => r.id);
    if (ids.length === 0) return;
    const at = new Date().toISOString();
    const { error } = await supabase.from("rides")
      .update({ driver_status: "sent", driver_sent_at: at, unconfirmed_alert_at: null }).in("id", ids);
    if (!error) onSent(ids, at);
  };

  const rows = drivers.map((d) => {
    const mine = rides.filter((r) => r.driver_id === d.id);
    return { d, mine, away: absenceOf(d.id, date, absences) };
  });
  const onVacation = rows.filter((x) => x.away && x.mine.length === 0);
  const free = rows.filter((x) => x.mine.length === 0 && !x.away);
  const busy = rows.filter((x) => x.mine.length > 0);

  return (
    <div className="panel stack">
      <strong>נהגים ביום הזה</strong>
      {canEdit && busy.some((x) => !x.d.is_self) && (
        <p className="small muted">💬 סידור = הודעת וואטסאפ אחת לנהג עם כל הנסיעות שלו ביום הזה וקישור אישור לכל נסיעה. מומלץ לשלוח בערב על מחר.</p>
      )}
      {busy.map(({ d, mine }) => (
        <div key={d.id} className="driver-row">
          <span className="driver-name">{d.is_self ? `${d.name} (אני)` : d.name}{absenceOf(d.id, date, absences) ? " ⚠️🏖" : ""}</span>
          {canEdit && !d.is_self && (() => {
            const allConfirmed = mine.every((r) => r.driver_status === "confirmed");
            const allSent = mine.every((r) => r.driver_status !== "none");
            const label = sentNow.has(d.id) ? "נשלח ✓" : allConfirmed ? "✓ אישר הכל" : allSent ? "⏳ שליחה שוב" : "💬 סידור";
            return toWaPhone(d.phone)
              ? <a className="btn small" href={waLink(d.phone, scheduleFor(d, mine))} target="_blank" rel="noreferrer"
                  onClick={() => markSent(d, mine)}>{label}</a>
              : <span className="small muted">אין טלפון</span>;
          })()}
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
      {onVacation.length > 0 && (
        <div className="small">
          <span className="vacation-label">🏖 בחופשה:</span> {onVacation.map((x) => x.d.name).join(", ")}
        </div>
      )}
      {free.length > 0 && (
        <div className="small">
          <span className="free-label">פנויים כל היום:</span> {free.map((x) => x.d.name).join(", ")}
        </div>
      )}
      <p className="small muted">זמן תפוס = משעת האיסוף ועד סוף הנסיעה המשוערת + חצי שעה (בלי מרחק משוער: שעה).</p>
    </div>
  );
}

/** WhatsApp reminder to each customer with rides on this day */
function CustomersDay({ rides, date, onSent }: {
  rides: RideWithNames[]; date: string; onSent: (rideIds: string[], at: string) => void;
}) {
  const { org } = useSession();
  const groups = new Map<string, RideWithNames[]>();
  for (const r of rides) {
    if (!r.customer_id) continue;
    groups.set(r.customer_id, [...(groups.get(r.customer_id) ?? []), r]);
  }
  const list = [...groups.values()];
  const sentCount = list.filter((g) => g.every((r) => r.customer_reminded_at)).length;

  const send = async (g: RideWithNames[]) => {
    const at = new Date().toISOString();
    const ids = g.map((r) => r.id);
    const { error } = await supabase.from("rides").update({ customer_reminded_at: at }).in("id", ids);
    if (!error) onSent(ids, at);
  };

  return (
    <div className="panel stack">
      <div className="row between">
        <strong>תזכורת ללקוחות</strong>
        <span className="small muted">{sentCount}/{list.length} נשלחו</span>
      </div>
      {list.map((g) => {
        const c = g[0].customer!;
        const sent = g.every((r) => r.customer_reminded_at);
        const noDriver = g.some((r) => !r.driver);
        const text = customerReminderMessage(c.name, org?.name ?? "", date, g.map((r) => ({
          ride_time: r.ride_time, pickup: r.pickup, dropoff: r.dropoff, flight_number: r.flight_number, passengers: r.passengers,
          driver_name: r.driver?.name, driver_phone: r.driver?.phone, car_model: r.driver?.car_model, car_plate: r.driver?.car_plate,
        })));
        return (
          <div key={g[0].customer_id} className="driver-row">
            <span className="driver-name">{c.name}</span>
            <span className="small muted">{g.map((r) => shortTime(r.ride_time) || "ללא שעה").join(", ")}</span>
            {noDriver && <span className="small debt-text">אין נהג עדיין</span>}
            <a className="btn small" href={waLink(c.phone ?? null, text)} target="_blank" rel="noreferrer" onClick={() => send(g)}>
              {sent ? "✓ נשלחה · שוב" : "💬 תזכורת"}
            </a>
            {!toWaPhone(c.phone ?? null) && <span className="small muted">אין טלפון</span>}
          </div>
        );
      })}
      <p className="small muted">הודעה ללקוח עם השעה, הכתובת והנהג (שם, טלפון, רכב). מומלץ לשלוח בערב על מחר, אחרי ששובצו נהגים.</p>
    </div>
  );
}
