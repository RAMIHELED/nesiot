// Web-push helper shared by functions that notify the business owner.
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type PushTarget = { id: string; endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; url: string; tag?: string };

let configured = false;

function configure(): boolean {
  if (configured) return true;
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return false;
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com", pub, priv);
  configured = true;
  return true;
}

/** Sends to every registered device of every member of the business. Needs a service-role client. */
export async function pushToOrg(admin: SupabaseClient, orgId: string, payload: PushPayload): Promise<number> {
  if (!configure()) {
    console.error("VAPID keys missing: push skipped");
    return 0;
  }
  const { data } = await admin.rpc("org_push_targets", { p_org: orgId });
  let sent = 0;
  for (const t of (data ?? []) as PushTarget[]) {
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
        await admin.from("push_subscriptions").delete().eq("id", t.id);
      } else {
        console.error("push failed", status, (err as Error).message);
      }
    }
  }
  return sent;
}
