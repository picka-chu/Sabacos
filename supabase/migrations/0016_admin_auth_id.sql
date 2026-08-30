-- Admin browser login: link a profile to a Supabase Auth user.
-- After creating the admin user in Supabase Auth, run:
--   update public.profiles set auth_id = '<auth-user-uuid>'
--   where telegram_id = <the-admin-telegram-id>;
-- (or set the role / pick a row as needed). The dashboard bearer-token path
-- (browser login) then finds the admin profile by this column.

alter table public.profiles
  add column if not exists auth_id uuid unique;