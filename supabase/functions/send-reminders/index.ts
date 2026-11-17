// Sends ride reminders and the evening summary as web-push notifications.
//
// Called two ways:
//   1. By pg_cron every 5 minutes, with header  x-cron-secret: <CRON_SECRET>
//   2. By a logged-in user with body {"test": true} → test notification to that user's own devices
//
// Deploy with:  npx supabase functions deploy send-reminders --no-verify-jwt
// (the function checks the cron secret / user token itself)
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

type Target = { id: string; endpoint: string; p256dh: string; auth: string };
type Payload = { title: string; body: string; url: string; tag?: string };

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

async function push(targets: Target[], payload: Payload): Promise<number> {
  let sent = 0;
  for (const t of targets) {
    try {
      await webpush.sendNotification(
        { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 },
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // Phone unsubscribed or app removed: forget this subscription
        await admin.from("push_subscriptions").delete().eq("id", t.id);
      } else {
        console.error("push failed", status, (err as Error).message);
      }
    }
  }
  return sent;
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

async function runReminders() {
  const { data: rides, error } = await admin.rpc("due_reminders");
  if (error) throw error;

  let sent = 0;
  const targetsByOrg = new Map<string, Target[]>();

  for (const r of rides ?? []) {
    if (!targetsByOrg.has(r.org_id)) {
      const { data } = await admin.rpc("org_push_targets", { p_org: r.org_id });
      targetsByOrg.set(r.org_id, (data ?? []) as Target[]);
    }
    const targets = targetsByOrg.get(r.org_id)!;

    const who = !r.driver_name
      ? "⚠️ לא שובץ נהג!"
      : r.driver_is_self ? "נהג: אני" : `נהג: ${r.driver_name}`;
    const parts = [
      `${r.pickup ?? "?"} ← ${r.dropoff ?? "?"}`,
      r.customer_name,
      r.flight_number ? `טיסה ${r.flight_number}` : null,
      r.passengers ? `${r.passengers} נוסעים` : null,
      who,
    ].filter(Boolean);

    if (targets.length) {
      sent += await push(targets, {
        title: `נסיעה בעוד ${r.minutes_left} דק׳ · ${hhmm(r.ride_time)}`,
        body: parts.join(" · "),
        url: `/rides/${r.ride_id}`,
        tag: `ride-${r.ride_id}`,
      });
    }
    // The driver himself, if he has the app (opens his rides screen)
    if (r.driver_id && !r.driver_is_self) {
      const { data: drv } = await admin.rpc("driver_push_targets", { p_driver: r.driver_id });
      if (drv?.length) {
        sent += await push(drv as Target[], {
          title: `נסיעה שלך בעוד ${r.minutes_left} דק׳ · ${hhmm(r.ride_time)}`,
          body: [`${r.pickup ?? "?"} ← ${r.dropoff ?? "?"}`, r.customer_name,
                 r.flight_number ? `טיסה ${r.flight_number}` : null,
                 r.passengers ? `${r.passengers} נוסעים` : null].filter(Boolean).join(" · "),
          url: "/",
          tag: `my-ride-${r.ride_id}`,
        });
      }
    }
    // Mark as handled even with no devices, so it is not retried every 5 minutes
    await admin.from("rides").update({ reminder_sent_at: new Date().toISOString() }).eq("id", r.ride_id);
  }
  return { rides: rides?.length ?? 0, sent };
}

// Driver got the ride link more than an hour ago and did not answer
async function runUnconfirmed() {
  const { data: rides, error } = await admin.rpc("due_unconfirmed");
  if (error) throw error;
  let sent = 0;
  for (const r of rides ?? []) {
    const { data } = await admin.rpc("org_push_targets", { p_org: r.org_id });
    const [, m, d] = String(r.ride_date).split("-");
    sent += await push((data ?? []) as Target[], {
      title: `⏳ ${r.driver_name} עדיין לא אישר`,
      body: `${Number(d)}/${Number(m)} ${hhmm(r.ride_time)} · ${r.pickup ?? "?"} ← ${r.dropoff ?? "?"}`,
      url: `/rides/${r.ride_id}`,
      tag: `unconfirmed-${r.ride_id}`,
    });
    await admin.from("rides").update({ unconfirmed_alert_at: new Date().toISOString() }).eq("id", r.ride_id);
  }
  return { rides: rides?.length ?? 0, sent };
}

async function runDigests() {
  const { data: orgs, error } = await admin.rpc("due_digests");
  if (error) throw error;

  let sent = 0;
  for (const o of orgs ?? []) {
    if (o.rides_tomorrow > 0) {
      const { data } = await admin.rpc("org_push_targets", { p_org: o.org_id });
      const body = o.unassigned_tomorrow > 0
        ? `${o.rides_tomorrow} נסיעות מחר · ⚠️ ${o.unassigned_tomorrow} עדיין לא שובצו`
        : `${o.rides_tomorrow} נסיעות מחר · כולן שובצו ✓`;
      sent += await push((data ?? []) as Target[], { title: "סיכום למחר", body, url: "/", tag: "digest" });
    }
    await admin.from("organizations").update({ last_digest_date: o.local_date }).eq("id", o.org_id);
  }
  return { orgs: orgs?.length ?? 0, sent };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: "VAPID keys are not set" }, 500);

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  // 1. Scheduled run
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader) {
    if (!CRON_SECRET || cronHeader !== CRON_SECRET) return json({ error: "forbidden" }, 403);
    try {
      const reminders = await runReminders();
      const digests = await runDigests();
      const unconfirmed = await runUnconfirmed().catch((err) => ({ error: (err as Error).message }));
      return json({ ok: true, reminders, digests, unconfirmed });
    } catch (err) {
      console.error(err);
      return json({ error: (err as Error).message }, 500);
    }
  }

  // 2. Test notification for the logged-in user
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  if (!body.test) return json({ error: "bad request" }, 400);

  const { data: subs } = await admin.from("push_subscriptions")
    .select("id, endpoint, p256dh, auth").eq("user_id", userData.user.id);
  const sent = await push((subs ?? []) as Target[], {
    title: "התראת בדיקה ✓",
    body: "ההתראות פועלות. תקבלו תזכורת לפני כל נסיעה.",
    url: "/settings",
    tag: "test",
  });
  return json({ ok: true, devices: subs?.length ?? 0, sent });
});
