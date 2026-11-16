// Estimates driving distance and time between two free-text addresses (Google Routes API).
// Reuses the result of an earlier ride on the same route in the same business when there is one,
// so a repeated route does not call Google again.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const GOOGLE_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";

const AIRPORT = "נמל התעופה בן גוריון";

// Make common Hebrew place names easier for Google to find
function cleanAddress(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  // "נתב״ג", "שדה התעופה", "נמל התעופה", "נתב״ג טרמינל 3", or exactly "בן גוריון" (not a street like "בן גוריון 5")
  if (/^(נתב["״'׳]?ג|שדה ה?תעופה|נמל ה?תעופה)(\s|$)/.test(s) || /^(נמל התעופה |שדה התעופה )?בן[\s-]?גוריון$/.test(s)) {
    return AIRPORT;
  }
  return /ישראל|israel/i.test(s) ? s : `${s}, ישראל`;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!GOOGLE_KEY) return json({ error: "GOOGLE_MAPS_API_KEY is not set" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const { pickup, dropoff, org_id } = await req.json().catch(() => ({}));
  if (!pickup?.trim() || !dropoff?.trim() || !org_id) {
    return json({ error: "pickup, dropoff and org_id are required" }, 400);
  }
  if (pickup.length > 300 || dropoff.length > 300) return json({ error: "address too long" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  // Caller must belong to this business (RLS returns nothing otherwise)
  const { data: org } = await supabase.from("organizations").select("id").eq("id", org_id).maybeSingle();
  if (!org) return json({ error: "forbidden" }, 403);

  // 1) Same route already measured in this business?
  const { data: known } = await supabase
    .from("rides")
    .select("pickup, dropoff, distance_km, duration_min")
    .eq("org_id", org_id)
    .not("distance_km", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);
  const hit = (known ?? []).find((r) => norm(r.pickup ?? "") === norm(pickup) && norm(r.dropoff ?? "") === norm(dropoff));
  if (hit) {
    return json({ distance_km: Number(hit.distance_km), duration_min: hit.duration_min, source: "previous_ride" });
  }

  // 2) Ask Google
  const resp = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
    },
    body: JSON.stringify({
      origin: { address: cleanAddress(pickup) },
      destination: { address: cleanAddress(dropoff) },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      languageCode: "he",
      regionCode: "IL",
      units: "METRIC",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error("google routes error", resp.status, text);
    return json({ error: "google_error", status: resp.status }, 502);
  }

  const out = await resp.json();
  const route = out.routes?.[0];
  if (!route?.distanceMeters) return json({ error: "not_found" }, 404);

  const seconds = Number(String(route.duration ?? "0s").replace("s", ""));
  return json({
    distance_km: Math.round(route.distanceMeters / 100) / 10,
    duration_min: Math.round(seconds / 60),
    source: "google",
  });
});
