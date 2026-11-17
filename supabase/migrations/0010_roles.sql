-- =========================================================
-- Migration 0010: permission levels
--   owner  (בעלים)       – everything, manages users
--   member (מנהל)        – everything except managing users
--   viewer (צפייה בלבד)  – sees everything, changes nothing
--   driver (נהג)         – only his own rides (no customer prices), his payments, his vacations
-- The rules are enforced by the database (RLS), not only by the screens.
-- Run once in the Supabase SQL Editor.
-- =========================================================

-- ---------- Roles, link to the driver, email for the users list ----------
alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships add constraint memberships_role_check
  check (role in ('owner', 'member', 'viewer', 'driver'));
alter table public.memberships
  add column if not exists driver_id uuid references public.drivers(id) on delete cascade,
  add column if not exists email text;
alter table public.memberships drop constraint if exists memberships_driver_check;
alter table public.memberships add constraint memberships_driver_check
  check ((role = 'driver') = (driver_id is not null));
create unique index if not exists memberships_driver_uq on public.memberships (org_id, driver_id)
  where driver_id is not null;

alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations add constraint invitations_role_check
  check (role in ('owner', 'member', 'viewer', 'driver'));
alter table public.invitations
  add column if not exists driver_id uuid references public.drivers(id) on delete cascade;

-- Fill emails of existing users
update public.memberships m set email = lower(u.email)
from auth.users u where u.id = m.user_id and m.email is null;

-- New user: attach to the inviting business with role, driver link and email
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.memberships (org_id, user_id, role, driver_id, email)
  select i.org_id, new.id, i.role, i.driver_id, lower(new.email)
  from public.invitations i
  where i.email = lower(new.email)
  on conflict do nothing;

  delete from public.invitations where email = lower(new.email);
  return new;
end;
$$;

-- ---------- Helpers used by the rules ----------
create or replace function public.org_role(p_org uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.memberships where org_id = p_org and user_id = auth.uid();
$$;

-- Can change data: owner, member
create or replace function public.is_org_staff(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.org_role(p_org) in ('owner', 'member'), false);
$$;

-- Can see all the business data: owner, member, viewer
create or replace function public.is_org_reader(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.org_role(p_org) in ('owner', 'member', 'viewer'), false);
$$;

-- The driver record of the logged-in driver (null for anyone else)
create or replace function public.my_driver_id(p_org uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select driver_id from public.memberships
  where org_id = p_org and user_id = auth.uid() and role = 'driver';
$$;

grant execute on function public.org_role(uuid), public.is_org_staff(uuid),
                          public.is_org_reader(uuid), public.my_driver_id(uuid) to authenticated;

-- ---------- Replace "any member can do everything" with read / write rules ----------
do $$
declare
  t text;
begin
  foreach t in array array['customers', 'drivers', 'rides', 'price_list',
                           'recurring_rides', 'customer_payments', 'driver_absences']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_member', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select using (public.is_org_reader(org_id))', t || '_read', t);
    execute format('create policy %I on public.%I for all using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id))', t || '_write', t);
  end loop;
end $$;

-- 0006 / 0008 / 0009 used other policy names
drop policy if exists recurring_member on public.recurring_rides;

-- A driver manages his own vacations
drop policy if exists driver_absences_own on public.driver_absences;
create policy driver_absences_own on public.driver_absences
  for all using (driver_id = public.my_driver_id(org_id))
  with check (driver_id = public.my_driver_id(org_id));

-- A driver also sees days off for everyone (holidays)
drop policy if exists driver_absences_all_read on public.driver_absences;
create policy driver_absences_all_read on public.driver_absences
  for select using (driver_id is null and public.my_driver_id(org_id) is not null);

-- A driver can read his own driver card
drop policy if exists drivers_own on public.drivers;
create policy drivers_own on public.drivers
  for select using (id = public.my_driver_id(org_id));

-- Owner can change roles of others in his business
drop policy if exists membership_update on public.memberships;
create policy membership_update on public.memberships
  for update using (public.is_org_owner(org_id) and user_id <> auth.uid())
  with check (public.is_org_owner(org_id));

-- ---------- The driver's own rides (without the customer price) ----------
create or replace function public.my_rides(p_org uuid, p_from date, p_to date)
returns table (
  id uuid, ride_date date, ride_time time, pickup text, dropoff text,
  flight_number text, passengers int, notes text, driver_cost numeric,
  distance_km numeric, duration_min int, status text, driver_status text,
  driver_token text, driver_paid_at timestamptz, customer_name text, customer_phone text
)
language sql stable security definer set search_path = public as $$
  select r.id, r.ride_date, r.ride_time, r.pickup, r.dropoff,
         r.flight_number, r.passengers, r.notes, r.driver_cost,
         r.distance_km, r.duration_min, r.status, r.driver_status,
         r.driver_token, r.driver_paid_at, c.name, c.phone
  from public.rides r
  left join public.customers c on c.id = r.customer_id
  where r.org_id = p_org
    and r.driver_id = public.my_driver_id(p_org)
    and r.driver_id is not null
    and r.ride_date between p_from and p_to
  order by r.ride_date, r.ride_time nulls first;
$$;
grant execute on function public.my_rides(uuid, date, date) to authenticated;

-- ---------- Notifications ----------
-- Business notifications (reminders, declines, summary) go to owner / member / viewer, not to drivers
create or replace function public.org_push_targets(p_org uuid)
returns table (id uuid, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  join public.memberships m on m.user_id = s.user_id
  where m.org_id = p_org and m.role in ('owner', 'member', 'viewer');
$$;

-- Devices of the driver who has the app (for reminders about his own rides)
create or replace function public.driver_push_targets(p_driver uuid)
returns table (id uuid, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  join public.memberships m on m.user_id = s.user_id
  where m.role = 'driver' and m.driver_id = p_driver;
$$;

revoke all on function public.org_push_targets(uuid), public.driver_push_targets(uuid) from public, anon, authenticated;
grant execute on function public.org_push_targets(uuid), public.driver_push_targets(uuid) to service_role;

-- due_reminders needs the driver id to remind him too
drop function if exists public.due_reminders();
create function public.due_reminders()
returns table (
  ride_id uuid, org_id uuid, ride_date date, ride_time time,
  pickup text, dropoff text, flight_number text, passengers int,
  customer_name text, driver_name text, driver_is_self boolean,
  minutes_left int, driver_id uuid
)
language sql stable security definer set search_path = public as $$
  select r.id, r.org_id, r.ride_date, r.ride_time,
         r.pickup, r.dropoff, r.flight_number, r.passengers,
         c.name, d.name, d.is_self,
         greatest(0, ceil(extract(epoch from (public.ride_start(r.ride_date, r.ride_time) - now())) / 60))::int,
         r.driver_id
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
revoke all on function public.due_reminders() from public, anon, authenticated;
grant execute on function public.due_reminders() to service_role;
