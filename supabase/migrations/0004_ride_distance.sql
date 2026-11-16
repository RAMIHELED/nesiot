-- =========================================================
-- Migration 0004: estimated ride distance and driving time
-- Run once in the Supabase SQL Editor.
-- =========================================================

alter table public.rides
  add column if not exists distance_km  numeric(6,1) check (distance_km is null or distance_km >= 0),
  add column if not exists duration_min int          check (duration_min is null or duration_min >= 0);
