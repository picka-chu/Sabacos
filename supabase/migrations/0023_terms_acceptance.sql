-- 0023: Terms & Policies acceptance tracking on profiles.
--
-- New users must accept the current Terms (version 1.0, effective 2026-09-15)
-- during onboarding, after choosing a language. Existing rows keep
-- terms_accepted_at NULL, so every current user is asked exactly once.

alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;
