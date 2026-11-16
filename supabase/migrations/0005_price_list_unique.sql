-- =========================================================
-- Migration 0005: one price per route (per customer, or general)
-- Run once in the Supabase SQL Editor.
-- =========================================================

-- Remove exact duplicates if any were created before this index (keeps the newest)
delete from public.price_list p
using public.price_list q
where p.org_id = q.org_id
  and coalesce(p.customer_id, '00000000-0000-0000-0000-000000000000'::uuid)
    = coalesce(q.customer_id, '00000000-0000-0000-0000-000000000000'::uuid)
  and public.norm(p.pickup) = public.norm(q.pickup)
  and public.norm(p.dropoff) = public.norm(q.dropoff)
  and (p.updated_at, p.id) < (q.updated_at, q.id);

create unique index if not exists price_list_route_uq on public.price_list (
  org_id,
  coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid),
  public.norm(pickup),
  public.norm(dropoff)
);

create or replace function public.touch_price_list()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists price_list_touch on public.price_list;
create trigger price_list_touch before update on public.price_list
  for each row execute function public.touch_price_list();
