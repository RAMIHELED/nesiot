-- =========================================================
-- Migration 0006: recurring rides
-- A template (e.g. every Sunday and Wednesday at 06:00) creates real rides
-- 14 days ahead. Each created ride can still be changed or cancelled on its own.
-- Run once in the Supabase SQL Editor.
-- =========================================================

create table if not exists public.recurring_rides (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  customer_id   uuid references public.customers(id) on delete set null,
  driver_id     uuid references public.drivers(id) on delete set null,
  weekdays      int[] not null check (cardinality(weekdays) > 0 and weekdays <@ array[0,1,2,3,4,5,6]),  -- 0 = Sunday
  ride_time     time not null,
  start_date    date not null default ((now() at time zone 'Asia/Jerusalem')::date),
  end_date      date check (end_date is null or end_date >= start_date),
  pickup        text not null,
  dropoff       text not null,
  passengers    int check (passengers is null or passengers > 0),
  price         numeric(10,2),
  driver_cost   numeric(10,2),
  distance_km   numeric(6,1),
  duration_min  int,
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists recurring_rides_org_idx on public.recurring_rides (org_id);

alter table public.recurring_rides enable row level security;
drop policy if exists recurring_member on public.recurring_rides;
create policy recurring_member on public.recurring_rides
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
grant select, insert, update, delete on public.recurring_rides to authenticated;

drop trigger if exists recurring_touch on public.recurring_rides;
create trigger recurring_touch before update on public.recurring_rides
  for each row execute function public.touch_updated_at();

-- Link from a ride to the template that created it; one ride per template per date
alter table public.rides
  add column if not exists recurring_id uuid references public.recurring_rides(id) on delete set null;
create unique index if not exists rides_recurring_date_uq on public.rides (recurring_id, ride_date)
  where recurring_id is not null;

-- ---------- Create the rides of the coming days ----------
-- Creates rides for the template(s) from today (Israel time) to today + p_days.
-- Skips dates that already have a ride from the same template (also cancelled ones,
-- so a single cancelled date is not recreated).
create or replace function public._generate_recurring(p_org uuid, p_template uuid, p_days int)
returns int language plpgsql set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_count int;
begin
  insert into public.rides (
    org_id, customer_id, driver_id, ride_date, ride_time, pickup, dropoff,
    passengers, price, driver_cost, distance_km, duration_min, notes, recurring_id, created_by
  )
  select t.org_id, t.customer_id, t.driver_id, d::date, t.ride_time, t.pickup, t.dropoff,
         t.passengers, t.price, t.driver_cost, t.distance_km, t.duration_min, t.notes, t.id, null
  from public.recurring_rides t
  cross join generate_series(greatest(v_today, t.start_date),
                             least(v_today + p_days, coalesce(t.end_date, v_today + p_days)),
                             interval '1 day') as d
  where t.active
    and (p_org is null or t.org_id = p_org)
    and (p_template is null or t.id = p_template)
    and extract(dow from d)::int = any (t.weekdays)
    -- not a time that already passed today
    and not (d::date = v_today and t.ride_time <= (now() at time zone 'Asia/Jerusalem')::time)
  on conflict (recurring_id, ride_date) where recurring_id is not null do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- For the app: generate for the caller's business (RLS applies: security invoker)
create or replace function public.generate_recurring_rides(p_org uuid, p_days int default 14)
returns int language sql security invoker set search_path = public as $$
  select public._generate_recurring(p_org, null, least(greatest(p_days, 1), 60));
$$;

-- For the app, after a template was edited: remove its future rides that were not
-- billed yet (from tomorrow), then create them again from the new template.
-- Rides of today are kept as they are.
create or replace function public.rebuild_recurring_ride(p_template uuid, p_days int default 14)
returns int language plpgsql security invoker set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  delete from public.rides
  where recurring_id = p_template
    and ride_date > v_today
    and billed_at is null
    and driver_paid_at is null;
  return public._generate_recurring(null, p_template, least(greatest(p_days, 1), 60));
end;
$$;

-- Stop a template: deactivate it and remove its future rides (from tomorrow)
create or replace function public.stop_recurring_ride(p_template uuid)
returns int language plpgsql security invoker set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_count int;
begin
  update public.recurring_rides set active = false where id = p_template;
  delete from public.rides
  where recurring_id = p_template and ride_date > v_today
    and billed_at is null and driver_paid_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.generate_recurring_rides(uuid, int),
                          public.rebuild_recurring_ride(uuid, int),
                          public.stop_recurring_ride(uuid) to authenticated;
revoke all on function public._generate_recurring(uuid, uuid, int) from public, anon;
grant execute on function public._generate_recurring(uuid, uuid, int) to authenticated, service_role;

-- ---------- Daily run for all businesses (00:15 UTC) ----------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nesiot-recurring-rides';
    perform cron.schedule('nesiot-recurring-rides', '15 0 * * *',
                          'select public._generate_recurring(null, null, 14)');
  else
    raise notice 'pg_cron is not enabled: run setup_reminders_cron.sql first, then run this file again';
  end if;
end $$;
