-- ============================================================
-- Backfill: Retroactively attribute referrals for signups that
-- occurred before the PostgrestFilterBuilder .catch() fix was
-- deployed (Jul 23, 2026). Those signups created auth users
-- and profiles but crashed before creating referral records.
--
-- Strategy: Match profiles.signup_ip against the X-Forwarded-For
-- IP recorded in referral_clicks. If a user signed up from the
-- same IP that previously clicked an affiliate's referral link,
-- that user is attributed to that affiliate.
--
-- IMPORTANT: This is a best-effort backfill. IP matching is
-- imperfect (NAT, shared IPs, VPNs). Run this query in the
-- Supabase SQL Editor. It is idempotent — safe to run multiple
-- times.
-- ============================================================

-- Step 1: Create referral records for users whose signup_ip
-- matches a referral_clicks.ip_address (partial match against
-- the first X-Forwarded-For IP, which is the client IP).
--
-- We match only the first comma-separated IP from the click
-- record (the actual client IP before reverse-proxy entries).
-- Uses split_part to extract it.
INSERT INTO public.referrals (
  affiliate_id,
  referred_user_id,
  referral_code,
  status,
  referred_ip,
  created_at
)
SELECT DISTINCT ON (p.id)
  rc.affiliate_id,
  p.id AS referred_user_id,
  rc.referral_code,
  'pending' AS status,
  p.signup_ip AS referred_ip,
  COALESCE(p.created_at, NOW()) AS created_at
FROM public.profiles p
JOIN public.referral_clicks rc
  ON p.signup_ip IS NOT NULL
  AND rc.ip_address IS NOT NULL
  -- Match the first (client) IP from the comma-separated list
  AND POSITION(split_part(rc.ip_address, ',', 1) IN p.signup_ip) > 0
  OR POSITION(p.signup_ip IN split_part(rc.ip_address, ',', 1)) > 0
WHERE p.id NOT IN (
  SELECT referred_user_id FROM public.referrals WHERE referred_user_id IS NOT NULL
)
AND rc.affiliate_id IS NOT NULL
AND p.id != (SELECT aff.user_id FROM public.affiliates aff WHERE aff.id = rc.affiliate_id)
ON CONFLICT (referred_user_id) DO NOTHING;

-- Step 2: For newly-attributed referrals who already have
-- paid/delivered orders, mark them as converted.
UPDATE public.referrals r
SET
  status = 'converted',
  converted_at = o.first_paid_at,
  first_order_id = o.first_order_id
FROM (
  SELECT
    r2.id AS referral_id,
    MIN(o.created_at) AS first_paid_at,
    (array_agg(o.id ORDER BY o.created_at))[1] AS first_order_id
  FROM public.referrals r2
  JOIN public.omix_orders o ON o.user_id = r2.referred_user_id
  WHERE r2.status = 'pending'
    AND o.status IN ('paid', 'completed', 'delivered', 'processing', 'shipped')
  GROUP BY r2.id
) o
WHERE r.id = o.referral_id;

-- Step 3: Log what was done for audit trail (only if
-- activity_logs table exists)
INSERT INTO public.activity_logs (actor, action, details, created_at)
SELECT
  'system',
  'backfill_referrals',
  jsonb_build_object(
    'referrals_created', (SELECT COUNT(*) FROM public.referrals WHERE created_at > NOW() - interval '1 minute'),
    'referrals_converted', (SELECT COUNT(*) FROM public.referrals WHERE converted_at > NOW() - interval '1 minute' AND status = 'converted')
  )::text,
  NOW()
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables WHERE table_name = 'activity_logs'
);

-- Summary
SELECT
  'Backfill complete' AS message,
  (SELECT COUNT(*) FROM public.referrals WHERE created_at > NOW() - interval '1 minute') AS referrals_created,
  (SELECT COUNT(*) FROM public.referrals WHERE converted_at > NOW() - interval '1 minute' AND status = 'converted') AS referrals_converted;
