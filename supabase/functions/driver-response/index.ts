// Public endpoint for a driver's personal ride link (no login).
// The 64-character random token in the link is the only key; it identifies one ride + one driver.
//
//   POST { token, action: "view" }               → ride details for the driver
//   POST { token, action: "confirm" | "decline" } → records the answer, notifies the owner on decline
//
// Deploy with:  npx supabase functions deploy driver-response --no-verify-jwt
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { pushToOrg } from "../_shared/push.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");
const todayIL = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const { token, action } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return json({ error: "not_found" }, 404);
  if (!["view", "confirm", "decline"].includes(action)) return json({ error: "bad request" }, 400);

  const { data: ride } = await admin
    .from("rides")
    .select(`id, org_id, ride_date, ride_time, pickup, dropoff, flight_number, passengers, notes,
             driver_cost, distance_km, duration_min, status, driver_id, driver_status,
             customer:customers(name, phone), driver:drivers(name, is_self), org:organizations(name)`)
    .eq("driver_token", token)
    .maybeSingle();

  if (!ride || !ride.driver_id) return json({ error: "not_found" }, 404);

  // The link stops working the day after the ride
  const expired = ride.ride_date < todayIL();
  const cancelled = ride.status === "cancelled";

  const view = {
    business: (ride.org as { name: string } | null)?.name ?? "",
    driver_name: (ride.driver as { name: string } | null)?.name ?? "",
    ride_date: ride.ride_date,
    ride_time: hhmm(ride.ride_time),
    pickup: ride.pickup,
    dropoff: ride.dropoff,
    flight_number: ride.flight_number,
    passengers: ride.passengers,
    notes: ride.notes,
    driver_cost: ride.driver_cost,
    distance_km: ride.distance_km,
    duration_min: ride.duration_min,
    customer_name: (ride.customer as { name: string } | null)?.name ?? null,
    customer_phone: (ride.customer as { phone: string | null } | null)?.phone ?? null,
    driver_status: ride.driver_status,
    cancelled,
    expired,
  };

  if (action === "view") return json({ ride: view });
  if (cancelled) return json({ error: "cancelled", ride: view }, 409);
  if (expired) return json({ error: "expired", ride: view }, 410);

  const now = new Date().toISOString();

  if (action === "confirm") {
    const { error } = await admin.from("rides")
      .update({ driver_status: "confirmed", driver_responded_at: now })
      .eq("id", ride.id).eq("driver_token", token);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, ride: { ...view, driver_status: "confirmed" } });
  }

  // decline: remove the driver from the ride, remember he declined, tell the owner
  const { data: current } = await admin.from("rides").select("declined_driver_ids").eq("id", ride.id).single();
  const declined = [...new Set([...(current?.declined_driver_ids ?? []), ride.driver_id])];
  const { error } = await admin.from("rides")
    .update({ driver_status: "declined", driver_id: null, driver_responded_at: now, declined_driver_ids: declined })
    .eq("id", ride.id).eq("driver_token", token);
  if (error) return json({ error: error.message }, 500);

  const [, m, d] = ride.ride_date.split("-");
  await pushToOrg(admin, ride.org_id, {
    title: `✗ ${view.driver_name} לא יכול לקחת נסיעה`,
    body: `${Number(d)}/${Number(m)} ${hhmm(ride.ride_time)} · ${ride.pickup ?? "?"} ← ${ride.dropoff ?? "?"} · צריך לשבץ נהג אחר`,
    url: `/rides/${ride.id}`,
    tag: `declined-${ride.id}`,
  });

  return json({ ok: true, ride: { ...view, driver_status: "declined" } });
});
