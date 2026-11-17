-- =========================================================
-- Migration 0007: driver confirms or declines a ride via a personal link
-- Run once in the Supabase SQL Editor.
-- =========================================================

alter table public.rides
  add column if not exists driver_status        text not null default 'none'
    check (driver_status in ('none', 'sent', 'confirmed', 'declined')),
  add column if not exists driver_token         text,
  add column if not exists driver_sent_at       timestamptz,
  add column if not exists driver_responded_at  timestamptz,
  add column if not exists unconfirmed_alert_at timestamptz,
  add column if not exists declined_driver_ids  uuid[] not null default '{}';

create unique index if not exists rides_driver_token_uq on public.rides (driver_token)
  where driver_token is not null;

create or replace function public.new_driver_token()
returns text language sql volatile as $$
  -- two random UUIDs (strong randomness, built into PostgreSQL) = 244 random bits
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

-- A new driver gets a new link and a fresh status.
-- Unassigning (driver -> none) resets the status unless the same update sets it
-- (the driver's own "decline" sets 'declined' together with removing himself).
create or replace function public.ride_driver_changed()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.driver_id is not null and new.driver_token is null then
      new.driver_token := public.new_driver_token();
    end if;
    return new;
  end if;

  if new.driver_id is distinct from old.driver_id then
    new.driver_sent_at := null;
    new.driver_responded_at := null;
    new.unconfirmed_alert_at := null;
    if new.driver_id is not null then
      new.driver_token := public.new_driver_token();
      new.driver_status := 'none';
    else
      new.driver_token := null;
      if new.driver_status is not distinct from old.driver_status then
        new.driver_status := 'none';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists rides_driver_changed on public.rides;
create trigger rides_driver_changed before insert or update on public.rides
  for each row execute function public.ride_driver_changed();

-- Existing assigned rides get a link
update public.rides set driver_token = public.new_driver_token()
where driver_id is not null and driver_token is null;

-- ---------- Rides sent to a driver more than an hour ago with no answer ----------
-- Used only by send-reminders (service role).
create or replace function public.due_unconfirmed()
returns table (ride_id uuid, org_id uuid, ride_date date, ride_time time,
               pickup text, dropoff text, driver_name text)
language sql stable security definer set search_path = public as $$
  select r.id, r.org_id, r.ride_date, r.ride_time, r.pickup, r.dropoff, d.name
  from public.rides r
  join public.drivers d on d.id = r.driver_id
  where r.status = 'active'
    and r.driver_status = 'sent'
    and r.unconfirmed_alert_at is null
    and r.driver_sent_at < now() - interval '60 minutes'
    and (r.ride_time is null
         or public.ride_start(r.ride_date, r.ride_time) > now());
$$;

revoke all on function public.due_unconfirmed() from public, anon, authenticated;
grant execute on function public.due_unconfirmed() to service_role;
