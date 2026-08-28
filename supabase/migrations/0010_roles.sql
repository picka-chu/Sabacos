-- Extend role system to support staff and delivery roles.
-- Safe to run multiple times (IF EXISTS guards).

-- Drop the old CHECK constraint if it exists
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Add new CHECK constraint with all four roles
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('customer', 'staff', 'delivery', 'admin'));
