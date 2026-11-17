import { supabase } from "../supabase";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushState =
  | "unsupported"     // browser can't do push
  | "ios-not-installed" // iPhone: must add to home screen first
  | "no-key"          // VITE_VAPID_PUBLIC_KEY missing
  | "denied"          // user blocked notifications
  | "off"             // can be turned on
  | "on";             // this device is subscribed

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function getPushState(): Promise<PushState> {
  if (!VAPID_PUBLIC_KEY) return "no-key";
  if (isIos() && !isStandalone()) return "ios-not-installed";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

export async function enablePush(): Promise<PushState> {
  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") {
    throw new Error("ההרשאה לא אושרה. ייתכן שכרום הסתיר את הבקשה: חפשו סמל פעמון בשורת הכתובת, או אשרו התראות בהגדרות האתר.");
  }

  // The service worker receives the notifications; make sure it is registered and running
  if (!(await navigator.serviceWorker.getRegistration())) {
    await navigator.serviceWorker.register("/sw.js");
  }
  const reg = await withTimeout(navigator.serviceWorker.ready, 10000,
    "שירות ההתראות לא נטען. סגרו את הלשונית, פתחו את האתר מחדש ונסו שוב.");
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await withTimeout(reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
    }), 15000, "הרישום לשירות ההתראות של כרום לא הסתיים. בדקו חיבור לאינטרנט ונסו שוב."));

  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await supabase.from("push_subscriptions").upsert(
    { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, user_agent: navigator.userAgent.slice(0, 200) },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
  return "off";
}

export async function sendTestPush() {
  const { data, error } = await supabase.functions.invoke("send-reminders", { body: { test: true } });
  if (error) throw error;
  return data as { devices: number; sent: number };
}
