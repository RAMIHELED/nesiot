-- =========================================================
-- Migration 0016: the driver collects payment from the customer
--   * per ride: "driver collects" → the driver sees the amount to collect (the ride price)
--   * the driver records what he collected → a customer payment linked to the ride
--   * month end: collections are offset against what the business owes the driver
-- Run once in the Supabase SQL Editor.
-- =========================================================

alter table public.rides add column if not exists driver_collects boolean not null default false;

alter table public.customer_payments
  add column if not exists collected_by uuid references public.drivers(id) on delete set null,
  add column if not exists settled_at   timestamptz;   -- the driver handed the money over / it was offset

create index if not exists customer_payments_collected_idx
  on public.customer_payments (collected_by) where collected_by is not null;

-- Driver app list: adds the amount to collect and what he already collected
drop function if exists public.my_rides_all(date, date);
create function public.my_rides_all(p_from date, p_to date)
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
    and r.ride_date between p_from and p_to
  order by r.ride_date, r.ride_time nulls first;
$$;
grant execute on function public.my_rides_all(date, date) to authenticated;

-- Driver records a collection for one of his rides (or corrects it before it was settled)
create or replace function public.driver_collect(p_ride uuid, p_amount numeric, p_method text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r   public.rides%rowtype;
  me  uuid;
  cur public.customer_payments%rowtype;
begin
  select * into r from public.rides where id = p_ride;
  if not found then raise exception 'הנסיעה לא נמצאה'; end if;
  me := public.my_driver_id(r.org_id);
  if me is null or r.driver_id is distinct from me then raise exception 'זו לא נסיעה שלך'; end if;
  if r.status <> 'active' then raise exception 'הנסיעה בוטלה'; end if;
  if r.customer_id is null then raise exception 'לנסיעה אין לקוח, עדכן את הסדרן'; end if;
  if r.ride_date > (now() at time zone 'Asia/Jerusalem')::date then raise exception 'אפשר לרשום גבייה רק ביום הנסיעה או אחריו'; end if;
  if not (p_amount > 0) then raise exception 'סכום לא תקין'; end if;
  if p_method not in ('cash', 'transfer', 'bit', 'card', 'check', 'other') then raise exception 'אמצעי תשלום לא תקין'; end if;

  select * into cur from public.customer_payments where ride_id = p_ride;
  if found then
    if cur.collected_by is distinct from me then raise exception 'התשלום על הנסיעה כבר נרשם אצל הסדרן'; end if;
    if cur.settled_at is not null then raise exception 'הגבייה כבר הוסדרה, פנה לסדרן לתיקון'; end if;
    update public.customer_payments set amount = p_amount, method = p_method where id = cur.id;
  else
    insert into public.customer_payments (org_id, customer_id, ride_id, amount, method, paid_on, note, collected_by)
    values (r.org_id, r.customer_id, r.id, p_amount, p_method,
            (now() at time zone 'Asia/Jerusalem')::date, 'נגבה ע״י הנהג', me);
  end if;
end;
$$;
grant execute on function public.driver_collect(uuid, numeric, text) to authenticated;

-- Driver cancels his own collection (only before it was settled)
create or replace function public.driver_uncollect(p_ride uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.rides%rowtype;
begin
  select * into r from public.rides where id = p_ride;
  if not found then raise exception 'הנסיעה לא נמצאה'; end if;
  delete from public.customer_payments
   where ride_id = p_ride
     and collected_by = public.my_driver_id(r.org_id)
     and settled_at is null;
end;
$$;
grant execute on function public.driver_uncollect(uuid) to authenticated;
