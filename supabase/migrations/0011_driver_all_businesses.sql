-- =========================================================
-- Migration 0011: a driver who works for several businesses sees all his rides together
-- Run once in the Supabase SQL Editor.
-- =========================================================

create or replace function public.my_rides_all(p_from date, p_to date)
returns table (
  id uuid, org_id uuid, org_name text,
  ride_date date, ride_time time, pickup text, dropoff text,
  flight_number text, passengers int, notes text, driver_cost numeric,
  distance_km numeric, duration_min int, status text, driver_status text,
  driver_token text, driver_paid_at timestamptz, customer_name text, customer_phone text
)
language sql stable security definer set search_path = public as $$
  select r.id, r.org_id, o.name,
         r.ride_date, r.ride_time, r.pickup, r.dropoff,
         r.flight_number, r.passengers, r.notes, r.driver_cost,
         r.distance_km, r.duration_min, r.status, r.driver_status,
         r.driver_token, r.driver_paid_at, c.name, c.phone
  from public.memberships m
  join public.rides r on r.org_id = m.org_id and r.driver_id = m.driver_id
  join public.organizations o on o.id = r.org_id
  left join public.customers c on c.id = r.customer_id
  where m.user_id = auth.uid()
    and m.role = 'driver'
    and r.ride_date between p_from and p_to
  order by r.ride_date, r.ride_time nulls first;
$$;
grant execute on function public.my_rides_all(date, date) to authenticated;
