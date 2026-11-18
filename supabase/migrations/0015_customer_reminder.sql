-- =========================================================
-- Migration 0015: remember when the customer got a reminder for a ride
-- (WhatsApp reminder the day before, sent from the calendar)
-- Run once in the Supabase SQL Editor.
-- =========================================================
alter table public.rides add column if not exists customer_reminded_at timestamptz;
