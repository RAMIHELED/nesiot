// Rami's WhatsApp, for access requests and closed accounts. Set VITE_CONTACT_WHATSAPP (e.g. 0501234567).
import { waLink } from "./whatsapp";

export const CONTACT_PHONE = (import.meta.env.VITE_CONTACT_WHATSAPP as string | undefined) ?? "";

export const contactLink = (text: string) => waLink(CONTACT_PHONE || null, text);

/** Days left in a trial (0 = last day), or null when there is no trial end */
export function trialDaysLeft(trialEnds: string | null, planStatus: string | null): number | null {
  if (planStatus !== "trial" || !trialEnds) return null;
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  today.setHours(0, 0, 0, 0);
  const end = new Date(trialEnds + "T00:00:00");
  return Math.round((end.getTime() - today.getTime()) / 864e5);
}
