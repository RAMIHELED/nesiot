-- =========================================================
-- Migration 0003: driver vehicle details
-- Run once in the Supabase SQL Editor.
-- =========================================================

alter table public.drivers
  add column if not exists seats     int  not null default 5 check (seats between 1 and 60),
  add column if not exists car_model text;
