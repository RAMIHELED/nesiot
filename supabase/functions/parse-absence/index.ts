// Parses free text / voice ("משה בחופשה מה-20 עד ה-25, מילואים") into a vacation entry.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("PARSE_MODEL") ?? "claude-haiku-5-5";

const absenceTool = {
  name: "save_absence",
  description: "A vacation / day off for one driver or for all drivers.",
  input_schema: {
    type: "object",
    properties: {
      all_drivers: {
        type: "boolean",
        description: "true if it applies to everyone (כל הנהגים, כולם, העסק סגור, חג), false for one driver",
      },
      driver_id: { type: ["string", "null"], description: "id from the known drivers list when one driver is meant ('אני' = the self driver), else null" },
      start_date: { type: ["string", "null"], description: "YYYY-MM-DD; resolve relative words (מחר, ביום ראשון, שבוע הבא) against today" },
      end_date: {
        type: ["string", "null"],
        description: "YYYY-MM-DD, inclusive. A single day → same as start_date. 'לשבוע' → start + 6 days. 'עד ה-25' → the 25th.",
      },
      note: { type: ["string", "null"], description: "reason if said: מילואים, חופשה, מחלה, אילת, חג" },
      missing: { type: "array", items: { type: "string" }, description: "Hebrew names of missing required parts: מי, מתאריך" },
    },
    required: ["all_drivers", "start_date", "end_date", "missing"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY is not set" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").trim();
  if (!text || !body.org_id) return json({ error: "text and org_id are required" }, 400);
  if (text.length > 1000) return json({ error: "text too long" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: org } = await supabase.from("organizations").select("id").eq("id", body.org_id).maybeSingle();
  if (!org) return json({ error: "forbidden" }, 403);

  const { data: drivers } = await supabase.from("drivers").select("id,name,is_self")
    .eq("org_id", body.org_id).eq("active", true).limit(100);

  const today = body.today ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString("he-IL", { weekday: "long", timeZone: "UTC" });

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: [
        "You extract a driver vacation / day off from Hebrew (sometimes English) text for an Israeli taxi dispatcher.",
        `Today is ${today} (${weekday}), Asia/Jerusalem. Week starts on Sunday. Dates without a month are in the current month, or next month if already past.`,
        "The text may be several voice recordings joined together; later parts add or correct earlier ones.",
        "Never invent data. Use null for anything not stated.",
        "Known drivers (id | name | self):",
        ...(drivers ?? []).map((d) => `${d.id} | ${d.name} | ${d.is_self ? "self (the owner, 'אני')" : ""}`),
      ].join("\n"),
      tools: [absenceTool],
      tool_choice: { type: "tool", name: "save_absence" },
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

  const a = toolUse.input as Record<string, unknown>;
  if (a.driver_id && !(drivers ?? []).some((d) => d.id === a.driver_id)) a.driver_id = null;
  return json({ absence: a });
});
