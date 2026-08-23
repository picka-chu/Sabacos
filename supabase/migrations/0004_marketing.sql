-- Marketing agent: browsing history, ad copy cache, notification log, sweep state.

create table if not exists product_views (
  id bigint generated always as identity primary key,
  profile_id uuid not null references profiles (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  category_id uuid references categories (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists product_views_profile_idx on product_views (profile_id, created_at desc);
create index if not exists product_views_category_idx on product_views (category_id, created_at desc);

create table if not exists ad_copy_cache (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null
);

create table if not exists notify_log (
  id bigint generated always as identity primary key,
  profile_id uuid not null references profiles (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  kind text not null default 'discount',
  sent_at timestamptz not null default now(),
  unique (profile_id, product_id, kind)
);

create table if not exists job_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
