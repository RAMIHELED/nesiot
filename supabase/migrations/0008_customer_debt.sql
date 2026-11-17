-- =========================================================
-- Migration 0008: customer payments and debt
-- Debt = price of the customer's rides that already took place (not cancelled)
--        minus everything the customer paid.
-- Run once in the Supabase SQL Editor.
-- =========================================================

create table if not exists public.customer_payments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  customer_id  uuid not null references public.customers(id) on delete cascade,
  ride_id      uuid references public.rides(id) on delete set null,   -- set when paid on the spot for one ride
  amount       numeric(10,2) not null check (amount > 0),
  paid_on      date not null default ((now() at time zone 'Asia/Jerusalem')::date),
  method       text check (method in ('cash', 'transfer', 'bit', 'card', 'check', 'other')),
  note         text,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

create index if not exists customer_payments_customer_idx on public.customer_payments (org_id, customer_id);
-- One "paid on the spot" payment per ride
create unique index if not exists customer_payments_ride_uq on public.customer_payments (ride_id) where ride_id is not null;

alter table public.customer_payments enable row level security;
drop policy if exists customer_payments_member on public.customer_payments;
create policy customer_payments_member on public.customer_payments
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
grant select, insert, update, delete on public.customer_payments to authenticated;

-- ---------- Balance per customer ----------
-- oldest_unpaid_date: payments are counted against the oldest rides first;
-- this is the date of the oldest ride that is not fully covered.
create or replace view public.customer_balances
with (security_invoker = true) as
with owed as (
  select r.org_id, r.customer_id, r.id, r.ride_date, coalesce(r.price, 0) as price,
         sum(coalesce(r.price, 0)) over (partition by r.customer_id order by r.ride_date, r.created_at, r.id) as running
  from public.rides r
  where r.customer_id is not null
    and r.status = 'active'
    and r.ride_date <= (now() at time zone 'Asia/Jerusalem')::date
),
paid as (
  select customer_id, sum(amount) as total from public.customer_payments group by customer_id
)
select c.org_id,
       c.id as customer_id,
       coalesce((select sum(o.price) from owed o where o.customer_id = c.id), 0)                as rides_total,
       coalesce(p.total, 0)                                                                    as paid_total,
       coalesce((select sum(o.price) from owed o where o.customer_id = c.id), 0) - coalesce(p.total, 0) as balance,
       (select min(o.ride_date) from owed o where o.customer_id = c.id and o.running > coalesce(p.total, 0)) as oldest_unpaid_date,
       (select max(cp.paid_on) from public.customer_payments cp where cp.customer_id = c.id)  as last_payment_date
from public.customers c
left join paid p on p.customer_id = c.id;

grant select on public.customer_balances to authenticated;
