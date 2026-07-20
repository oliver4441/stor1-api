-- ============================================================
-- M5: Affiliate fixes — missing tables, tier alignment, settings
-- ============================================================

-- 1. MONTHLY COMMISSIONS — referenced by stored proc but never created
CREATE TABLE IF NOT EXISTS public.monthly_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  total_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
  qualified_order_count INTEGER NOT NULL DEFAULT 0,
  commission_rate DECIMAL(4,4) NOT NULL DEFAULT 0,
  commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'calculated' CHECK (status IN ('calculated','approved','paid')),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  paid_at TIMESTAMPTZ,
  paystack_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(affiliate_id, year, month)
);

-- 2. COMMISSION ORDER DETAILS — line items per commission
CREATE TABLE IF NOT EXISTS public.commission_order_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_id UUID NOT NULL REFERENCES public.monthly_commissions(id) ON DELETE CASCADE,
  order_id UUID NOT NULL,
  order_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_details_commission ON public.commission_order_details(commission_id);
CREATE INDEX IF NOT EXISTS idx_monthly_commissions_affiliate ON public.monthly_commissions(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_monthly_commissions_status ON public.monthly_commissions(status);
CREATE INDEX IF NOT EXISTS idx_monthly_commissions_period ON public.monthly_commissions(year, month);

-- 3. RESEED TIERS TO MATCH LEGAL AGREEMENT (2-tier: Silver 5%, Gold 10%)
-- Legal docs state: Silver = 5% (0-29 orders), Gold = 10% (30+ orders)
DELETE FROM public.affiliate_tiers;
INSERT INTO public.affiliate_tiers (name, level, min_orders, min_sales, commission_rate, bonus_rate, description)
VALUES
  ('Silver', 1, 0,  0,     0.0500, 0, '0-29 orders — 5% commission'),
  ('Gold',   2, 30, 0,     0.1000, 0, '30+ orders — 10% commission')
ON CONFLICT (name) DO NOTHING;

-- 4. FIX SETTINGS TO MATCH LEGAL AGREEMENT
UPDATE public.affiliate_settings
SET value = '"first_touch"', updated_at = now()
WHERE key = 'attribution_model';

UPDATE public.affiliate_settings
SET value = '36500', updated_at = now()
WHERE key = 'cookie_expiry_days';

UPDATE public.affiliate_settings
SET value = 'false', updated_at = now()
WHERE key = 'cookie_consent_required';

-- 5. UPDATE STORED PROC: monthly commission still works, now with corrected tier rates
-- (no proc changes needed — it reads rates from affiliate_tiers dynamically)
-- ============================================================
