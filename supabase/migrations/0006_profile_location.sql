-- Bot-shared location: latest GPS pin per profile (used for zone pricing).

alter table profiles add column if not exists last_latitude double precision;
alter table profiles add column if not exists last_longitude double precision;
