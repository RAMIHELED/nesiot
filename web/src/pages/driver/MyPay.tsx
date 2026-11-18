import { useEffect, useState } from "react";
import { useDriverOrgs } from "../../lib/session";
import { money, monthRange, today } from "../../lib/format";
import { loadMyRidesAll, type MyRide } from "../../lib/myRides";

export default function MyPay() {
  const multi = useDriverOrgs().length > 1;
  const [month, setMonth] = useState(today().slice(0, 7));
  const [rides, setRides] = useState<MyRide[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { from, to } = monthRange(month);
    loadMyRidesAll(from, to < today() ? to : today())
      .then((r) => setRides(r.filter((x) => x.status === "active")))
      .catch((e) => setError(e.message));
  }, [month]);

  const total = rides.reduce((s, r) => s + (r.driver_cost ?? 0), 0);
  const paid = rides.filter((r) => r.driver_paid_at).reduce((s, r) => s + (r.driver_cost ?? 0), 0);
  // Money he collected from customers and did not hand over yet: offset against what he is owed
  const heldCash = rides.filter((r) => r.collected_amount != null && !r.collected_settled).reduce((s, r) => s + (r.collected_amount ?? 0), 0);
  const net = total - paid - heldCash;
  const byOrg = [...new Set(rides.map((r) => r.org_name ?? ""))].map((name) => {
    const list = rides.filter((r) => (r.org_name ?? "") === name);
    const t = list.reduce((s, r) => s + (r.driver_cost ?? 0), 0);
    const p = list.filter((r) => r.driver_paid_at).reduce((s, r) => s + (r.driver_cost ?? 0), 0);
    return { name, count: list.length, total: t, open: t - p };
  });

  return (
    <div className="stack">
      <h2>התשלומים שלי</h2>
      <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      {error && <p className="error">{error}</p>}

      <div className="card stack">
        <div className="row between"><span>נסיעות שביצעת</span><strong>{rides.length}</strong></div>
        <div className="row between"><span>סה״כ מגיע לך</span><strong>{money(total)}</strong></div>
        <div className="row between"><span>שולם</span><strong>{money(paid)}</strong></div>
        <div className="row between"><span>נשאר לתשלום</span><strong className={total - paid > 0 ? "debt-text" : "ok-text"}>{money(total - paid)}</strong></div>
        {heldCash > 0 && <>
          <div className="row between"><span>גבית מלקוחות (עוד לא הוסדר)</span><strong>{money(heldCash)}</strong></div>
          <div className="row between">
            <span>{net >= 0 ? "נטו מגיע לך" : "נטו להעביר לסדרן"}</span>
            <strong className={net >= 0 ? "ok-text" : "debt-text"}>{money(Math.abs(net))}</strong>
          </div>
        </>}
      </div>

      {multi && byOrg.length > 0 && (
        <div className="card stack">
          <strong className="small">לפי עסק</strong>
          {byOrg.map((o) => (
            <div key={o.name} className="row between small">
              <span>{o.name} · {o.count} נסיעות</span>
              <span>{money(o.total)}{o.open > 0 ? ` · נשאר ${money(o.open)}` : " ✓"}</span>
            </div>
          ))}
        </div>
      )}

      <ul className="cards">
        {rides.map((r) => (
          <li key={r.id} className="card">
            <div className="row between small">
              <span>{r.ride_date.split("-").reverse().slice(0, 2).join("/")} {r.ride_time?.slice(0, 5) ?? ""} · {r.pickup ?? "?"} ← {r.dropoff ?? "?"}{multi && r.org_name ? ` · ${r.org_name}` : ""}</span>
              <span>{money(r.driver_cost)} {r.driver_paid_at ? "✓" : ""}{r.collected_amount != null ? ` · גבית ${money(r.collected_amount)}` : ""}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="small muted">✓ = שולם. נסיעות עתידיות לא נספרות עד שמתבצעות.</p>
    </div>
  );
}
