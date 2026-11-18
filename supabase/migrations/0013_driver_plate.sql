-- =========================================================
-- Migration 0013: car plate number per driver
-- Sent to the customer together with the driver's name, car and phone.
-- Run once in the Supabase SQL Editor.
-- =========================================================
alter table public.drivers add column if not exists car_plate text;
