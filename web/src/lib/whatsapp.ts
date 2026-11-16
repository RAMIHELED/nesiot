import { dayLabel, shortTime } from "./format";

// Israeli phone → international digits for wa.me (050-1234567 → 972501234567)
export function toWaPhone(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "972" + digits.slice(1);
  return digits.length >= 11 ? digits : null;
}

export type RideMessageInput = {
  ride_date: string;
  ride_time: string | null;
  pickup: string | null;
  dropoff: string | null;
  flight_number: string | null;
  passengers: number | null;
  notes: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  driver_cost?: number | null;
  distance_km?: number | null;
  duration_min?: number | null;
};

export function rideMessage(r: RideMessageInput): string {
  const lines = [
    "🚖 נסיעה חדשה",
    `📅 ${dayLabel(r.ride_date)}${r.ride_time ? ` בשעה ${shortTime(r.ride_time)}` : ""}`,
    r.pickup ? `📍 איסוף: ${r.pickup}` : "",
    r.dropoff ? `🏁 יעד: ${r.dropoff}` : "",
    r.flight_number ? `✈️ טיסה: ${r.flight_number}` : "",
    r.passengers ? `👥 נוסעים: ${r.passengers}` : "",
    r.distance_km ? `📏 מרחק משוער: ${r.distance_km} ק״מ${r.duration_min ? ` (~${r.duration_min} דק׳)` : ""}` : "",
    r.customer_name ? `👤 לקוח: ${r.customer_name}${r.customer_phone ? ` ${r.customer_phone}` : ""}` : "",
    r.driver_cost ? `💰 תשלום לנהג: ${r.driver_cost} ₪` : "",
    r.notes ? `📝 ${r.notes}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export function waLink(phone: string | null, text: string): string {
  const p = toWaPhone(phone);
  const q = encodeURIComponent(text);
  return p ? `https://wa.me/${p}?text=${q}` : `https://wa.me/?text=${q}`;
}
