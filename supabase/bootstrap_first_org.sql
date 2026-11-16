-- Run once in the Supabase SQL editor to open a new business (tenant).
-- Then: Authentication → Users → Add user → the same email (no password needed).
-- The trigger links that user to the business as its owner.

with org as (
  insert into public.organizations (name) values ('הסעות גדי')   -- business name
  returning id
)
insert into public.invitations (email, org_id, role)
select 'gadi@example.com', id, 'owner' from org;                -- owner email, lowercase
