// "Check now" on the ride screen: refresh one ride's flight status from the airport data.
// Deploy with:  npx supabase functions deploy flight-check
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { refreshRideFlight } from "../_shared/flights.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { ride_id } = await req.json().catch(() => ({}));
  if (!ride_id) return json({ error: "bad request" }, 400);

  // Row-level security decides: only someone who can see this ride may check it
  const { data: ride } = await asUser.from("rides")
    .select("id, org_id, flight_number, ride_date, ride_time, pickup, dropoff, flight_alert_key, customer:customers(name)")
    .eq("id", ride_id).maybeSingle();
  if (!ride) return json({ error: "הנסיעה לא נמצאה" }, 404);
  if (!ride.flight_number?.trim()) return json({ error: "אין מספר טיסה בנסיעה" }, 400);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    // Checking by hand does not send a notification; the screen shows the result
    const res = await refreshRideFlight(admin, {
      ...ride, customer_name: (ride.customer as { name?: string } | null)?.name ?? null,
    });
    return json({ ok: true, ...res, alert: undefined });
  } catch (err) {
    return json({ error: `שירות הטיסות של רשות שדות התעופה לא זמין כרגע (${(err as Error).message})` }, 502);
  }
});
