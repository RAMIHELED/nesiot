// Owner invites a new user (by email) to his organization.
// Creates an invitation row and the auth user; the DB trigger links the membership.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const { email, org_id, role = "member" } = await req.json().catch(() => ({}));
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail) || !org_id) {
    return json({ error: "valid email and org_id are required" }, 400);
  }
  if (!["owner", "member"].includes(role)) return json({ error: "bad role" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  // Only an owner of this org may invite (checked with the caller's own permissions)
  const { data: isOwner, error: ownerErr } = await asCaller.rpc("is_org_owner", { p_org: org_id });
  if (ownerErr || !isOwner) return json({ error: "forbidden" }, 403);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { error: invErr } = await admin.from("invitations")
    .upsert({ email: cleanEmail, org_id, role });
  if (invErr) return json({ error: invErr.message }, 400);

  const { error: userErr } = await admin.auth.admin.createUser({
    email: cleanEmail,
    email_confirm: true,
  });

  if (userErr) {
    // User already exists (e.g. member of another org): add membership directly
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === cleanEmail);
    if (!existing) return json({ error: userErr.message }, 400);
    await admin.from("memberships").upsert({ org_id, user_id: existing.id, role });
    await admin.from("invitations").delete().eq("email", cleanEmail);
  }

  return json({ ok: true });
});
