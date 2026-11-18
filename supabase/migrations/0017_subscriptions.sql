-- =========================================================
-- Migration 0017: subscriptions of the businesses (Rami's customers)
--   * per business: monthly price, start date, trial end date
--   * payments each business made to Rami
--   * access closes when the trial ended (status "trial") or the business is "paused"
-- Run once in the Supabase SQL Editor.
-- =========================================================

alter table public.organizations
  add column if not exists monthly_price numeric(10,2),
  add column if not exists started_on    date not null default (now() at time zone 'Asia/Jerusalem')::date,
  add column if not exists trial_ends    date;   -- null = no end date (e.g. Gadi's free year)

-- Payments of a business to the platform. Only the admin reaches them, through the functions below.
create table if not exists public.subscription_payments (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  amount     numeric(10,2) not null check (amount > 0),
  paid_on    date not null default (now() at time zone 'Asia/Jerusalem')::date,
  method     text,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists subscription_payments_org_idx on public.subscription_payments (org_id, paid_on desc);
alter table public.subscription_payments enable row level security;

-- ---------- Access: is this business open? ----------
create or replace function public.org_is_open(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case o.plan_status
             when 'active' then true
             when 'paused' then false
             else o.trial_ends is null or o.trial_ends >= (now() at time zone 'Asia/Jerusalem')::date
           end
    from public.organizations o where o.id = p_org), false);
$$;
grant execute on function public.org_is_open(uuid) to authenticated;

-- Same helpers as 0010, now also requiring an open business (the platform admin always passes)
create or replace function public.is_org_staff(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.org_role(p_org) in ('owner', 'member'), false)
     and (public.org_is_open(p_org) or public.is_platform_admin());
$$;

create or replace function public.is_org_reader(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.org_role(p_org) in ('owner', 'member', 'viewer'), false)
     and (public.org_is_open(p_org) or public.is_platform_admin());
$$;

create or replace function public.my_driver_id(p_org uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select m.driver_id from public.memberships m
  where m.org_id = p_org and m.user_id = auth.uid() and m.role = 'driver'
    and public.org_is_open(p_org);
$$;

-- Driver list across businesses: closed businesses drop out
create or replace function public.my_rides_all(p_from date, p_to date)
returns table (
  id uuid, org_id uuid, org_name text,
  ride_date date, ride_time time, pickup text, dropoff text,
  flight_number text, passengers int, notes text, driver_cost numeric,
  distance_km numeric, duration_min int, status text, driver_status text,
  driver_token text, driver_paid_at timestamptz, customer_name text, customer_phone text,
  collect_amount numeric, collected_amount numeric, collected_method text, collected_settled boolean
)
language sql stable security definer set search_path = public as $$
  select r.id, r.org_id, o.name,
         r.ride_date, r.ride_time, r.pickup, r.dropoff,
         r.flight_number, r.passengers, r.notes, r.driver_cost,
         r.distance_km, r.duration_min, r.status, r.driver_status,
         r.driver_token, r.driver_paid_at, c.name, c.phone,
         case when r.driver_collects then r.price end,
         p.amount, p.method, p.settled_at is not null
  from public.memberships m
  join public.rides r on r.org_id = m.org_id and r.driver_id = m.driver_id
  join public.organizations o on o.id = r.org_id
  left join public.customers c on c.id = r.customer_id
  left join public.customer_payments p on p.ride_id = r.id and p.collected_by = m.driver_id
  where m.user_id = auth.uid()
    and m.role = 'driver'
    and public.org_is_open(m.org_id)
    and r.ride_date between p_from and p_to
  order by r.ride_date, r.ride_time nulls first;
$$;

-- What the logged-in user's businesses look like (for the "account closed" screen and the trial banner)
create or replace function public.my_org_access()
returns table (org_id uuid, is_open boolean, plan_status text, trial_ends date)
language sql stable security definer set search_path = public as $$
  select o.id, public.org_is_open(o.id), o.plan_status, o.trial_ends
  from public.memberships m join public.organizations o on o.id = m.org_id
  where m.user_id = auth.uid();
$$;
grant execute on function public.my_org_access() to authenticated;

-- ---------- Admin ----------
drop function if exists public.admin_businesses();
create function public.admin_businesses()
returns table (
  id uuid, name text, created_at timestamptz, plan_status text, admin_notes text,
  owners text, users_count int, drivers_count int, customers_count int,
  rides_total int, rides_30d int, last_ride_added timestamptz,
  monthly_price numeric, started_on date, trial_ends date, is_open boolean,
  last_payment_date date, last_payment_amount numeric, paid_total numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  return query
  select o.id, o.name, o.created_at, o.plan_status, o.admin_notes,
    (select string_agg(m.email, ', ' order by m.created_at) from public.memberships m where m.org_id = o.id and m.role = 'owner'),
    (select count(*)::int from public.memberships m where m.org_id = o.id),
    (select count(*)::int from public.drivers d where d.org_id = o.id),
    (select count(*)::int from public.customers c where c.org_id = o.id),
    (select count(*)::int from public.rides r where r.org_id = o.id),
    (select count(*)::int from public.rides r where r.org_id = o.id and r.created_at > now() - interval '30 days'),
    (select max(r.created_at) from public.rides r where r.org_id = o.id),
    o.monthly_price, o.started_on, o.trial_ends, public.org_is_open(o.id),
    lp.paid_on, lp.amount,
    (select coalesce(sum(sp.amount), 0) from public.subscription_payments sp where sp.org_id = o.id)
  from public.organizations o
  left join lateral (
    select sp.paid_on, sp.amount from public.subscription_payments sp
    where sp.org_id = o.id order by sp.paid_on desc, sp.created_at desc limit 1
  ) lp on true
  order by o.created_at desc;
end;
$$;
grant execute on function public.admin_businesses() to authenticated;

drop function if exists public.admin_update_business(uuid, text, text, text);
create function public.admin_update_business(
  p_org uuid, p_name text, p_status text, p_notes text,
  p_price numeric, p_started_on date, p_trial_ends date
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  update public.organizations
     set name = coalesce(nullif(trim(p_name), ''), name),
         plan_status = p_status,
         admin_notes = nullif(trim(p_notes), ''),
         monthly_price = p_price,
         started_on = coalesce(p_started_on, started_on),
         trial_ends = p_trial_ends
   where id = p_org;
end;
$$;
grant execute on function public.admin_update_business(uuid, text, text, text, numeric, date, date) to authenticated;

create or replace function public.admin_payments(p_org uuid)
returns setof public.subscription_payments
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  return query select * from public.subscription_payments where org_id = p_org order by paid_on desc, created_at desc;
end;
$$;
grant execute on function public.admin_payments(uuid) to authenticated;

-- Record a payment; a paying business becomes "active" (open, no trial end)
create or replace function public.admin_add_payment(p_org uuid, p_amount numeric, p_paid_on date, p_method text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  insert into public.subscription_payments (org_id, amount, paid_on, method, note)
  values (p_org, p_amount, coalesce(p_paid_on, (now() at time zone 'Asia/Jerusalem')::date), p_method, nullif(trim(p_note), ''));
  update public.organizations set plan_status = 'active' where id = p_org and plan_status <> 'active';
end;
$$;
grant execute on function public.admin_add_payment(uuid, numeric, date, text, text) to authenticated;

create or replace function public.admin_delete_payment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  delete from public.subscription_payments where id = p_id;
end;
$$;
grant execute on function public.admin_delete_payment(uuid) to authenticated;

-- ---------- Owners may rename their business, but never touch its subscription fields ----------
create or replace function public.protect_org_subscription()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null for the server itself (cron, edge functions with the service key)
  if auth.uid() is not null and not public.is_platform_admin() and (
       new.plan_status   is distinct from old.plan_status
    or new.trial_ends    is distinct from old.trial_ends
    or new.monthly_price is distinct from old.monthly_price
    or new.started_on    is distinct from old.started_on
    or new.admin_notes   is distinct from old.admin_notes) then
    raise exception 'רק מנהל המערכת יכול לשנות את פרטי המנוי';
  end if;
  return new;
end;
$$;
drop trigger if exists organizations_protect_subscription on public.organizations;
create trigger organizations_protect_subscription
  before update on public.organizations
  for each row execute function public.protect_org_subscription();
