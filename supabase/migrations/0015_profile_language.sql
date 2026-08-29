-- User interface language chosen during the bot /start flow.
-- Values: 'en' | 'am'. Mirrored into the mini app via /auth/telegram.
alter table public.profiles add column if not exists language text;