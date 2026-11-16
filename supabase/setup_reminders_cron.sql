-- Run ONCE in the Supabase SQL Editor, after deploying the send-reminders function.
-- Replace PUT-YOUR-CRON-SECRET-HERE with the same value you set as CRON_SECRET
-- (npx supabase secrets set CRON_SECRET=...). Do not commit the real secret.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Remove an older schedule with the same name, if any
select cron.unschedule(jobid) from cron.job where jobname = 'nesiot-send-reminders';

-- Every 5 minutes
select cron.schedule(
  'nesiot-send-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://lcuzitnwbvueytppbuan.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'PUT-YOUR-CRON-SECRET-HERE'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Check:  select * from cron.job;
-- Recent runs:  select * from cron.job_run_details order by start_time desc limit 10;
