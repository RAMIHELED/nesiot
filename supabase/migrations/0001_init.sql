-- =========================================================
-- Nesiot – ניהול נסיעות והסעות
-- Migration 0001: schema, multi-tenant RLS, price memory
-- =========================================================

create extension if not exists pgcrypto;

-- ---------- Tenants & users ----------

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table public.memberships (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'member')),
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- Invite-only access: a user can sign in only after an email was invited.
create table public.invitations (
  email       text primary key check (email = lower(email)),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'member')),
  created_at  timestamptz not null default now()
);

-- ---------- Helper functions (security definer, used by RLS) ----------

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org and user_id = auth.uid()
  );
$$;

create or replace function public.is_org_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org and user_id = auth.uid() and role = 'owner'
  );
$$;

-- When a new auth user is created, attach them to the org that invited them.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.memberships (org_id, user_id, role)
  select i.org_id, new.id, i.role
  from public.invitations i
  where i.email = lower(new.email)
  on conflict do nothing;

  delete from public.invitations where email = lower(new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Business data ----------

create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  phone       text,
  email       text,
  kind        text not null default 'private' check (kind in ('private', 'company')),
  notes       text,
  created_at  timestamptz not null default now()
);

-- Drivers = the owner himself (is_self) + subcontractors
create table public.drivers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  phone       text,
  is_self     boolean not null default false,
  active      boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now()
);

create table public.rides (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  customer_id     uuid references public.customers(id) on delete set null,
  driver_id       uuid references public.drivers(id) on delete set null,
  ride_date       date not null,
  ride_time       time,
  pickup          text,
  dropoff         text,
  flight_number   text,
  passengers      int check (passengers is null or passengers > 0),
  price           numeric(10,2),          -- charged to the customer
  driver_cost     numeric(10,2),          -- paid to the subcontractor
  status          text not null default 'active' check (status in ('active', 'cancelled')),
  billed_at       timestamptz,            -- included in a customer invoice
  driver_paid_at  timestamptz,            -- subcontractor was paid
  notes           text,
  source_text     text,                   -- original WhatsApp/email/voice text
  created_by      uuid references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index rides_org_date_idx     on public.rides (org_id, ride_date);
create index rides_org_customer_idx on public.rides (org_id, customer_id);
create index rides_org_driver_idx   on public.rides (org_id, driver_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger rides_touch before update on public.rides
  for each row execute function public.touch_updated_at();

-- Imported price list (from the owner's existing Excel). customer_id null = general price.
create table public.price_list (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  customer_id  uuid references public.customers(id) on delete cascade,
  pickup       text not null,
  dropoff      text not null,
  price        numeric(10,2),
  driver_cost  numeric(10,2),
  updated_at   timestamptz not null default now()
);

create index price_list_org_idx on public.price_list (org_id);

-- ---------- Row Level Security ----------

alter table public.organizations enable row level security;
alter table public.memberships   enable row level security;
alter table public.invitations   enable row level security;
alter table public.customers     enable row level security;
alter table public.drivers       enable row level security;
alter table public.rides         enable row level security;
alter table public.price_list    enable row level security;

create policy org_select on public.organizations
  for select using (public.is_org_member(id));
create policy org_update on public.organizations
  for update using (public.is_org_owner(id)) with check (public.is_org_owner(id));

create policy membership_select on public.memberships
  for select using (user_id = auth.uid() or public.is_org_owner(org_id));
create policy membership_delete on public.memberships
  for delete using (public.is_org_owner(org_id) and user_id <> auth.uid());

create policy invitation_owner on public.invitations
  for all using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));

create policy customers_member on public.customers
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy drivers_member on public.drivers
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy rides_member on public.rides
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy price_list_member on public.price_list
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- ---------- Price memory ----------
-- Suggests price + subcontractor cost for a customer and route:
-- 1) last active ride of this customer on the same route
-- 2) customer-specific price list entry
-- 3) general price list entry
-- Runs with the caller's permissions (RLS applies).

create or replace function public.norm(t text)
returns text language sql immutable as $$
  select regexp_replace(lower(btrim(coalesce(t, ''))), '\s+', ' ', 'g');
$$;

create or replace function public.suggest_price(
  p_org uuid, p_customer uuid, p_pickup text, p_dropoff text
) returns table (price numeric, driver_cost numeric, source text)
language sql stable security invoker set search_path = public as $$
  (
    select r.price, r.driver_cost, 'last_ride'::text
    from public.rides r
    where r.org_id = p_org
      and r.status = 'active'
      and p_customer is not null and r.customer_id = p_customer
      and public.norm(r.pickup) = public.norm(p_pickup)
      and public.norm(r.dropoff) = public.norm(p_dropoff)
      and r.price is not null
    order by r.ride_date desc, r.created_at desc
    limit 1
  )
  union all
  (
    select p.price, p.driver_cost, 'price_list_customer'::text
    from public.price_list p
    where p.org_id = p_org
      and p_customer is not null and p.customer_id = p_customer
      and public.norm(p.pickup) = public.norm(p_pickup)
      and public.norm(p.dropoff) = public.norm(p_dropoff)
    limit 1
  )
  union all
  (
    select p.price, p.driver_cost, 'price_list_general'::text
    from public.price_list p
    where p.org_id = p_org
      and p.customer_id is null
      and public.norm(p.pickup) = public.norm(p_pickup)
      and public.norm(p.dropoff) = public.norm(p_dropoff)
    limit 1
  )
  limit 1;
$$;

grant execute on function public.suggest_price(uuid, uuid, text, text) to authenticated;

-- ---------- Grants ----------
-- Newer Supabase projects may not grant access to new tables automatically.
-- RLS above still decides which rows each user can see.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.organizations, public.memberships, public.invitations,
  public.customers, public.drivers, public.rides, public.price_list
  to authenticated;
grant execute on function public.is_org_member(uuid), public.is_org_owner(uuid), public.norm(text)
  to authenticated;
