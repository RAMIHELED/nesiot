import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import { useOrgId } from "../lib/session";
import { addDays, today } from "../lib/format";
import { loadAbsences, type Absence } from "../lib/absences";
import Vacations from "../components/Vacations";
import type { Driver } from "../types";

export default function VacationsPage() {
  const orgId = useOrgId();
  const [params] = useSearchParams();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loaded, setLoaded] = useState(false);

  const loadAbs = () => loadAbsences(orgId, today(), addDays(today(), 365)).then(setAbsences);

  useEffect(() => {
    supabase.from("drivers").select("*").eq("org_id", orgId).eq("active", true)
      .order("is_self", { ascending: false }).order("name")
      .then(({ data }) => {
        setDrivers((data ?? []) as Driver[]);
        setLoaded(true);
      });
    loadAbs();
  }, [orgId]);

  return (
    <div className="stack">
      <div className="row between">
        <h2>🏖 חופשות</h2>
        <Link to="/drivers" className="btn link">→ חזרה לנהגים</Link>
      </div>
      {loaded && (
        <Vacations orgId={orgId} drivers={drivers} absences={absences} onChange={loadAbs}
          initialDriverId={params.get("driver") ?? ""} />
      )}
    </div>
  );
}
