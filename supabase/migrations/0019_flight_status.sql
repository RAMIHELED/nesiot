-- =========================================================
-- Migration 0019: flight status for airport rides (Ben Gurion, Israel Airports Authority data)
-- Filled by the send-reminders cron (every 5 min, each flight checked at most every 10 min)
-- and by the "check now" button on the ride screen.
-- Run once in the Supabase SQL Editor.
-- =========================================================

alter table public.rides
  add column if not exists flight_status      text,         -- English status from the airport (LANDED, DELAYED, ...)
  add column if not exists flight_status_he   text,         -- Hebrew status from the airport
  add column if not exists flight_direction   text,         -- 'A' arrival / 'D' departure
  add column if not exists flight_scheduled   timestamptz,  -- scheduled time at TLV
  add column if not exists flight_estimated   timestamptz,  -- updated / actual time at TLV
  add column if not exists flight_checked_at  timestamptz,
  add column if not exists flight_alert_key   text;         -- what we last notified about (to avoid repeats)

-- Rides whose flight should be checked now (service role only)
create or replace function public.due_flight_checks()
returns table (id uuid, org_id uuid, flight_number text, ride_date date, ride_time time,
               pickup text, dropoff text, customer_name text,
               flight_status text, flight_estimated timestamptz, flight_scheduled timestamptz, flight_alert_key text)
language sql stable security definer set search_path = public as $$
  select r.id, r.org_id, r.flight_number, r.ride_date, r.ride_time, r.pickup, r.dropoff, c.name,
         r.flight_status, r.flight_estimated, r.flight_scheduled, r.flight_alert_key
  from public.rides r
  left join public.customers c on c.id = r.customer_id
  where r.status = 'active'
    and coalesce(trim(r.flight_number), '') <> ''
    and r.ride_date between (now() at time zone 'Asia/Jerusalem')::date - 1
                        and (now() at time zone 'Asia/Jerusalem')::date + 1
    and public.org_is_open(r.org_id)
    and (r.flight_checked_at is null or r.flight_checked_at < now() - interval '10 minutes')
    -- stop following a flight once it landed / departed / was cancelled long ago
    -- a flight that already landed / departed / was cancelled is not checked again
    and coalesce(r.flight_status, '') not in ('LANDED', 'DEPARTED', 'CANCELED', 'CANCELLED')
  order by r.ride_date, r.ride_time
  limit 60;
$$;
revoke execute on function public.due_flight_checks() from public, anon, authenticated;
