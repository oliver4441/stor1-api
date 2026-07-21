-- ============================================================
-- M6: Fraud protection — IP tracking, activity logs
-- ============================================================

-- 1. Add signup_ip to profiles for IP-based duplicate detection
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS signup_ip TEXT;

-- 2. Add referred_ip to referrals for per-affiliate IP duplicate check
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS referred_ip TEXT;

-- 3. Create activity_logs table for audit trail
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

CREATE INDEX IF NOT EXISTS idx_activity_logs_actor ON public.activity_logs(actor);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON public.activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON public.activity_logs(created_at DESC);

-- 4. Index for IP-based lookup on profiles
CREATE INDEX IF NOT EXISTS idx_profiles_signup_ip ON public.profiles(signup_ip);

-- 5. Index for referral IP + affiliate lookup
CREATE INDEX IF NOT EXISTS idx_referrals_affiliate_ip ON public.referrals(affiliate_id, referred_ip);
