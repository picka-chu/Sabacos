-- Fix "column reference value is ambiguous" in next_order_seq()
-- by qualifying every column reference with an explicit table alias.

create or replace function public.next_order_seq()
returns integer
language plpgsql
as $$
declare seq integer;
begin
  insert into public.settings as s (key, value)
  values ('order_seq', '{"count":1}'::jsonb)
  on conflict (key) do update
    set value = jsonb_set(
      s.value,
      '{count}',
      to_jsonb((coalesce((s.value->>'count')::int, 0) + 1))
    )
  returning (s.value->>'count')::int into seq;
  return seq;
end;
$$;
