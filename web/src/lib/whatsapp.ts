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
  /** Personal confirm/decline link for the driver */
  response_url?: string | null;
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
    r.response_url ? `\n👉 לאישור או אם אינך יכול: ${r.response_url}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export type ScheduleRide = {
  ride_time: string | null;
  pickup: string | null;
  dropoff: string | null;
  flight_number: string | null;
  passengers: number | null;
  notes: string | null;
  driver_cost: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  /** Confirmation link, only for rides the driver has not confirmed yet */
  response_url?: string | null;
};

/** One message with all of a driver's rides for a day */
export function scheduleMessage(driverName: string, date: string, rides: ScheduleRide[]): string {
  const total = rides.reduce((s, r) => s + Number(r.driver_cost ?? 0), 0);
  const blocks = rides.map((r, i) => [
    `${i + 1}. 🕐 ${r.ride_time ? shortTime(r.ride_time) : "שעה תיקבע"}`,
    r.pickup ? `📍 ${r.pickup}` : "",
    r.dropoff ? `🏁 ${r.dropoff}` : "",
    r.flight_number ? `✈️ טיסה ${r.flight_number}` : "",
    r.passengers ? `👥 ${r.passengers} נוסעים` : "",
    r.customer_name ? `👤 ${r.customer_name}${r.customer_phone ? ` ${r.customer_phone}` : ""}` : "",
    r.driver_cost ? `💰 ${r.driver_cost} ₪` : "",
    r.notes ? `📝 ${r.notes}` : "",
    r.response_url ? `👉 אישור: ${r.response_url}` : "",
  ].filter(Boolean).join("\n"));
  return [
    `שלום ${driverName}, הסידור שלך ל${dayLabel(date)}:`,
    "",
    blocks.join("\n\n"),
    "",
    `סה״כ ${rides.length} נסיעות${total ? ` · ${total} ₪` : ""}`,
    rides.some((r) => r.response_url) ? "נא לאשר כל נסיעה בקישור שלה 🙏" : "",
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n").trim();
}

export type PayRide = {
  ride_date: string;
  ride_time: string | null;
  pickup: string | null;
  dropoff: string | null;
  driver_cost: number | null;
  driver_paid_at: string | null;
};

/** Monthly statement for a contractor: his rides, the total, what was paid and what is left */
export function driverStatementMessage(driverName: string, orgName: string, month: string, rides: PayRide[], partial: boolean): string {
  const [y, m] = month.split("-");
  const total = rides.reduce((s, r) => s + Number(r.driver_cost ?? 0), 0);
  const paid = rides.filter((r) => r.driver_paid_at).reduce((s, r) => s + Number(r.driver_cost ?? 0), 0);
  const nis = (n: number) => `${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })} ₪`;
  const lines = rides.map((r) => {
    const [, mm, dd] = r.ride_date.split("-");
    const route = [r.pickup, r.dropoff].filter(Boolean).join(" ← ") || "נסיעה";
    const amount = r.driver_cost ? nis(Number(r.driver_cost)) : "סכום לא נקבע";
    return `• ${dd}/${mm}${r.ride_time ? ` ${shortTime(r.ride_time)}` : ""} · ${route} · ${amount}${r.driver_paid_at ? " ✓" : ""}`;
  });
  return [
    `שלום ${driverName},`,
    `ריכוז הנסיעות שלך ב${orgName} לחודש ${Number(m)}/${y}${partial ? " (עד היום)" : ""}:`,
    "",
    ...lines,
    "",
    `${rides.length} נסיעות · סה״כ ${nis(total)}`,
    paid > 0 ? `שולם: ${nis(paid)} · נותר לתשלום: ${nis(total - paid)}` : "",
    paid > 0 ? "✓ = שולם" : "",
    "אם משהו לא מסתדר לך, תגיד לי 🙏",
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

/** To the customer: who is coming to pick them up */
export function customerDriverMessage(p: {
  customer_name: string | null | undefined;
  org_name: string;
  ride_date: string;
  ride_time: string | null;
  pickup: string | null;
  flight_number: string | null;
  driver_name: string;
  driver_phone: string | null;
  car_model: string | null | undefined;
  car_plate: string | null | undefined;
}): string {
  const car = [p.car_model, p.car_plate ? `מס׳ ${p.car_plate}` : ""].filter(Boolean).join(" · ");
  return [
    `שלום${p.customer_name ? ` ${p.customer_name}` : ""},`,
    `פרטי הנסיעה שלך מ${p.org_name}:`,
    `📅 ${dayLabel(p.ride_date)}${p.ride_time ? ` בשעה ${shortTime(p.ride_time)}` : ""}`,
    p.pickup ? `📍 איסוף: ${p.pickup}` : "",
    p.flight_number ? `✈️ טיסה: ${p.flight_number}` : "",
    "",
    `🚖 הנהג: ${p.driver_name}`,
    p.driver_phone ? `📞 ${p.driver_phone}` : "",
    car ? `🚗 ${car}` : "",
    "",
    "נסיעה טובה!",
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n").trim();
}

export function waLink(phone: string | null, text: string): string {
  const p = toWaPhone(phone);
  const q = encodeURIComponent(text);
  return p ? `https://wa.me/${p}?text=${q}` : `https://wa.me/?text=${q}`;
}
