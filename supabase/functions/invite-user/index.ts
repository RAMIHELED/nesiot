// Owner invites a user (by email) to his business with a role:
//   member (מנהל), viewer (צפייה בלבד), driver (נהג, linked to a driver card), owner.
// Creates an invitation and the auth user; the DB trigger links the membership.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const ROLES = ["owner", "member", "viewer", "driver"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const { email, org_id, role = "member", driver_id = null } = await req.json().catch(() => ({}));
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail) || !org_id) {
    return json({ error: "valid email and org_id are required" }, 400);
  }
  if (!ROLES.includes(role)) return json({ error: "bad role" }, 400);
  if ((role === "driver") !== Boolean(driver_id)) return json({ error: "driver role needs driver_id" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  // Only an owner of this business may invite (checked with the caller's own permissions)
  const { data: isOwner, error: ownerErr } = await asCaller.rpc("is_org_owner", { p_org: org_id });
  if (ownerErr || !isOwner) return json({ error: "forbidden" }, 403);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (driver_id) {
    const { data: drv } = await admin.from("drivers").select("id").eq("id", driver_id).eq("org_id", org_id).maybeSingle();
    if (!drv) return json({ error: "driver not in this business" }, 400);
    const { data: taken } = await admin.from("memberships").select("user_id")
      .eq("org_id", org_id).eq("driver_id", driver_id).maybeSingle();
    if (taken) return json({ error: "driver_has_access" }, 409);
  }

  const { error: invErr } = await admin.from("invitations")
    .upsert({ email: cleanEmail, org_id, role, driver_id });
  if (invErr) return json({ error: invErr.message }, 400);

  const { error: userErr } = await admin.auth.admin.createUser({ email: cleanEmail, email_confirm: true });

  if (userErr) {
    // The user already exists (e.g. in another business): add the membership directly
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === cleanEmail);
    if (!existing) return json({ error: userErr.message }, 400);
    const { error: memErr } = await admin.from("memberships")
      .upsert({ org_id, user_id: existing.id, role, driver_id, email: cleanEmail });
    await admin.from("invitations").delete().eq("email", cleanEmail);
    if (memErr) return json({ error: memErr.message }, 400);
  }

  return json({ ok: true });
});
