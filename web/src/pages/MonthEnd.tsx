import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useOrgId } from "../lib/session";
import { money, monthRange, shortTime, today } from "../lib/format";
import type { RideWithNames } from "../types";

type Tab = "customers" | "drivers" | "profit";

export default function MonthEnd() {
  const orgId = useOrgId();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [tab, setTab] = useState<Tab>("customers");
  const [rides, setRides] = useState<RideWithNames[]>([]);
  const [loading, setLoading] = useState(true);

  const { from, to } = monthRange(month);

  const load = () => {
    setLoading(true);
    return supabase
      .from("rides")
      .select("*, customer:customers(name), driver:drivers(name, is_self)")
      .eq("org_id", orgId)
      .eq("status", "active")
      .gte("ride_date", from)
      .lte("ride_date", to)
      .order("ride_date")
      .then(({ data }) => {
        setRides((data ?? []) as RideWithNames[]);
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
              {open.length > 0 && <button className="btn small" onClick={() => markBilled(open.map((r) => r.id))}>סמן כחויב</button>}
            </div>
          </div>
        );
      })}

      {tab === "drivers" && byDriver.map((g) => {
        const open = g.rides.filter((r) => !r.driver_paid_at);
        return (
          <div key={g.key} className="card">
            <div className="row between">
              <strong>{g.name}</strong>
              <span>{money(sum(g.rides, (r) => r.driver_cost))}</span>
            </div>
            <div className="row between small">
              <span className="muted">{g.rides.length} נסיעות · {open.length} לא שולמו ({money(sum(open, (r) => r.driver_cost))})</span>
              {open.length > 0 && <button className="btn small" onClick={() => markPaid(open.map((r) => r.id))}>סמן כשולם</button>}
            </div>
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
