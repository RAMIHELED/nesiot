import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useCanEdit, useOrgId, useSession } from "../lib/session";
import { driverStatementMessage, toWaPhone, waLink } from "../lib/whatsapp";
import { money, monthRange, shortTime, today } from "../lib/format";
import type { RideWithNames } from "../types";

type Tab = "customers" | "drivers" | "profit";

export default function MonthEnd() {
  const orgId = useOrgId();
  const canEdit = useCanEdit();
  const { org } = useSession();
  const [openDriver, setOpenDriver] = useState<string | null>(null);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [tab, setTab] = useState<Tab>("customers");
  const [rides, setRides] = useState<RideWithNames[]>([]);
  const [loading, setLoading] = useState(true);
  // Payments drivers collected from customers, for this month's rides
  type Collected = { id: string; ride_id: string; amount: number; method: string | null; collected_by: string; settled_at: string | null };
  const [collected, setCollected] = useState<Collected[]>([]);

  const { from, to } = monthRange(month);

  const load = () => {
    setLoading(true);
    return supabase
      .from("rides")
      .select("*, customer:customers(name), driver:drivers(name, is_self, phone)")
      .eq("org_id", orgId)
      .eq("status", "active")
      .gte("ride_date", from)
      .lte("ride_date", to)
      .order("ride_date")
      .then(async ({ data }) => {
        const list = (data ?? []) as RideWithNames[];
        setRides(list);
        const ids = list.map((r) => r.id);
        const { data: cp } = ids.length
          ? await supabase.from("customer_payments").select("id, ride_id, amount, method, collected_by, settled_at")
            .not("collected_by", "is", null).in("ride_id", ids)
          : { data: [] };
        setCollected(((cp ?? []) as Collected[]).map((p) => ({ ...p, amount: Number(p.amount) })));
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  }, [orgId, month]);

  const byCustomer = useMemo(() => group(rides, (r) => r.customer_id ?? "none", (r) => r.customer?.name ?? "ללא לקוח"), [rides]);
  const byDriver = useMemo(
    () => group(rides.filter((r) => r.driver && !r.driver.is_self), (r) => r.driver_id!, (r) => r.driver!.name),
    [rides],
  );

  const revenue = sum(rides, (r) => r.price);
  const cost = sum(rides.filter((r) => r.driver && !r.driver.is_self), (r) => r.driver_cost);

  const markBilled = async (ids: string[]) => {
    await supabase.from("rides").update({ billed_at: new Date().toISOString() }).in("id", ids);
    load();
  };
  const settle = async (ids: string[]) => {
    await supabase.from("customer_payments").update({ settled_at: new Date().toISOString() }).in("id", ids);
    load();
  };
  const markPaid = async (ids: string[]) => {
    await supabase.from("rides").update({ driver_paid_at: new Date().toISOString() }).in("id", ids);
    load();
  };

  const exportCsv = () => {
    const header = ["תאריך", "שעה", "לקוח", "איסוף", "יעד", "טיסה", "נוסעים", "ק״מ", "נהג", "מחיר", "עלות קבלן", "רווח", "חויב", "שולם לנהג"];
    const lines = rides.map((r) => {
      const c = r.driver && !r.driver.is_self ? r.driver_cost ?? 0 : 0;
      return [
        r.ride_date, shortTime(r.ride_time), r.customer?.name ?? "", r.pickup ?? "", r.dropoff ?? "",
        r.flight_number ?? "", r.passengers ?? "", r.distance_km ?? "", r.driver?.name ?? "", r.price ?? "", c,
        r.price != null ? r.price - c : "", r.billed_at ? "כן" : "", r.driver_paid_at ? "כן" : "",
      ].map(csvCell).join(",");
    });
    const blob = new Blob(["﻿" + [header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `נסיעות-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="stack">
      <h2>סוף חודש</h2>
      <div className="row between">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button className="btn" onClick={exportCsv} disabled={!rides.length}>ייצוא לאקסל</button>
      </div>

      <div className="seg">
        <button className={tab === "customers" ? "on" : ""} onClick={() => setTab("customers")}>לקוחות</button>
        <button className={tab === "drivers" ? "on" : ""} onClick={() => setTab("drivers")}>קבלנים</button>
        <button className={tab === "profit" ? "on" : ""} onClick={() => setTab("profit")}>רווח</button>
      </div>

      {loading && <p className="muted">טוען…</p>}

      {tab === "customers" && byCustomer.map((g) => {
        const open = g.rides.filter((r) => !r.billed_at);
        return (
          <div key={g.key} className="card">
            <div className="row between">
              <strong>{g.name}</strong>
              <span>{money(sum(g.rides, (r) => r.price))}</span>
            </div>
            <div className="row between small">
              <span className="muted">{g.rides.length} נסיעות · {open.length} לא חויבו ({money(sum(open, (r) => r.price))})</span>
              {open.length > 0 && canEdit && <button className="btn small" onClick={() => markBilled(open.map((r) => r.id))}>סמן כחויב</button>}
            </div>
          </div>
        );
      })}

      {tab === "drivers" && byDriver.length === 0 && !loading && <p className="muted">אין נסיעות של קבלנים בחודש הזה.</p>}
      {tab === "drivers" && byDriver.map((g) => {
        const open = g.rides.filter((r) => !r.driver_paid_at);
        const t = today();
        const done = g.rides.filter((r) => r.ride_date <= t);
        const partial = to > t;
        const phone = (g.rides[0].driver as { phone?: string | null } | null)?.phone ?? null;
        const missing = done.filter((r) => !r.driver_cost).length;
        const mine = collected.filter((p) => p.collected_by === g.key);
        const held = mine.filter((p) => !p.settled_at);
        const heldSum = held.reduce((s, p) => s + p.amount, 0);
        const owed = sum(open, (r) => r.driver_cost);
        const net = owed - heldSum;
        const expanded = openDriver === g.key;
        return (
          <div key={g.key} className="card stack">
            <div className="row between clickable" onClick={() => setOpenDriver(expanded ? null : g.key)}>
              <strong>{expanded ? "▾" : "◂"} {g.name}</strong>
              <span>{money(sum(g.rides, (r) => r.driver_cost))}</span>
            </div>
            <div className="row between small">
              <span className="muted">{g.rides.length} נסיעות · {open.length} לא שולמו ({money(sum(open, (r) => r.driver_cost))})</span>
              {open.length > 0 && canEdit && <button className="btn small" onClick={() => markPaid(open.map((r) => r.id))}>סמן כשולם</button>}
            </div>
            {mine.length > 0 && (
              <div className="row between small">
                <span>
                  💵 גבה מלקוחות {money(mine.reduce((s, p) => s + p.amount, 0))}
                  {heldSum > 0 ? ` · אצלו ${money(heldSum)}` : " · הכל הוסדר ✓"}
                </span>
                {heldSum > 0 && canEdit && (
                  <button className="btn small" onClick={() => settle(held.map((p) => p.id))}>הכסף התקבל / קוזז</button>
                )}
              </div>
            )}
            {heldSum > 0 && (
              <div className="small">
                <strong className={net >= 0 ? "" : "debt-text"}>
                  {net >= 0 ? `נטו לתשלום לנהג: ${money(net)}` : `נטו הנהג מעביר לך: ${money(-net)}`}
                </strong>
              </div>
            )}
            {expanded && (
              <div className="stack small">
                {g.rides.map((r) => (
                  <div key={r.id} className="row between">
                    <span>{r.ride_date.slice(8, 10)}/{r.ride_date.slice(5, 7)} {shortTime(r.ride_time)} · {r.pickup ?? "?"} ← {r.dropoff ?? "?"}</span>
                    <span>
                      {r.driver_cost ? money(r.driver_cost) : <span className="debt-text">חסר סכום</span>}{r.driver_paid_at ? " ✓" : ""}
                      {mine.find((p) => p.ride_id === r.id) ? ` · 💵 גבה ${money(mine.find((p) => p.ride_id === r.id)!.amount)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {canEdit && done.length > 0 && (
              <div className="row">
                <a className="btn small" target="_blank" rel="noreferrer"
                  href={waLink(phone, driverStatementMessage(g.name, org?.name ?? "", month, done, partial, heldSum))}>
                  💬 שליחת ריכוז לנהג
                </a>
                {!toWaPhone(phone) && <span className="small muted">אין טלפון: וואטסאפ ייפתח לבחירת איש קשר</span>}
                {missing > 0 && <span className="small debt-text">⚠️ ב-{missing} נסיעות חסר סכום לנהג</span>}
              </div>
            )}
          </div>
        );
      })}

      {tab === "profit" && (
        <div className="card stack">
          <div className="row between"><span>הכנסות</span><strong>{money(revenue)}</strong></div>
          <div className="row between"><span>תשלום לקבלנים</span><strong>{money(cost)}</strong></div>
          <div className="row between"><span>רווח</span><strong>{money(revenue - cost)}</strong></div>
          <div className="row between small muted"><span>נסיעות</span><span>{rides.length}</span></div>
        </div>
      )}
    </div>
  );
}

function sum<T>(list: T[], f: (x: T) => number | null) {
  return list.reduce((s, x) => s + Number(f(x) ?? 0), 0);
}

function group(list: RideWithNames[], key: (r: RideWithNames) => string, name: (r: RideWithNames) => string) {
  const map = new Map<string, { key: string; name: string; rides: RideWithNames[] }>();
  for (const r of list) {
    const k = key(r);
    if (!map.has(k)) map.set(k, { key: k, name: name(r), rides: [] });
    map.get(k)!.rides.push(r);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "he"));
}

function csvCell(v: unknown) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
