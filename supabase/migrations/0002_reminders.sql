-- =========================================================
-- Migration 0002: ride reminders (web push)
-- Run once in the Supabase SQL Editor.
-- =========================================================

-- ---------- Settings per business ----------
alter table public.organizations
  add column if not exists reminder_minutes  int  not null default 60
    check (reminder_minutes between 5 and 1440),
  add column if not exists digest_enabled    boolean not null default true,
  add column if not exists last_digest_date  date;

-- ---------- Ride reminder tracking ----------
alter table public.rides
  add column if not exists reminder_sent_at timestamptz;

-- When the date or time of a ride changes, allow a new reminder
create or replace function public.reset_ride_reminder()
returns trigger language plpgsql as $$
begin
  if new.ride_date is distinct from old.ride_date
     or new.ride_time is distinct from old.ride_time then
    new.reminder_sent_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists rides_reset_reminder on public.rides;
create trigger rides_reset_reminder before update on public.rides
  for each row execute function public.reset_ride_reminder();

-- ---------- Push subscriptions (one per phone / browser) ----------
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- ---------- Ride start as a real timestamp (rides are in Israel time) ----------
create or replace function public.ride_start(p_date date, p_time time)
returns timestamptz language sql immutable as $$
  select (p_date + p_time) at time zone 'Asia/Jerusalem';
$$;

-- ---------- Rides that need a reminder now ----------
-- Used only by the send-reminders function (service role).
create or replace function public.due_reminders()
returns table (
  ride_id uuid, org_id uuid, ride_date date, ride_time time,
  pickup text, dropoff text, flight_number text, passengers int,
  customer_name text, driver_name text, driver_is_self boolean,
  minutes_left int
)
language sql stable security definer set search_path = public as $$
  select r.id, r.org_id, r.ride_date, r.ride_time,
         r.pickup, r.dropoff, r.flight_number, r.passengers,
         c.name, d.name, d.is_self,
         greatest(0, ceil(extract(epoch from (public.ride_start(r.ride_date, r.ride_time) - now())) / 60))::int
  from public.rides r
  join public.organizations o on o.id = r.org_id
  left join public.customers c on c.id = r.customer_id
  left join public.drivers d on d.id = r.driver_id
  where r.status = 'active'
    and r.ride_time is not null
    and r.reminder_sent_at is null
    and public.ride_start(r.ride_date, r.ride_time) > now()
    and public.ride_start(r.ride_date, r.ride_time) <= now() + make_interval(mins => o.reminder_minutes);
$$;

-- ---------- Evening summary of tomorrow (20:00 Israel time) ----------
create or replace function public.due_digests()
returns table (org_id uuid, local_date date, rides_tomorrow int, unassigned_tomorrow int)
language sql stable security definer set search_path = public as $$
  with local as (
    select (now() at time zone 'Asia/Jerusalem') as ts
  )
  select o.id,
         (local.ts)::date,
         count(r.id) filter (where r.status = 'active')::int,
         count(r.id) filter (where r.status = 'active' and r.driver_id is null)::int
  from public.organizations o
  cross join local
  left join public.rides r
    on r.org_id = o.id and r.ride_date = (local.ts)::date + 1
  where o.digest_enabled
    and (local.ts)::time >= time '20:00'
    and (o.last_digest_date is null or o.last_digest_date < (local.ts)::date)
  group by o.id, local.ts;
$$;

-- Subscriptions of everyone in a business
create or replace function public.org_push_targets(p_org uuid)
returns table (id uuid, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  join public.memberships m on m.user_id = s.user_id
  where m.org_id = p_org;
$$;

revoke all on function public.due_reminders()        from public, anon, authenticated;
revoke all on function public.due_digests()          from public, anon, authenticated;
revoke all on function public.org_push_targets(uuid) from public, anon, authenticated;
grant execute on function public.due_reminders(), public.due_digests(), public.org_push_targets(uuid) to service_role;
