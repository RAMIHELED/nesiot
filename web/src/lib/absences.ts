import { supabase } from "../supabase";

export type Absence = {
  id: string;
  org_id: string;
  driver_id: string | null; // null = all drivers
  start_date: string;
  end_date: string;
  note: string | null;
};

/** Absences that touch the given date range (inclusive). Empty list if the table does not exist yet. */
export async function loadAbsences(orgId: string, from: string, to: string): Promise<Absence[]> {
  const { data, error } = await supabase.from("driver_absences").select("*")
    .eq("org_id", orgId).lte("start_date", to).gte("end_date", from)
    .order("start_date");
  return error ? [] : ((data ?? []) as Absence[]);
}

/** The absence that makes this driver unavailable on this date (his own, or one for all drivers) */
export function absenceOf(driverId: string, date: string, list: Absence[]): Absence | null {
  return list.find((a) => (a.driver_id === driverId || a.driver_id === null) && a.start_date <= date && date <= a.end_date) ?? null;
}

/** An absence for all drivers on this date */
export function allOff(date: string, list: Absence[]): Absence | null {
  return list.find((a) => a.driver_id === null && a.start_date <= date && date <= a.end_date) ?? null;
}

const dm = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d}/${m}`;
};

export function rangeLabel(a: Absence) {
  return a.start_date === a.end_date ? dm(a.start_date) : `${dm(a.start_date)}–${dm(a.end_date)}`;
}
