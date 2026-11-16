// Parses free text (voice transcript or pasted contact) into driver fields.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("PARSE_MODEL") ?? "claude-haiku-5-5";

const driverTool = {
  name: "save_driver",
  description: "Driver / subcontractor details extracted from the text.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: ["string", "null"], description: "driver's full name as said" },
      phone: {
        type: ["string", "null"],
        description: "mobile phone as digits, e.g. 0501234567. Convert spoken Hebrew numbers (אפס חמש אפס...) to digits.",
      },
      seats: {
        type: ["integer", "null"],
        description: "number of passenger seats / places in the car (מקומות, מושבים, נוסעים). Hebrew number words count.",
      },
      car_model: { type: ["string", "null"], description: "car make/model, e.g. טויוטה סיינה, מרצדס ויטו" },
      notes: { type: ["string", "null"], description: "anything else relevant (area, availability, license plate)" },
      missing: {
        type: "array",
        items: { type: "string" },
        description: "Hebrew names of required fields that are missing: שם, טלפון",
      },
    },
    required: ["name", "phone", "missing"],
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
  if (text.length > 2000) return json({ error: "text too long" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: org } = await supabase.from("organizations").select("id").eq("id", body.org_id).maybeSingle();
  if (!org) return json({ error: "forbidden" }, 403);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: [
        "You extract details of a taxi driver / subcontractor from Hebrew (sometimes English) text for an Israeli dispatcher.",
        "The text may be several voice recordings joined together; later parts add or correct earlier ones.",
        "Never invent data. Use null for anything not stated.",
      ].join("\n"),
      tools: [driverTool],
      tool_choice: { type: "tool", name: "save_driver" },
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
  return json({ driver: toolUse.input });
});
