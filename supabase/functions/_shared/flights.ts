// Ben Gurion flight data from the Israel Airports Authority (data.gov.il, updated every 15 minutes).
// Free, no key. Covers flights around the current days at TLV.

const API = "https://data.gov.il/api/3/action/datastore_search";
const RESOURCE = "e83f763b-b7d7-479e-b172-ae981ddc6de5";

export type AirportFlight = {
  CHOPER: string;   // airline code, e.g. LY
  CHFLTN: string;   // flight number, e.g. 315
  CHSTOL: string;   // scheduled time
  CHPTOL: string;   // updated / actual time
  CHAORD: string;   // A = arrival, D = departure
  CHLOC1T: string;  // city (English)
  CHLOC1TH: string; // city (Hebrew)
  CHRMINE: string;  // status (English)
  CHRMINH: string;  // status (Hebrew)
  CHTERM: number;
};

/** "LY 315", "ly315", "W6-2302" → { airline: "LY", number: "315" } */
export function parseFlight(raw: string): { airline: string; number: string } | null {
  const m = raw.toUpperCase().replace(/[\s\-_.]/g, "").match(/^([A-Z0-9]{2})(\d{1,4})[A-Z]?$/);
  if (!m) return null;
  // Airline codes can be letter+digit (W6, 5C); the rest must be the number
  return { airline: m[1], number: String(Number(m[2])) };
}

/** Airport times come without a zone; they are Israel local time. */
export function israelTimeToIso(local: string): string | null {
  if (!local) return null;
  const s = local.replace(" ", "T").slice(0, 19);
  // Find Israel's offset for that moment (+02:00 winter / +03:00 summer)
  const guess = new Date(s + "Z");
  const inIsrael = new Date(guess.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  const offsetMs = inIsrael.getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(guess.getTime() - offsetMs).toISOString();
}

/**
 * The airport record for this flight on this date. direction 'A'/'D' when known (pickup or drop-off at the airport).
 * Returns null when the airport has no such flight in its current data.
 */
export async function findFlight(flight: string, rideDate: string, direction: "A" | "D" | null): Promise<AirportFlight | null> {
  const f = parseFlight(flight);
  if (!f) return null;
  const url = new URL(API);
  url.searchParams.set("resource_id", RESOURCE);
  url.searchParams.set("filters", JSON.stringify({ CHOPER: f.airline, CHFLTN: f.number }));
  url.searchParams.set("limit", "20");
  let records = await query(url);
  if (!records.length) {
    // The airport may write the number with leading zeros ("0315"): search by airline and compare as numbers
    url.searchParams.set("filters", JSON.stringify({ CHOPER: f.airline }));
    url.searchParams.set("q", f.number);
    url.searchParams.set("limit", "100");
    records = (await query(url)).filter((r) => String(Number(r.CHFLTN)) === f.number);
  }
  const candidates = records.filter((r) =>
    (!direction || r.CHAORD === direction) && (r.CHSTOL ?? "").slice(0, 10) === rideDate);
  if (candidates.length) return candidates[0];
  // A night flight can be dated the day before / after the ride (e.g. 00:30 landing for a 23:00 booking)
  const near = records.filter((r) => !direction || r.CHAORD === direction)
    .map((r) => ({ r, d: Math.abs(Date.parse(r.CHSTOL.slice(0, 10)) - Date.parse(rideDate)) }))
    .filter((x) => x.d <= 864e5)
    .sort((a, b) => a.d - b.d);
  return near[0]?.r ?? null;
}

async function query(url: URL): Promise<AirportFlight[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "nesiot/1.0" } });
  if (!res.ok) throw new Error(`data.gov.il ${res.status}`);
  const body = await res.json();
  return (body?.result?.records ?? []) as AirportFlight[];
}

/** Is the airport the pickup (arrival) or the drop-off (departure)? */
export function directionOf(pickup: string | null, dropoff: string | null): "A" | "D" | null {
  const isAirport = (s: string | null) => !!s && /נתב|נמל התעופה|בן.?גוריון|TLV|airport/i.test(s);
  if (isAirport(pickup)) return "A";
  if (isAirport(dropoff)) return "D";
  return null;
}

export type RideFlight = {
  id: string; org_id: string; flight_number: string; ride_date: string; ride_time: string | null;
  pickup: string | null; dropoff: string | null; customer_name?: string | null;
  flight_status?: string | null; flight_estimated?: string | null; flight_scheduled?: string | null;
  flight_alert_key?: string | null;
};

const hm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" }) : "";

/**
 * Looks the flight up, saves the result on the ride, and says whether the business should be notified.
 * `admin` is a service-role client.
 */
// deno-lint-ignore no-explicit-any
export async function refreshRideFlight(admin: any, ride: RideFlight): Promise<{
  found: boolean; status?: string; status_he?: string; scheduled?: string | null; estimated?: string | null;
  direction?: string;
  alert?: { title: string; body: string };
}> {
  const dir = directionOf(ride.pickup, ride.dropoff);
  const rec = await findFlight(ride.flight_number, ride.ride_date, dir);
  const now = new Date().toISOString();
  if (!rec) {
    await admin.from("rides").update({ flight_checked_at: now }).eq("id", ride.id);
    return { found: false };
  }
  const scheduled = israelTimeToIso(rec.CHSTOL);
  const estimated = israelTimeToIso(rec.CHPTOL) ?? scheduled;
  const status = (rec.CHRMINE ?? "").trim().toUpperCase();
  const delayMin = scheduled && estimated ? Math.round((Date.parse(estimated) - Date.parse(scheduled)) / 60000) : 0;
  const arrival = rec.CHAORD === "A";

  // What is worth a notification, and a key so the same news is sent once
  let key: string | null = null;
  let what = "";
  if (status.startsWith("CANCEL")) {
    key = "C"; what = "הטיסה בוטלה";
  } else if (arrival && status === "LANDED") {
    key = "L"; what = `נחתה ב-${hm(estimated)}`;
  } else if (delayMin >= (arrival ? 20 : 60)) {
    key = `D${Math.floor(delayMin / 20)}`;
    what = `עיכוב של ${delayMin} דק׳: ${arrival ? "נחיתה" : "המראה"} צפויה ${hm(estimated)} (במקום ${hm(scheduled)})`;
  }
  const alertNow = key !== null && key !== ride.flight_alert_key;

  await admin.from("rides").update({
    flight_status: status || null,
    flight_status_he: (rec.CHRMINH ?? "").trim() || null,
    flight_direction: rec.CHAORD,
    flight_scheduled: scheduled,
    flight_estimated: estimated,
    flight_checked_at: now,
    ...(alertNow ? { flight_alert_key: key } : {}),
  }).eq("id", ride.id);

  return {
    found: true, status, status_he: rec.CHRMINH, scheduled, estimated, direction: rec.CHAORD,
    alert: alertNow ? {
      title: `✈️ ${ride.flight_number.toUpperCase()}${ride.customer_name ? ` · ${ride.customer_name}` : ""}`,
      body: `${what}. האיסוף ב-${(ride.ride_time ?? "").slice(0, 5)}`,
    } : undefined,
  };
}
