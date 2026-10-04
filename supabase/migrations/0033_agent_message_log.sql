-- 0033: Marketing agent message log (frequency caps + audit trail).
--
-- notify_log is product-scoped (FK to products), so cart/win-back/referral
-- nudges that have no single product get their own log. The agent skips any
-- profile messaged in the last N days using this table.
create table if not exists agent_message_log (
  id bigint generated always as identity primary key,
  profile_id uuid not null references profiles (id) on delete cascade,
  job text not null,
  ref_id text,
  sent_at timestamptz not null default now()
);

create index if not exists agent_message_log_profile_idx
  on agent_message_log (profile_id, sent_at desc);
