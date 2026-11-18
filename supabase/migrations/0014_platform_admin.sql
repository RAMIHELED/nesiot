-- =========================================================
-- Migration 0014: platform admin (Rami) – open and manage businesses from the app
-- Run once in the Supabase SQL Editor.
-- =========================================================

-- Who may manage all businesses. Not readable by anyone directly; only through the functions below.
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;

insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = 'ramiheled2211@gmail.com'
on conflict do nothing;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;
grant execute on function public.is_platform_admin() to authenticated;

-- Business status for the admin only (a label; it does not block access)
alter table public.organizations
  add column if not exists plan_status text not null default 'trial',
  add column if not exists admin_notes text;
alter table public.organizations drop constraint if exists organizations_plan_status_check;
alter table public.organizations add constraint organizations_plan_status_check
  check (plan_status in ('trial', 'active', 'paused'));

-- All businesses with usage numbers
create or replace function public.admin_businesses()
returns table (
  id uuid, name text, created_at timestamptz, plan_status text, admin_notes text,
  owners text, users_count int, drivers_count int, customers_count int,
  rides_total int, rides_30d int, last_ride_added timestamptz
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
    (select max(r.created_at) from public.rides r where r.org_id = o.id)
  from public.organizations o
  order by o.created_at desc;
end;
$$;
grant execute on function public.admin_businesses() to authenticated;

create or replace function public.admin_update_business(p_org uuid, p_name text, p_status text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  update public.organizations
     set name = coalesce(nullif(trim(p_name), ''), name),
         plan_status = p_status,
         admin_notes = nullif(trim(p_notes), '')
   where id = p_org;
end;
$$;
grant execute on function public.admin_update_business(uuid, text, text, text) to authenticated;
