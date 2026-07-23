-- ============================================================
-- Fix: Add missing columns that cause silent referral/click failures
-- ============================================================

-- 1. Add `tier` column to affiliates (referenced by many SELECTs)
ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'silver';

-- 2. Add referred_ip to referrals for per-affiliate IP duplicate check
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS referred_ip TEXT;

-- 3. Add signup_ip to profiles for IP-based duplicate detection
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS signup_ip TEXT;

-- 4. Create activity_logs table for audit trail if not exists
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor ON public.activity_logs(actor);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON public.activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_signup_ip ON public.profiles(signup_ip);
CREATE INDEX IF NOT EXISTS idx_referrals_affiliate_ip ON public.referrals(affiliate_id, referred_ip);
