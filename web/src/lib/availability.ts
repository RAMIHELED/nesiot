// Is a driver free at a given time?
// A ride occupies its driver from pickup time until pickup + driving time + a buffer
// (getting back / waiting at the airport). Without a known driving time we assume 60 minutes.

export const DEFAULT_RIDE_MIN = 60;
export const BUFFER_MIN = 30;

export type TimedRide = {
  id: string;
  driver_id: string | null;
  ride_date: string;
  ride_time: string | null;
  duration_min: number | null;
  pickup: string | null;
  dropoff: string | null;
  status: "active" | "cancelled";
};

export function toMinutes(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

export function interval(r: { ride_time: string | null; duration_min: number | null }) {
  const start = toMinutes(r.ride_time);
  if (start === null) return null;
  return { start, end: start + (r.duration_min ?? DEFAULT_RIDE_MIN) + BUFFER_MIN };
}

export type Availability =
  | { kind: "free" }
  | { kind: "busy"; with: TimedRide }       // overlapping ride
  | { kind: "unknown"; with: TimedRide };   // a ride the same day without a time

/**
 * Availability of one driver for a target ride (same date assumed).
 * `others` = that day's rides; the target ride itself is excluded by id.
 */
export function driverAvailability(
  driverId: string,
  target: { id?: string; ride_time: string | null; duration_min: number | null },
  others: TimedRide[],
): Availability {
  const mine = others.filter((r) => r.driver_id === driverId && r.status === "active" && r.id !== target.id);
  const t = interval(target);
  if (!t) return { kind: "free" }; // no time on the target ride: can't compare
  let unknown: TimedRide | null = null;
  for (const r of mine) {
    const o = interval(r);
    if (!o) {
      unknown ??= r;
      continue;
    }
    if (t.start < o.end && o.start < t.end) return { kind: "busy", with: r };
  }
  return unknown ? { kind: "unknown", with: unknown } : { kind: "free" };
}

export function hhmm(min: number) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
