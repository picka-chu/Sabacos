-- Waitlist, early-bird discounts, and referral system.

-- ---------------------------------------------------------------- waitlist_config
-- Singleton row (always exactly one row) holding the waitlist configuration.
create table if not exists public.waitlist_config (
  id                    uuid primary key default gen_random_uuid(),
  is_active             boolean not null default false,
  discount_percent      integer not null default 20 check (discount_percent between 1 and 100),
  early_bird_limit      integer not null default 200 check (early_bird_limit > 0),
  deadline              timestamptz,
  referral_bonus_percent integer not null default 5 check (referral_bonus_percent between 0 and 50),
  max_referral_discount integer not null default 30 check (max_referral_discount >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Seed the singleton row.
insert into public.waitlist_config (id) values ('00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- waitlist_entries
create table if not exists public.waitlist_entries (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null unique references public.profiles (id) on delete cascade,
  referral_code   text unique not null,
  referred_by     uuid references public.waitlist_entries (id) on delete set null,
  position        integer not null,
  is_early_bird   boolean not null default false,
  status          text not null default 'active'
                  check (status in ('active', 'converted', 'removed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_waitlist_entries_profile on public.waitlist_entries (profile_id);
create index if not exists idx_waitlist_entries_code on public.waitlist_entries (referral_code);
create index if not exists idx_waitlist_entries_referred on public.waitlist_entries (referred_by);

-- ---------------------------------------------------------------- user_discounts
-- Discounts granted to users via waitlist / referral. Applied at checkout.
create table if not exists public.user_discounts (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references public.profiles (id) on delete cascade,
  waitlist_entry_id   uuid references public.waitlist_entries (id) on delete set null,
  discount_percent    integer not null check (discount_percent between 1 and 100),
  source              text not null check (source in ('waitlist_early_bird', 'waitlist_referral')),
  expires_at          timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists idx_user_discounts_profile on public.user_discounts (profile_id);

-- -------------------------------------------------- orders: discount columns
alter table public.orders add column if not exists discount_halala integer not null default 0;
alter table public.orders add column if not exists discount_percent integer not null default 0;

-- -------------------------------------------------------------- updated_at
create trigger trg_waitlist_config_updated before update on public.waitlist_config
  for each row execute function public.set_updated_at();
create trigger trg_waitlist_entries_updated before update on public.waitlist_entries
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ row security
alter table public.waitlist_config enable row level security;
alter table public.waitlist_entries enable row level security;
alter table public.user_discounts enable row level security;

-- Atomic position assignment via RPC
create or replace function public.next_waitlist_position()
returns integer
language plpgsql
as $$
declare pos integer;
begin
  select coalesce(max(position), 0) + 1 into pos from public.waitlist_entries;
  return pos;
end;
$$;
