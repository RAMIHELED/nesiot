-- =========================================================
-- Migration 0012: ride statistics per customer (for sorting and search)
-- Run once in the Supabase SQL Editor.
-- =========================================================

create index if not exists rides_customer_date_idx on public.rides (customer_id, ride_date);

create or replace view public.customer_stats
with (security_invoker = true) as
select c.org_id,
       c.id as customer_id,
       count(r.id) filter (where r.status = 'active')                                        as rides_count,
       max(r.ride_date) filter (where r.status = 'active'
                                and r.ride_date <= (now() at time zone 'Asia/Jerusalem')::date) as last_ride_date,
       min(r.ride_date) filter (where r.status = 'active'
                                and r.ride_date >  (now() at time zone 'Asia/Jerusalem')::date) as next_ride_date
from public.customers c
left join public.rides r on r.customer_id = c.id
group by c.org_id, c.id;

grant select on public.customer_stats to authenticated;
