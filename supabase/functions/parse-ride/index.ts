// Parses free text (pasted WhatsApp / email / voice transcript) into ride fields.
// Runs with the caller's JWT, so RLS limits it to the caller's own organization.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("PARSE_MODEL") ?? "claude-haiku-5-5";

const rideTool = {
  name: "save_ride",
  description: "Structured ride booking extracted from the message.",
  input_schema: {
    type: "object",
    properties: {
      customer_id: {
        type: ["string", "null"],
        description: "id of a known customer from the list if the message clearly refers to them, else null",
      },
      customer_name: { type: ["string", "null"], description: "customer name as written, if any" },
      customer_phone: { type: ["string", "null"] },
      ride_date: { type: ["string", "null"], description: "YYYY-MM-DD; resolve words like מחר / יום שני relative to today" },
      ride_time: { type: ["string", "null"], description: "HH:MM 24h pickup time" },
      pickup: { type: ["string", "null"], description: "pickup place; reuse the exact spelling from known places when it is the same place" },
      dropoff: { type: ["string", "null"], description: "destination; reuse the exact spelling from known places when it is the same place" },
      flight_number: { type: ["string", "null"], description: "e.g. LY001, uppercase, no spaces" },
      passengers: { type: ["integer", "null"] },
      price: {
        type: ["number", "null"],
        description: "Price charged to the CUSTOMER in shekels, only if stated. Phrases: מחיר, מחיר ללקוח, הלקוח משלם, גובים, עולה, X שקל/ש\"ח/₪ when not said to be for the driver.",
      },
      driver_cost: {
        type: ["number", "null"],
        description: "Amount paid to the DRIVER / subcontractor in shekels, only if stated. Phrases: לנהג, לקבלן, עלות לנהג, עלות לקבלן, עלות נהג, עלות קבלן, תשלום לנהג, תשלום לקבלן, הנהג מקבל, הקבלן מקבל, משלמים לו, cost for driver, driver cost. Any amount described as עלות (cost) belongs here, not in price.",
      },
      driver_id: {
        type: ["string", "null"],
        description: "id of a known driver from the list if the message says who drives (e.g. 'משה נוסע', 'לשבץ את משה', 'אני נוסע' = the driver marked self), else null",
      },
      notes: {
        type: ["string", "null"],
        description: "anything else relevant: luggage, child seat, return trip, etc. NEVER put prices, costs or amounts of money here: they go only in price or driver_cost.",
      },
      missing: {
        type: "array",
        items: { type: "string" },
        description: "Hebrew names of required fields that are missing: תאריך, שעה, כתובת איסוף, יעד, מספר נוסעים",
      },
    },
    required: ["ride_date", "ride_time", "pickup", "dropoff", "missing"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY is not set" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  let body: { text?: string; org_id?: string; today?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const text = (body.text ?? "").trim();
  if (!text || !body.org_id) return json({ error: "text and org_id are required" }, 400);
  if (text.length > 4000) return json({ error: "text too long" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  // Membership check (RLS returns nothing for other orgs)
  const { data: org, error: orgErr } = await supabase
    .from("organizations").select("id").eq("id", body.org_id).maybeSingle();
  if (orgErr || !org) return json({ error: "forbidden" }, 403);

  const [{ data: customers }, { data: recent }, { data: drivers }] = await Promise.all([
    supabase.from("customers").select("id,name,phone").eq("org_id", body.org_id).limit(500),
    supabase.from("rides").select("pickup,dropoff").eq("org_id", body.org_id)
      .order("created_at", { ascending: false }).limit(300),
    supabase.from("drivers").select("id,name,is_self").eq("org_id", body.org_id).eq("active", true).limit(100),
  ]);

  const places = new Set<string>();
  for (const r of recent ?? []) {
    if (r.pickup) places.add(r.pickup);
    if (r.dropoff) places.add(r.dropoff);
  }

  const today = body.today ?? new Date().toISOString().slice(0, 10);
  const system = [
    "You extract taxi / airport-transfer bookings from Hebrew (sometimes English) messages for an Israeli dispatcher.",
    `Today is ${today} (Asia/Jerusalem). Week starts on Sunday.`,
    "Never invent data. Use null for anything not stated.",
    "נתב\"ג / בן גוריון / שדה / נמל התעופה all mean Ben Gurion Airport.",
    "The text may be several voice recordings joined together; later parts add or correct earlier ones.",
    "Prices: when two amounts are given (e.g. 'מחיר 250, לנהג 180' or '250 ללקוח ו-180 לקבלן'), the customer price is price and the driver/subcontractor amount is driver_cost. Hebrew number words count (מאתיים וחמישים = 250).",
    "Known drivers (id | name | self):",
    ...(drivers ?? []).map((d) => `${d.id} | ${d.name} | ${d.is_self ? "self (the owner, 'אני')" : ""}`),
    "Known customers (id | name | phone):",
    ...(customers ?? []).map((c) => `${c.id} | ${c.name} | ${c.phone ?? ""}`),
    "Known places:",
    ...[...places].slice(0, 200),
  ].join("\n");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      system,
      tools: [rideTool],
      tool_choice: { type: "tool", name: "save_ride" },
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!resp.ok) {
    console.error("anthropic error", resp.status, await resp.text());
    return json({ error: "parse failed" }, 502);
  }

  const out = await resp.json();
  const toolUse = (out.content ?? []).find((b: { type: string }) => b.type === "tool_use");
  if (!toolUse) return json({ error: "no result" }, 502);

  const ride = toolUse.input as Record<string, unknown>;
  // Drop a customer_id that is not in this org's list
  if (ride.customer_id && !(customers ?? []).some((c) => c.id === ride.customer_id)) {
    ride.customer_id = null;
  }
  if (ride.driver_id && !(drivers ?? []).some((d) => d.id === ride.driver_id)) {
    ride.driver_id = null;
  }
  return json({ ride });
});
