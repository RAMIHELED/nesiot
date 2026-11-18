-- Move Rami's trial data out of Gadi's business into a new demo business.
-- After this: "הסעות גדי" is empty (only Gadi's own driver), and Rami owns "דמו – רמי"
-- with all the rides, customers and drivers he created while testing.
-- Run once in the Supabase SQL Editor. Edit the 3 values below if needed.
do $$
declare
  gadi_org  uuid := (select id from public.organizations where name = 'הסעות גדי');
  rami      uuid := (select id from auth.users where lower(email) = 'ramiheled2211@gmail.com');
  demo_name text := 'דמו – רמי';
  demo      uuid;
begin
  if gadi_org is null then raise exception 'business "הסעות גדי" not found'; end if;
  if rami is null then raise exception 'user ramiheled2211@gmail.com not found'; end if;

  insert into public.organizations (name) values (demo_name) returning id into demo;
  insert into public.memberships (org_id, user_id, role, email) values (demo, rami, 'owner', 'ramiheled2211@gmail.com');

  -- Everything Rami entered moves as is (ids stay, so links between rows stay)
  update public.drivers            set org_id = demo where org_id = gadi_org;
  update public.customers          set org_id = demo where org_id = gadi_org;
  update public.recurring_rides    set org_id = demo where org_id = gadi_org;
  update public.rides              set org_id = demo where org_id = gadi_org;
  update public.customer_payments  set org_id = demo where org_id = gadi_org;
  update public.driver_absences    set org_id = demo where org_id = gadi_org;
  update public.price_list         set org_id = demo where org_id = gadi_org;
  -- Test driver logins and pending driver invites go with their drivers
  update public.memberships set org_id = demo where org_id = gadi_org and role = 'driver';
  update public.invitations set org_id = demo where org_id = gadi_org and role = 'driver';

  -- Gadi starts with himself as the "me" driver
  insert into public.drivers (org_id, name, is_self) values (gadi_org, 'גדי', true);

  raise notice 'demo business % created', demo;
end $$;

-- Check: Gadi's business should show 0 rides, 0 customers, 1 driver
select o.name,
  (select count(*) from public.rides r where r.org_id = o.id)     as rides,
  (select count(*) from public.customers c where c.org_id = o.id) as customers,
  (select count(*) from public.drivers d where d.org_id = o.id)   as drivers,
  (select string_agg(m.email || ' (' || m.role || ')', ', ') from public.memberships m where m.org_id = o.id) as users
from public.organizations o order by o.created_at;
