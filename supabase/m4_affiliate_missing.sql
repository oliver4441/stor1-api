-- ============================================================
-- M4: Missing affiliate tables — tiers, settings, referrals,
--     referral_clicks, payout_requests, stored procedures
-- ============================================================

-- 1. AFFILIATE TIERS (4-tier: Bronze/Silver/Gold/Platinum)
CREATE TABLE IF NOT EXISTS public.affiliate_tiers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  level INTEGER NOT NULL,
  min_orders INTEGER NOT NULL DEFAULT 0,
  min_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
  commission_rate DECIMAL(4,4) NOT NULL,
  bonus_rate DECIMAL(4,4) NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. AFFILIATE SETTINGS
CREATE TABLE IF NOT EXISTS public.affiliate_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. REFERRALS (for last-touch attribution tracking)
CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID REFERENCES public.affiliates(id) ON DELETE CASCADE,
  referred_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','converted','expired')),
  converted_at TIMESTAMPTZ,
  first_order_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(referred_user_id)
);

-- 4. REFERRAL CLICKS (analytics)
CREATE TABLE IF NOT EXISTS public.referral_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID REFERENCES public.affiliates(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  page_url TEXT,
  converted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. PAYOUT REQUESTS (affiliate-initiated)
CREATE TABLE IF NOT EXISTS public.payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID REFERENCES public.affiliates(id) ON DELETE CASCADE,
  amount DECIMAL(12,2) NOT NULL,
  mpesa_number TEXT NOT NULL,
  mpesa_name TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')),
  payable_after TIMESTAMPTZ, -- when min threshold is met
  processed_at TIMESTAMPTZ,
  processed_by UUID REFERENCES auth.users(id),
  admin_notes TEXT,
  paystack_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. INDEXES
CREATE INDEX IF NOT EXISTS idx_referrals_affiliate ON public.referrals(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_referrals_user ON public.referrals(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON public.referrals(status);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_affiliate ON public.referral_clicks(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_payout_requests_affiliate ON public.payout_requests(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON public.payout_requests(status);

-- 7. SEED TIERS (4 tiers: Bronze/Silver/Gold/Platinum)
INSERT INTO public.affiliate_tiers (name, level, min_orders, min_sales, commission_rate, bonus_rate, description)
VALUES
  ('Bronze', 1, 0, 0, 0.0300, 0, 'Entry tier — 3% commission'),
  ('Silver', 2, 5, 50000, 0.0500, 0.0050, '5+ orders, 50K KES sales — 5% commission + 0.5% bonus'),
  ('Gold', 3, 20, 250000, 0.0800, 0.0100, '20+ orders, 250K KES sales — 8% commission + 1% bonus'),
  ('Platinum', 4, 50, 1000000, 0.1200, 0.0200, '50+ orders, 1M KES sales — 12% commission + 2% bonus')
ON CONFLICT (name) DO NOTHING;

-- 8. SEED SETTINGS
INSERT INTO public.affiliate_settings (key, value, description)
VALUES
  ('min_payout', '2000', 'Minimum payout threshold in KES'),
  ('referral_reward_type', '"points"', 'Reward type: points or cash'),
  ('referral_reward_value', '1', 'Default referral reward value'),
  ('commission_period', '"monthly"', 'Commission calculation period'),
  ('attribution_model', '"last_touch"', 'Attribution model for referrals'),
  ('cookie_expiry_days', '30', 'Referral cookie expiration in days'),
  ('cookie_consent_required', 'true', 'Whether cookie consent is required'),
  ('mpesa_b2c_active', 'false', 'Whether M-Pesa B2C payouts are active'),
  ('tier_upgrade_frequency', '"monthly"', 'How often tiers are recalculated'),
  ('max_payout_attempts', '3', 'Maximum payout retry attempts'),
  ('default_affiliate_role', '"affiliate"', 'Default role assigned to new affiliates'),
  ('admin_email', '"admin@omixsystems.store"', 'Admin notification email'),
  ('payout_methods', '["mpesa_b2c"]', 'Available payout methods'),
  ('auto_calculate_enabled', 'true', 'Auto-calculate commissions on schedule'),
  ('referral_cookie_name', '"omix_ref"', 'Cookie name for referral tracking')
ON CONFLICT (key) DO NOTHING;

-- 9. STORED PROCEDURE: Get or create affiliate tier for a given affiliate
CREATE OR REPLACE FUNCTION public.calculate_affiliate_tier(p_affiliate_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_total_orders INTEGER;
  v_total_sales DECIMAL(12,2);
  v_tier_id INTEGER;
BEGIN
  -- Count total paid orders from referred users
  SELECT COUNT(DISTINCT o.id), COALESCE(SUM(o.total_amount), 0)
  INTO v_total_orders, v_total_sales
  FROM public.referrals r
  JOIN public.omix_orders o ON o.user_id = r.referred_user_id AND o.status IN ('paid', 'completed', 'delivered')
  WHERE r.affiliate_id = p_affiliate_id;

  -- Find highest qualifying tier
  SELECT id INTO v_tier_id FROM public.affiliate_tiers
  WHERE v_total_orders >= min_orders AND v_total_sales >= min_sales
  ORDER BY level DESC
  LIMIT 1;

  RETURN COALESCE(v_tier_id, (SELECT id FROM public.affiliate_tiers WHERE level = 1));
END;
$$ LANGUAGE plpgsql;

-- 10. STORED PROCEDURE: Calculate monthly commission for one affiliate
CREATE OR REPLACE FUNCTION public.calculate_monthly_commission(
  p_affiliate_id UUID,
  p_year INTEGER,
  p_month INTEGER
)
RETURNS UUID AS $$
DECLARE
  v_tier_id INTEGER;
  v_rate DECIMAL(4,4);
  v_bonus_rate DECIMAL(4,4);
  v_user_ids UUID[];
  v_total_sales DECIMAL(12,2);
  v_order_count INTEGER;
  v_commission_amount DECIMAL(12,2);
  v_commission_id UUID;
BEGIN
  -- Get tier
  v_tier_id := public.calculate_affiliate_tier(p_affiliate_id);
  SELECT commission_rate, bonus_rate INTO v_rate, v_bonus_rate
  FROM public.affiliate_tiers WHERE id = v_tier_id;

  -- Get referred users with converted status
  SELECT array_agg(referred_user_id) INTO v_user_ids
  FROM public.referrals
  WHERE affiliate_id = p_affiliate_id AND status = 'converted';

  IF v_user_ids IS NULL OR array_length(v_user_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  -- Sum qualifying orders in month
  SELECT COALESCE(SUM(o.total_amount), 0), COUNT(DISTINCT o.id)
  INTO v_total_sales, v_order_count
  FROM public.omix_orders o
  WHERE o.user_id = ANY(v_user_ids)
    AND o.status IN ('paid', 'completed', 'delivered')
    AND o.created_at >= make_date(p_year, p_month, 1)
    AND o.created_at < make_date(p_year, p_month, 1) + interval '1 month';

  IF v_order_count = 0 THEN
    RETURN NULL;
  END IF;

  v_commission_amount := v_total_sales * (v_rate + v_bonus_rate);

  -- Upsert commission
  INSERT INTO public.monthly_commissions
    (affiliate_id, year, month, total_sales, qualified_order_count, commission_rate, commission_amount, status)
  VALUES
    (p_affiliate_id, p_year, p_month, v_total_sales, v_order_count, v_rate + v_bonus_rate, v_commission_amount, 'calculated')
  ON CONFLICT (affiliate_id, year, month)
  DO UPDATE SET
    total_sales = EXCLUDED.total_sales,
    qualified_order_count = EXCLUDED.qualified_order_count,
    commission_rate = EXCLUDED.commission_rate,
    commission_amount = EXCLUDED.commission_amount,
    status = 'calculated'
  RETURNING id INTO v_commission_id;

  -- Insert order details
  DELETE FROM public.commission_order_details WHERE commission_id = v_commission_id;
  INSERT INTO public.commission_order_details (commission_id, order_id, order_amount)
  SELECT v_commission_id, o.id, o.total_amount
  FROM public.omix_orders o
  WHERE o.user_id = ANY(v_user_ids)
    AND o.status IN ('paid', 'completed', 'delivered')
    AND o.created_at >= make_date(p_year, p_month, 1)
    AND o.created_at < make_date(p_year, p_month, 1) + interval '1 month';

  RETURN v_commission_id;
END;
$$ LANGUAGE plpgsql;
