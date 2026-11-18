-- Sample data for Rami's demo business only ("דמו – רמי").
-- Put YOUR mobile number below, so every WhatsApp test goes to you.
-- Safe to run again: it first removes the previous sample data of the demo business.
do $$
declare
  my_phone text := '050-0000000';            -- <<< your mobile number
  demo uuid := (select id from public.organizations where name = 'דמו – רמי');
  d_self uuid; d_moshe uuid; d_avi uuid;
  c_yossi uuid; c_dana uuid; c_hitech uuid; c_once uuid;
  t date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if demo is null then raise exception 'business "דמו – רמי" not found'; end if;

  delete from public.customer_payments where org_id = demo;
  delete from public.rides where org_id = demo;
  delete from public.customers where org_id = demo;
  delete from public.drivers where org_id = demo and not is_self;

  select id into d_self from public.drivers where org_id = demo and is_self limit 1;
  if d_self is null then
    insert into public.drivers (org_id, name, phone, is_self) values (demo, 'רמי', my_phone, true) returning id into d_self;
  else
    update public.drivers set phone = coalesce(phone, my_phone) where id = d_self;
  end if;
  insert into public.drivers (org_id, name, phone, seats, car_model, car_plate)
    values (demo, 'משה (דמו)', my_phone, 5, 'טויוטה קורולה', '12-345-67') returning id into d_moshe;
  insert into public.drivers (org_id, name, phone, seats, car_model, car_plate)
    values (demo, 'אבי (דמו)', my_phone, 8, 'פולקסווגן טרנספורטר', '98-765-43') returning id into d_avi;

  insert into public.customers (org_id, name, phone, kind) values (demo, 'יוסי כהן', my_phone, 'private') returning id into c_yossi;
  insert into public.customers (org_id, name, phone, kind) values (demo, 'דנה לוי', my_phone, 'private') returning id into c_dana;
  insert into public.customers (org_id, name, phone, email, kind) values (demo, 'הייטק בע״מ', my_phone, 'office@example.com', 'company') returning id into c_hitech;
  insert into public.customers (org_id, name, phone, kind) values (demo, 'לקוח חד-פעמי', my_phone, 'private') returning id into c_once;

  -- Past rides (create debt, some paid)
  insert into public.rides (org_id, customer_id, driver_id, ride_date, ride_time, pickup, dropoff, flight_number, passengers, price, driver_cost) values
    (demo, c_yossi,  d_moshe, t - 40, '05:30', 'הרצליה, סוקולוב 5', 'נתב״ג', 'LY001', 3, 250, 180),
    (demo, c_yossi,  d_moshe, t - 20, '14:00', 'נתב״ג', 'הרצליה, סוקולוב 5', null, 3, 250, 180),
    (demo, c_yossi,  d_self,  t - 5,  '09:00', 'הרצליה', 'תל אביב, עזריאלי', null, 1, 120, null),
    (demo, c_hitech, d_avi,   t - 12, '07:00', 'רעננה, אחוזה 100', 'נתב״ג', 'IZ315', 6, 400, 300),
    (demo, c_hitech, d_avi,   t - 3,  '18:30', 'נתב״ג', 'רעננה, אחוזה 100', null, 6, 400, 300),
    (demo, c_dana,   d_self,  t - 8,  '11:00', 'כפר סבא', 'נתב״ג', 'W6 2301', 2, 200, null),
    (demo, c_once,   d_moshe, t - 15, '06:00', 'נתניה', 'נתב״ג', null, 2, 280, 200);
  -- Payments: Dana paid on the spot, Yossi paid part, the company paid one ride
  insert into public.customer_payments (org_id, customer_id, ride_id, amount, method, paid_on)
    select demo, c_dana, id, 200, 'cash', ride_date from public.rides where org_id = demo and customer_id = c_dana;
  insert into public.customer_payments (org_id, customer_id, amount, method, paid_on, note) values
    (demo, c_yossi, 300, 'bit', t - 10, null),
    (demo, c_hitech, 400, 'transfer', t - 6, 'חשבונית 1001'),
    (demo, c_once, 280, 'cash', t - 15, null);

  -- Today and tomorrow (one without a driver)
  insert into public.rides (org_id, customer_id, driver_id, ride_date, ride_time, pickup, dropoff, flight_number, passengers, price, driver_cost) values
    (demo, c_dana,   d_moshe, t,     '16:00', 'נתב״ג', 'כפר סבא', 'W6 2302', 2, 200, 150),
    (demo, c_yossi,  d_moshe, t + 1, '04:45', 'הרצליה, סוקולוב 5', 'נתב״ג', 'LY315', 3, 250, 180),
    (demo, c_hitech, d_moshe, t + 1, '13:00', 'רעננה, אחוזה 100', 'תל אביב', null, 4, 180, 130),
    (demo, c_hitech, d_avi,   t + 1, '07:30', 'רעננה, אחוזה 100', 'נתב״ג', 'IZ317', 7, 400, 300),
    (demo, c_dana,   null,    t + 1, '20:00', 'נתב״ג', 'כפר סבא', 'W6 2310', 2, 200, 150);
end $$;

select
  (select count(*) from public.rides r join public.organizations o on o.id = r.org_id where o.name = 'דמו – רמי') as demo_rides,
  (select count(*) from public.rides r join public.organizations o on o.id = r.org_id where o.name = 'הסעות גדי') as gadi_rides_untouched;
