import { useEffect, useState } from "react";
import { useOrgId } from "../../lib/session";
import { money, monthRange, today } from "../../lib/format";
import { loadMyRides, type MyRide } from "../../lib/myRides";

export default function MyPay() {
  const orgId = useOrgId();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [rides, setRides] = useState<MyRide[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { from, to } = monthRange(month);
    loadMyRides(orgId, from, to < today() ? to : today())
      .then((r) => setRides(r.filter((x) => x.status === "active")))
      .catch((e) => setError(e.message));
  }, [orgId, month]);

  const total = rides.reduce((s, r) => s + (r.driver_cost ?? 0), 0);
  const paid = rides.filter((r) => r.driver_paid_at).reduce((s, r) => s + (r.driver_cost ?? 0), 0);

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
      </div>

      <ul className="cards">
        {rides.map((r) => (
          <li key={r.id} className="card">
            <div className="row between small">
              <span>{r.ride_date.split("-").reverse().slice(0, 2).join("/")} {r.ride_time?.slice(0, 5) ?? ""} · {r.pickup ?? "?"} ← {r.dropoff ?? "?"}</span>
              <span>{money(r.driver_cost)} {r.driver_paid_at ? "✓" : ""}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="small muted">✓ = שולם. נסיעות עתידיות לא נספרות עד שמתבצעות.</p>
    </div>
  );
}
