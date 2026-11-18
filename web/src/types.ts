export type Customer = {
  id: string;
  org_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  kind: "private" | "company";
  notes: string | null;
};

export type Driver = {
  id: string;
  org_id: string;
  name: string;
  phone: string | null;
  is_self: boolean;
  active: boolean;
  notes: string | null;
  seats: number;
  car_model: string | null;
  car_plate?: string | null;
};

export type Ride = {
  id: string;
  org_id: string;
  customer_id: string | null;
  driver_id: string | null;
  ride_date: string;
  ride_time: string | null;
  pickup: string | null;
  dropoff: string | null;
  flight_number: string | null;
  passengers: number | null;
  price: number | null;
  driver_cost: number | null;
  status: "active" | "cancelled";
  billed_at: string | null;
  driver_paid_at: string | null;
  notes: string | null;
  source_text: string | null;
  distance_km: number | null;
  duration_min: number | null;
  recurring_id: string | null;
  driver_status: "none" | "sent" | "confirmed" | "declined";
  driver_token: string | null;
  driver_sent_at: string | null;
  driver_responded_at: string | null;
  declined_driver_ids: string[];
};

export type RideWithNames = Ride & {
  customer: { name: string; phone?: string | null } | null;
  driver: { name: string; is_self: boolean } | null;
};

export type ParsedRide = {
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  ride_date: string | null;
  ride_time: string | null;
  pickup: string | null;
  dropoff: string | null;
  flight_number: string | null;
  passengers: number | null;
  price: number | null;
  driver_cost: number | null;
  driver_id: string | null;
  notes: string | null;
  missing: string[];
};
