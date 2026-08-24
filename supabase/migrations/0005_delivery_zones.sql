-- Zone delivery pricing: order location snapshot, fragile flag, config column.

alter table products add column if not exists is_fragile boolean not null default false;

alter table orders add column if not exists latitude double precision;
alter table orders add column if not exists longitude double precision;
alter table orders add column if not exists zone smallint;
alter table orders add column if not exists delivery_type text not null default 'standard';
alter table orders add column if not exists fragile boolean not null default false;
