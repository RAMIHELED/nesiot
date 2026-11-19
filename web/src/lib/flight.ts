// Short Hebrew label for a ride's flight status (filled from the airport data)
type F = {
  flight_status?: string | null; flight_status_he?: string | null; flight_direction?: string | null;
  flight_scheduled?: string | null; flight_estimated?: string | null;
};

const hm = (iso: string) =>
  new Date(iso).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" });

export function flightLabel(r: F): { text: string; tone: "ok" | "warn" | "bad" | "info" } | null {
  if (!r.flight_status && !r.flight_estimated) return null;
  const s = (r.flight_status ?? "").toUpperCase();
  const arrival = r.flight_direction === "A";
  const est = r.flight_estimated ? hm(r.flight_estimated) : "";
  const delay = r.flight_scheduled && r.flight_estimated
    ? Math.round((Date.parse(r.flight_estimated) - Date.parse(r.flight_scheduled)) / 60000) : 0;
  if (s.startsWith("CANCEL")) return { text: "✈️ הטיסה בוטלה", tone: "bad" };
  if (s === "LANDED") return { text: `✈️ נחתה ${est}`, tone: "ok" };
  if (s === "DEPARTED") return { text: `✈️ המריאה ${est}`, tone: "ok" };
  if (delay >= 15) return { text: `✈️ עיכוב ${delay} דק׳ · ${arrival ? "נחיתה" : "המראה"} ${est}`, tone: "warn" };
  if (delay <= -15) return { text: `✈️ מוקדם · ${arrival ? "נחיתה" : "המראה"} ${est}`, tone: "warn" };
  return { text: `✈️ ${r.flight_status_he || "בזמן"}${est ? ` · ${est}` : ""}`, tone: "info" };
}
