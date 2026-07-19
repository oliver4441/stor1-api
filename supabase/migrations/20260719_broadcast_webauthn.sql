-- Migration: Broadcast settings + WebAuthn (biometric) credentials
-- Run in Supabase SQL Editor OR via POST /api/admin/apply-migrations

-- ============================================================
-- 1. SITE SETTINGS (key/value for broadcast toggle + defaults)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.site_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage site_settings" ON public.site_settings;
CREATE POLICY "Admins can manage site_settings"
  ON public.site_settings FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Anyone can read site_settings" ON public.site_settings;
CREATE POLICY "Anyone can read site_settings"
  ON public.site_settings FOR SELECT USING (true);

-- Seed broadcast settings (master switch + default channels)
INSERT INTO public.site_settings (key, value)
VALUES ('broadcast', '{"enabled": true, "default_email": true, "default_push": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. WEBAUTHN CREDENTIALS (biometric / passkey login)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webauthn_user_id ON public.webauthn_credentials(user_id);

ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own webauthn credentials" ON public.webauthn_credentials;
CREATE POLICY "Users manage own webauthn credentials"
  ON public.webauthn_credentials FOR ALL
  USING (auth.uid() = user_id);

-- Short-lived challenge store (passkey register/login)
CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own webauthn challenges" ON public.webauthn_challenges;
CREATE POLICY "Users manage own webauthn challenges"
  ON public.webauthn_challenges FOR ALL
  USING (auth.uid() = user_id);

-- ============================================================
-- 3. GRANTS
-- ============================================================
GRANT ALL ON public.site_settings TO anon, authenticated, service_role;
GRANT ALL ON public.webauthn_credentials TO anon, authenticated, service_role;
