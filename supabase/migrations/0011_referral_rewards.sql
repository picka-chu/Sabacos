-- 0011: Referral & Rewards Program
-- Tables: referrals, wallet_credits, wallet_transactions, referral_rewards,
--         spinner_spins, spinner_prizes, referral_settings

-- ──────────────────────────────────────────────────────────────────────
-- REFERRALS
-- Tracks who referred whom and qualification status
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referred_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referral_code text NOT NULL,                       -- code used to join
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','qualified','expired')),
  qualified_at  timestamptz,                         -- when first purchase qualified
  order_id      uuid,                                -- the qualifying order
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(referred_id)                               -- one referral per user
);

CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX idx_referrals_code     ON referrals(referral_code);
CREATE INDEX idx_referrals_status   ON referrals(status);

-- ──────────────────────────────────────────────────────────────────────
-- REFERRAL REWARDS
-- Logs each reward event (commission or spin) tied to a referral
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_rewards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id   uuid NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  reward_type   text NOT NULL CHECK (reward_type IN ('commission','spin_credit','spin_granted')),
  amount_halala int,                                 -- for commission
  metadata      jsonb,                               -- extra info (order_id, spin_id, etc.)
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_referral_rewards_referral ON referral_rewards(referral_id);

-- ──────────────────────────────────────────────────────────────────────
-- WALLET
-- Stores wallet balance and transaction history
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_credits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  balance_halala int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(profile_id)                               -- one wallet per user
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id     uuid NOT NULL REFERENCES wallet_credits(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('credit','debit','refund')),
  amount_halala int NOT NULL,                        -- positive for credit, debit shows as negative
  description   text,
  reference_type text,                               -- 'commission', 'spinner_coupon', 'order_refund', 'admin_adjustment'
  reference_id  uuid,                                -- related entity id
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wallet_tx_wallet ON wallet_transactions(wallet_id);
CREATE INDEX idx_wallet_tx_created ON wallet_transactions(created_at);

-- ──────────────────────────────────────────────────────────────────────
-- SPINNER
-- Tracks spins earned and prize pool
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spinner_spins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'available'
                CHECK (status IN ('available','used','expired')),
  won_prize_id  uuid,                               -- FK added after spinner_prizes created
  won_at        timestamptz,
  expires_at    timestamptz,                         -- soft expiry for urgency
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_spinner_spins_profile ON spinner_spins(profile_id);
CREATE INDEX idx_spinner_spins_status  ON spinner_spins(status);

-- ──────────────────────────────────────────────────────────────────────
-- SPINNER PRIZES
-- Configurable prize pool with weights and stock limits
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spinner_prizes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,                       -- "5% off", "Free mini product", etc.
  prize_type    text NOT NULL CHECK (prize_type IN ('coupon_percent','coupon_fixed','free_product','spin_again')),
  value         int NOT NULL DEFAULT 0,              -- percent for coupon_percent, halala for coupon_fixed, 0 for spin_again
  product_id    uuid,                                -- for free_product type
  weight        numeric(5,2) NOT NULL DEFAULT 10.0,  -- probability weight (sum of all weights = total probability)
  max_pool      int,                                 -- null = unlimited
  current_pool  int NOT NULL DEFAULT 0,              -- how many still available
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Now add FK for spinner_spins
ALTER TABLE spinner_spins
  ADD CONSTRAINT fk_spinner_spins_prize
  FOREIGN KEY (won_prize_id) REFERENCES spinner_prizes(id) ON DELETE SET NULL;

-- ──────────────────────────────────────────────────────────────────────
-- SPINNER COUPONS
-- Generated coupons from spinner wins
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spinner_coupons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  spin_id       uuid NOT NULL REFERENCES spinner_spins(id) ON DELETE CASCADE,
  code          text NOT NULL UNIQUE,                -- unique coupon code
  discount_type text NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_value int NOT NULL,                       -- percent or halala
  min_order_halala int DEFAULT 0,                    -- minimum order to use
  is_used       boolean NOT NULL DEFAULT false,
  used_at       timestamptz,
  order_id      uuid,                                -- order it was used on
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_spinner_coupons_profile ON spinner_coupons(profile_id);
CREATE INDEX idx_spinner_coupons_code    ON spinner_coupons(code);

-- ──────────────────────────────────────────────────────────────────────
-- REFERRAL SETTINGS
-- Singleton config row for referral program
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_settings (
  id              uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001',
  is_active       boolean NOT NULL DEFAULT false,

  -- Commission settings
  first_purchase_percent  int NOT NULL DEFAULT 10,   -- 8-10% of first purchase
  repeat_purchase_percent int NOT NULL DEFAULT 0,    -- 0% for now (recurring disabled at launch)
  monthly_cap_halala      int NOT NULL DEFAULT 50000, -- 500 ETB monthly cap

  -- Spinner settings
  referrals_per_spin  int NOT NULL DEFAULT 3,        -- 3 referrals = 1 spin
  max_spins_per_week  int NOT NULL DEFAULT 5,        -- weekly cap
  spin_expiry_days    int NOT NULL DEFAULT 30,       -- spins expire after 30 days

  -- Coupon settings
  coupon_expiry_days  int NOT NULL DEFAULT 14,       -- coupons expire after 14 days
  max_coupons_per_order int NOT NULL DEFAULT 1,      -- one spinner coupon per order

  -- Anti-fraud
  min_account_age_days    int NOT NULL DEFAULT 30,   -- referred account must be 30+ days old
  min_order_value_halala  int NOT NULL DEFAULT 10000, -- 100 ETB minimum order

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Insert default settings
INSERT INTO referral_settings (id) VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────
-- RPC: Credit wallet atomically (prevents race conditions)
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION credit_wallet(
  p_profile_id uuid,
  p_amount_halala int,
  p_description text,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_wallet_id uuid;
  v_new_balance int;
BEGIN
  -- Get or create wallet
  INSERT INTO wallet_credits (profile_id, balance_halala)
  VALUES (p_profile_id, 0)
  ON CONFLICT (profile_id) DO NOTHING
  RETURNING id INTO v_wallet_id;

  IF v_wallet_id IS NULL THEN
    SELECT id INTO v_wallet_id FROM wallet_credits WHERE profile_id = p_profile_id;
  END IF;

  -- Update balance
  UPDATE wallet_credits
  SET balance_halala = balance_halala + p_amount_halala,
      updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance_halala INTO v_new_balance;

  -- Log transaction
  INSERT INTO wallet_transactions (wallet_id, type, amount_halala, description, reference_type, reference_id)
  VALUES (v_wallet_id, 'credit', p_amount_halala, p_description, p_reference_type, p_reference_id);

  RETURN jsonb_build_object('wallet_id', v_wallet_id, 'new_balance', v_new_balance);
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────
-- RPC: Debit wallet atomically
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION debit_wallet(
  p_profile_id uuid,
  p_amount_halala int,
  p_description text,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_wallet_id uuid;
  v_balance int;
  v_new_balance int;
BEGIN
  SELECT id, balance_halala INTO v_wallet_id, v_balance
  FROM wallet_credits WHERE profile_id = p_profile_id;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found for profile %', p_profile_id;
  END IF;

  IF v_balance < p_amount_halala THEN
    RAISE EXCEPTION 'Insufficient wallet balance: % < %', v_balance, p_amount_halala;
  END IF;

  UPDATE wallet_credits
  SET balance_halala = balance_halala - p_amount_halala,
      updated_at = now()
  WHERE id = v_wallet_id
  RETURNING balance_halala INTO v_new_balance;

  INSERT INTO wallet_transactions (wallet_id, type, amount_halala, description, reference_type, reference_id)
  VALUES (v_wallet_id, 'debit', p_amount_halala, p_description, p_reference_type, p_reference_id);

  RETURN jsonb_build_object('wallet_id', v_wallet_id, 'new_balance', v_new_balance);
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────
-- RPC: Process a qualified referral (called after first purchase)
-- Credits commission + grants spin if threshold met
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION process_referral_reward(
  p_referral_id uuid,
  p_order_id uuid,
  p_order_total_halala int
) RETURNS jsonb AS $$
DECLARE
  v_referral referrals%ROWTYPE;
  v_settings referral_settings%ROWTYPE;
  v_commission int;
  v_result jsonb := '{}';
  v_spin_count int;
  v_spins_earned int;
BEGIN
  -- Get referral
  SELECT * INTO v_referral FROM referrals WHERE id = p_referral_id;
  IF NOT FOUND OR v_referral.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'referral_not_found_or_already_qualified');
  END IF;

  -- Get settings
  SELECT * INTO v_settings FROM referral_settings WHERE id = '00000000-0000-0000-0000-000000000001';
  IF NOT FOUND OR NOT v_settings.is_active THEN
    RETURN jsonb_build_object('error', 'referral_program_inactive');
  END IF;

  -- Check minimum order value
  IF p_order_total_halala < v_settings.min_order_value_halala THEN
    RETURN jsonb_build_object('error', 'order_below_minimum');
  END IF;

  -- Mark referral as qualified
  UPDATE referrals
  SET status = 'qualified', qualified_at = now(), order_id = p_order_id, updated_at = now()
  WHERE id = p_referral_id;

  -- Calculate commission (first purchase only for now)
  v_commission := (p_order_total_halala * v_settings.first_purchase_percent / 100);

  -- Check monthly cap
  DECLARE
    v_monthly_total int;
  BEGIN
    SELECT COALESCE(SUM(amount_halala), 0) INTO v_monthly_total
    FROM referral_rewards rr
    JOIN referrals r ON r.id = rr.referral_id
    WHERE r.referrer_id = v_referral.referrer_id
      AND rr.reward_type = 'commission'
      AND rr.created_at >= date_trunc('month', now());

    IF v_monthly_total + v_commission > v_settings.monthly_cap_halala THEN
      v_commission := GREATEST(0, v_settings.monthly_cap_halala - v_monthly_total);
    END IF;
  END;

  -- Credit commission to referrer's wallet (if positive)
  IF v_commission > 0 THEN
    PERFORM credit_wallet(
      v_referral.referrer_id,
      v_commission,
      format('Commission from referral order (%%s)', p_order_id),
      'commission',
      p_referral_id
    );

    INSERT INTO referral_rewards (referral_id, reward_type, amount_halala, metadata)
    VALUES (p_referral_id, 'commission', v_commission, jsonb_build_object('order_id', p_order_id));
  END IF;

  -- Check if referrer earned any spins
  SELECT COUNT(*) INTO v_spin_count
  FROM referrals WHERE referrer_id = v_referral.referrer_id AND status = 'qualified';

  v_spins_earned := v_spin_count / v_settings.referrals_per_spin;

  -- Grant available spins (only grant new ones, not re-grant old ones)
  DECLARE
    v_existing_spins int;
    v_new_spins int;
  BEGIN
    SELECT COUNT(*) INTO v_existing_spins
    FROM spinner_spins WHERE profile_id = v_referral.referrer_id AND status = 'available';

    v_new_spins := GREATEST(0, v_spins_earned - v_existing_spins);

    FOR i IN 1..v_new_spins LOOP
      INSERT INTO spinner_spins (profile_id, expires_at)
      VALUES (v_referral.referrer_id, now() + (v_settings.spin_expiry_days || ' days')::interval);

      INSERT INTO referral_rewards (referral_id, reward_type, metadata)
      VALUES (p_referral_id, 'spin_granted', jsonb_build_object('referrer_id', v_referral.referrer_id));
    END LOOP;

    v_result := jsonb_build_object(
      'commission_halala', v_commission,
      'spins_earned', v_new_spins,
      'total_qualified_referrals', v_spin_count,
      'next_spin_at', (v_spin_count % v_settings.referrals_per_spin)
    );
  END;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;
