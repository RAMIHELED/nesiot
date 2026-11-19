// Platform admin opens a new business for a dispatcher, in one step:
//   1. the business (organization)
//   2. its owner: invitation + auth user (or a direct membership if the email already has a user)
//   3. the owner's own driver card ("me")
//   4. optionally the admin himself as a member, for support
// Deploy with:  npx supabase functions deploy admin-create-business
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: me } = await asCaller.auth.getUser();
  const { data: isAdmin } = await asCaller.rpc("is_platform_admin");
  if (!me?.user || !isAdmin) return json({ error: "רק מנהל המערכת יכול לפתוח עסק" }, 403);

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const email = String(body.owner_email ?? "").trim().toLowerCase();
  const ownerName = String(body.owner_name ?? "").trim();
  const ownerPhone = String(body.owner_phone ?? "").trim() || null;
  const addMe = body.add_me !== false;
  // Trial: open for N days, then closes unless a payment is recorded (0 / empty = no end date)
  const trialDays = Number(body.trial_days ?? 5);
  const price = body.monthly_price === "" || body.monthly_price == null ? null : Number(body.monthly_price);
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  const trialEnds = trialDays > 0
    ? new Date(today.getTime() + trialDays * 864e5).toLocaleDateString("en-CA")
    : null;
  if (!name) return json({ error: "חסר שם עסק" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "מייל בעלים לא תקין" }, 400);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: dup } = await admin.from("organizations").select("id").eq("name", name).maybeSingle();
  if (dup) return json({ error: `כבר קיים עסק בשם "${name}"` }, 409);

  const { data: org, error: orgErr } = await admin.from("organizations")
    .insert({ name, plan_status: "trial", trial_ends: trialEnds, monthly_price: price })
    .select("id").single();
  if (orgErr || !org) return json({ error: orgErr?.message ?? "יצירת העסק נכשלה" }, 400);

  // Undo the business if a later step fails, so no half-open business is left behind
  const fail = async (message: string) => {
    await admin.from("organizations").delete().eq("id", org.id);
    return json({ error: message }, 400);
  };

  // Owner: same flow as invite-user (trigger links the membership when the auth user is created)
  const { error: invErr } = await admin.from("invitations").upsert({ email, org_id: org.id, role: "owner", driver_id: null });
  if (invErr) return await fail(invErr.message);

  let ownerExisted = false;
  const { error: userErr } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (userErr) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === email);
    if (!existing) return await fail(userErr.message);
    ownerExisted = true;
    const { error: memErr } = await admin.from("memberships")
      .upsert({ org_id: org.id, user_id: existing.id, role: "owner", email });
    await admin.from("invitations").delete().eq("email", email);
    if (memErr) return await fail(memErr.message);
  }

  await admin.from("drivers").insert({ org_id: org.id, name: ownerName || name, phone: ownerPhone, is_self: true });

  if (addMe && me.user.email?.toLowerCase() !== email) {
    await admin.from("memberships")
      .upsert({ org_id: org.id, user_id: me.user.id, role: "member", email: me.user.email?.toLowerCase() ?? null });
  }

  return json({ ok: true, org_id: org.id, owner_existed: ownerExisted, trial_ends: trialEnds });
});
