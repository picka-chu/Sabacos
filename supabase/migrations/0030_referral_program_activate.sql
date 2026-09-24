-- 0030: Activate the referral program.
--
-- The program shipped with is_active = false (0011) and no later migration
-- ever flipped it, so commission, friend discount, spins and counts stayed
-- dead even with correct code and correct settings values. The admin toggle
-- remains the explicit opt-out; this only fixes the default going forward
-- and activates the existing singleton row.
alter table public.referral_settings
  alter column is_active set default true;

update public.referral_settings
  set is_active = true,
      updated_at = now()
  where id = '00000000-0000-0000-0000-000000000001'
    and is_active = false;
