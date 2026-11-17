import { supabase } from "../supabase";

export type MyRide = {
  id: string;
  org_id?: string;
  org_name?: string;
  ride_date: string;
  ride_time: string | null;
  pickup: string | null;
  dropoff: string | null;
  flight_number: string | null;
  passengers: number | null;
  notes: string | null;
  driver_cost: number | null;
  distance_km: number | null;
  duration_min: number | null;
  status: "active" | "cancelled";
  driver_status: "none" | "sent" | "confirmed" | "declined";
  driver_token: string | null;
  driver_paid_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
};

/** The logged-in driver's rides (no customer prices) */
export async function loadMyRides(orgId: string, from: string, to: string): Promise<MyRide[]> {
  const { data, error } = await supabase.rpc("my_rides", { p_org: orgId, p_from: from, p_to: to });
  if (error) throw error;
  return ((data ?? []) as MyRide[]).map((r) => ({
    ...r,
    driver_cost: r.driver_cost == null ? null : Number(r.driver_cost),
    distance_km: r.distance_km == null ? null : Number(r.distance_km),
  }));
}

/** Confirm / decline through the same server function as the WhatsApp link (notifies the owner on decline) */
export async function respond(token: string, action: "confirm" | "decline") {
  const { error } = await supabase.functions.invoke("driver-response", { body: { token, action } });
  if (error) throw error;
}

/** All the driver's rides in every business he drives for */
export async function loadMyRidesAll(from: string, to: string): Promise<MyRide[]> {
  const { data, error } = await supabase.rpc("my_rides_all", { p_from: from, p_to: to });
  if (error) throw error;
  return ((data ?? []) as MyRide[]).map((r) => ({
    ...r,
    driver_cost: r.driver_cost == null ? null : Number(r.driver_cost),
    distance_km: r.distance_km == null ? null : Number(r.distance_km),
  }));
}
