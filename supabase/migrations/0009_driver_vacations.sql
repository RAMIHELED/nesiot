-- =========================================================
-- Migration 0009: vacations / days off
-- For one driver, or for all drivers (driver_id = null, e.g. holiday, business closed).
-- Run once in the Supabase SQL Editor.
-- =========================================================

create table if not exists public.driver_absences (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  driver_id   uuid references public.drivers(id) on delete cascade,   -- null = all drivers
  start_date  date not null,
  end_date    date not null check (end_date >= start_date),
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists driver_absences_org_idx on public.driver_absences (org_id, end_date);

alter table public.driver_absences enable row level security;
drop policy if exists driver_absences_member on public.driver_absences;
create policy driver_absences_member on public.driver_absences
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
grant select, insert, update, delete on public.driver_absences to authenticated;

-- ---------- Recurring rides: do not assign a driver who is on vacation ----------
-- Same as in 0006, except the driver is left empty on his vacation days.
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
  select t.org_id, t.customer_id,
         case when t.driver_id is not null and exists (
                select 1 from public.driver_absences a
                where a.org_id = t.org_id
                  and (a.driver_id = t.driver_id or a.driver_id is null)
                  and d::date between a.start_date and a.end_date)
              then null else t.driver_id end,
         d::date, t.ride_time, t.pickup, t.dropoff,
         t.passengers, t.price, t.driver_cost, t.distance_km, t.duration_min, t.notes, t.id, null
  from public.recurring_rides t
  cross join generate_series(greatest(v_today, t.start_date),
                             least(v_today + p_days, coalesce(t.end_date, v_today + p_days)),
                             interval '1 day') as d
  where t.active
    and (p_org is null or t.org_id = p_org)
    and (p_template is null or t.id = p_template)
    and extract(dow from d)::int = any (t.weekdays)
    and not (d::date = v_today and t.ride_time <= (now() at time zone 'Asia/Jerusalem')::time)
  on conflict (recurring_id, ride_date) where recurring_id is not null do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
