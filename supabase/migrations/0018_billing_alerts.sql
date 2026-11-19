-- =========================================================
-- Migration 0018: billing alerts for the platform admin (Rami)
--   * which businesses need attention: trial ends today/tomorrow, trial ended, payment overdue
--   * owner's phone for a WhatsApp reminder from the admin screen
--   * one push a day (09:00 Israel) to the admin when something needs attention
-- Run once in the Supabase SQL Editor.
-- =========================================================

alter table public.platform_admins add column if not exists last_alert_date date;

-- Attention status of one business ('' = nothing to do)
--   trial_ending: trial ends today or tomorrow
--   trial_ended:  trial is over and no payment recorded
--   overdue:      paying business, a month or more since the last payment (or since the start)
create or replace function public.org_billing_status(p_org uuid)
returns table (status text, due_date date)
language sql stable security definer set search_path = public as $$
  with o as (
    select org.*, (now() at time zone 'Asia/Jerusalem')::date as today,
      (select max(sp.paid_on) from public.subscription_payments sp where sp.org_id = org.id) as last_paid
    from public.organizations org where org.id = p_org
  )
  select
    case
      when o.plan_status = 'trial' and o.trial_ends is not null and o.trial_ends < o.today then 'trial_ended'
      when o.plan_status = 'trial' and o.trial_ends is not null and o.trial_ends <= o.today + 1 then 'trial_ending'
      when o.plan_status = 'active' and coalesce(o.monthly_price, 0) > 0
           and (coalesce(o.last_paid, o.started_on) + interval '1 month')::date <= o.today then 'overdue'
      else ''
    end,
    case
      when o.plan_status = 'trial' then o.trial_ends
      when o.plan_status = 'active' then (coalesce(o.last_paid, o.started_on) + interval '1 month')::date
    end
  from o;
$$;

drop function if exists public.admin_businesses();
create function public.admin_businesses()
returns table (
  id uuid, name text, created_at timestamptz, plan_status text, admin_notes text,
  owners text, users_count int, drivers_count int, customers_count int,
  rides_total int, rides_30d int, last_ride_added timestamptz,
  monthly_price numeric, started_on date, trial_ends date, is_open boolean,
  last_payment_date date, last_payment_amount numeric, paid_total numeric,
  owner_name text, owner_phone text, billing_status text, next_due date
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
    (select coalesce(sum(sp.amount), 0) from public.subscription_payments sp where sp.org_id = o.id),
    me.name, me.phone, bs.status, bs.due_date
  from public.organizations o
  left join lateral (
    select sp.paid_on, sp.amount from public.subscription_payments sp
    where sp.org_id = o.id order by sp.paid_on desc, sp.created_at desc limit 1
  ) lp on true
  left join lateral (
    select d.name, d.phone from public.drivers d where d.org_id = o.id and d.is_self order by d.created_at limit 1
  ) me on true
  left join lateral public.org_billing_status(o.id) bs on true
  order by o.created_at desc;
end;
$$;
grant execute on function public.admin_businesses() to authenticated;

-- Called by the reminders cron (service role): once a day from 09:00, the admins and what needs attention.
-- Marks the day as sent, so each admin gets one push a day at most.
create or replace function public.due_admin_alerts()
returns table (user_id uuid, trial_ending int, trial_ended int, overdue int, names text)
language plpgsql security definer set search_path = public as $$
declare
  local_now timestamp := now() at time zone 'Asia/Jerusalem';
begin
  if local_now::time < time '09:00' then return; end if;
  return query
  with s as (
    select o.name, bs.status from public.organizations o, lateral public.org_billing_status(o.id) bs
    where bs.status <> ''
      -- an ended trial is reported for 3 days, then it stops nagging (still listed in the admin screen)
      and not (bs.status = 'trial_ended' and bs.due_date < local_now::date - 3)
  ), marked as (
    update public.platform_admins pa set last_alert_date = local_now::date
    where pa.last_alert_date is distinct from local_now::date
      and exists (select 1 from s)
    returning pa.user_id
  )
  select m.user_id,
    (select count(*)::int from s where s.status = 'trial_ending'),
    (select count(*)::int from s where s.status = 'trial_ended'),
    (select count(*)::int from s where s.status = 'overdue'),
    (select string_agg(s.name, ', ') from s)
  from marked m;
end;
$$;
revoke execute on function public.due_admin_alerts() from public, anon, authenticated;
