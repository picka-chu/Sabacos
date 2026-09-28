-- 0032: User suspension system.
--
-- Suspended users are blocked from the mini app (requireUser 403), lose
-- admin/dashboard access, and get a notice from the bot instead of the menu.
-- Unsuspending restores everything; no data is deleted.
alter table public.profiles add column if not exists is_suspended boolean not null default false;
alter table public.profiles add column if not exists suspended_reason text;
alter table public.profiles add column if not exists suspended_at timestamptz;
