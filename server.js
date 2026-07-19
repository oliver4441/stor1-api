// Omix Paystack API Server
// Handles Paystack inline payment initialization, verification, webhook, and split payments
// Deploy to Render/Railway/Fly.io as a separate service

import 'dotenv/config';
import 'express-async-errors';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fetch from 'node-fetch';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { InferenceClient } from '@huggingface/inference';
import emailLib from './lib/email.js';
import rateLimit from 'express-rate-limit';
import { body, param, validationResult } from 'express-validator';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import * as meiliSearch from './lib/meilisearch.js';

const app = express();
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: [
    'https://stor1-web.onrender.com',
    'https://www.omixstore.co.ke',
    'https://omixsystems.store',
    'https://market.omixsystems.store',
    'http://localhost:5173',
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
}));

// ── Rate Limiting ──
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per window
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Stricter limit for auth routes (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 attempts per 15 min per IP
  message: { error: 'Too many login attempts, please try again later.' }
});
app.use('/api/auth/', authLimiter);

app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// ── XSS Protection: strip HTML tags from request bodies ──
function sanitize(obj) {
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      obj[key] = obj[key].replace(/<[^>]*>/g, '');
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      sanitize(obj[key]);
    }
  }
}
app.use((req, res, next) => {
  if (req.body) sanitize(req.body);
  next();
});

// Static assets are served by the frontend service (stor1-web)
// API-only: no static file serving

// Warn if CRON_SECRET not set (commission calculation cron requires it)
if (!process.env.CRON_SECRET) {
  console.warn('CRON_SECRET not set — /api/admin/commissions/calculate requires env var to work via HTTP');
}

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC = process.env.PAYSTACK_PUBLIC_KEY;
const OMIX_SUBACCOUNT_CODE = process.env.OMIX_SUBACCOUNT_CODE;
const PORT = process.env.PORT || 3001;

// VAPID keys for web push
const VAPID_PUBLIC_KEY = process.env.VITE_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:admin@omix.store',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  console.log('[Push] VAPID configured, public key:', VAPID_PUBLIC_KEY.substring(0, 20) + '...');
} else {
  console.warn('[Push] VAPID keys not set — push sending disabled');
}

// Supabase client for maintenance mode checks
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  try {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  } catch (err) {
    console.warn('Failed to initialize Supabase client:', err.message);
    supabase = null;
  }
}

// ── Startup Migrations ──
// Runs DDL migrations at startup using supabase.rpc('exec_sql', ...)
// Requires the public.exec_sql() function to exist in the database.
(async function runMigrations() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return;

  // Wait briefly for the Supabase client to initialize
  await new Promise(r => setTimeout(r, 100));

  async function runSql(description, query) {
    if (!supabase) {
      console.warn(`[Migration] ${description} skipped: supabase client not initialized`);
      return false;
    }
    try {
      const { error } = await supabase.rpc('exec_sql', { sql: query });
      if (error) {
        console.warn(`[Migration] ${description} failed: ${error.message}`);
        return false;
      }
      console.log(`[Migration] ${description} OK`);
      return true;
    } catch (err) {
      console.warn(`[Migration] ${description} error:`, err.message);
      return false;
    }
  }

  // M1: payment_method column
  await runSql(
    'payment_method column',
    `ALTER TABLE omix_orders ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'pending';`
  );

  // M2: Affiliate system foundation
  await runSql(
    'affiliates table',
    `CREATE TABLE IF NOT EXISTS public.affiliates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      mpesa_number TEXT,
      referral_code TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );`
  );

  await runSql(
    'affiliate_logs table',
    `CREATE TABLE IF NOT EXISTS public.affiliate_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      affiliate_id UUID REFERENCES public.affiliates(id),
      event_type TEXT NOT NULL,
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );`
  );

  await runSql(
    'profiles.referred_by column',
    `ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.affiliates(id);`
  );

  await runSql(
    'affiliate indexes',
    `CREATE INDEX IF NOT EXISTS idx_profiles_referred_by ON public.profiles(referred_by);
     CREATE INDEX IF NOT EXISTS idx_affiliates_ref_code ON public.affiliates(referral_code);`
  );

  await runSql(
    'updated_at trigger function',
    `CREATE OR REPLACE FUNCTION public.update_modified_column()
     RETURNS TRIGGER AS $$
     BEGIN NEW.updated_at = now(); RETURN NEW; END;
     $$ LANGUAGE plpgsql;`
  );

  await runSql(
    'affiliates updated_at trigger',
    `DROP TRIGGER IF EXISTS update_affiliates_modtime ON public.affiliates;
     CREATE TRIGGER update_affiliates_modtime BEFORE UPDATE ON public.affiliates
     FOR EACH ROW EXECUTE PROCEDURE public.update_modified_column();`
  );

  // M3: Monthly commissions & order details
  await runSql(
    'monthly_commissions table',
    `CREATE TABLE IF NOT EXISTS public.monthly_commissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      affiliate_id UUID REFERENCES public.affiliates(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      total_sales DECIMAL(12, 2) DEFAULT 0,
      qualified_order_count INTEGER DEFAULT 0,
      commission_rate DECIMAL(4, 4) NOT NULL,
      commission_amount DECIMAL(12, 2) DEFAULT 0,
      status TEXT DEFAULT 'calculated' CHECK (status IN ('calculated', 'approved', 'paid', 'cancelled')),
      approved_at TIMESTAMPTZ,
      approved_by UUID REFERENCES auth.users(id),
      paid_at TIMESTAMPTZ,
      paystack_reference TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(affiliate_id, year, month)
    );`
  );

  await runSql(
    'commission_order_details table',
    `CREATE TABLE IF NOT EXISTS public.commission_order_details (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      commission_id UUID REFERENCES public.monthly_commissions(id) ON DELETE CASCADE,
      order_id UUID REFERENCES public.omix_orders(id),
      order_amount DECIMAL(12, 2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    );`
  );

  await runSql(
    'commission indexes',
    `CREATE INDEX IF NOT EXISTS idx_monthly_commissions_affiliate ON public.monthly_commissions(affiliate_id);
     CREATE INDEX IF NOT EXISTS idx_monthly_commissions_status ON public.monthly_commissions(status);
     CREATE INDEX IF NOT EXISTS idx_commission_order_details_commission ON public.commission_order_details(commission_id);`
  );

  await runSql(
    'monthly_commissions updated_at trigger',
    `DROP TRIGGER IF EXISTS update_monthly_commissions_modtime ON public.monthly_commissions;
     CREATE TRIGGER update_monthly_commissions_modtime BEFORE UPDATE ON public.monthly_commissions
     FOR EACH ROW EXECUTE PROCEDURE public.update_modified_column();`
  );

  // M4: Missing affiliate tables
  await runSql(
    'affiliate_tiers table',
    `CREATE TABLE IF NOT EXISTS public.affiliate_tiers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      level INTEGER NOT NULL,
      min_orders INTEGER NOT NULL DEFAULT 0,
      min_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
      commission_rate DECIMAL(4,4) NOT NULL,
      bonus_rate DECIMAL(4,4) NOT NULL DEFAULT 0,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );`
  );

  await runSql(
    'affiliate_settings table',
    `CREATE TABLE IF NOT EXISTS public.affiliate_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      description TEXT,
      updated_at TIMESTAMPTZ DEFAULT now()
    );`
  );

  await runSql(
    'referrals table',
    `CREATE TABLE IF NOT EXISTS public.referrals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      affiliate_id UUID REFERENCES public.affiliates(id) ON DELETE CASCADE,
      referred_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      referral_code TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','converted','expired')),
      converted_at TIMESTAMPTZ,
      first_order_id UUID,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(referred_user_id)
    );`
  );

  await runSql(
    'referral_clicks table',
    `CREATE TABLE IF NOT EXISTS public.referral_clicks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      affiliate_id UUID REFERENCES public.affiliates(id) ON DELETE CASCADE,
      referral_code TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      page_url TEXT,
      converted BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );`
  );

  await runSql(
    'payout_requests table',
    `CREATE TABLE IF NOT EXISTS public.payout_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      affiliate_id UUID REFERENCES public.affiliates(id) ON DELETE CASCADE,
      amount DECIMAL(12,2) NOT NULL,
      mpesa_number TEXT NOT NULL,
      mpesa_name TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')),
      payable_after TIMESTAMPTZ,
      processed_at TIMESTAMPTZ,
      processed_by UUID REFERENCES auth.users(id),
      admin_notes TEXT,
      paystack_reference TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );`
  );

  await runSql(
    'referral & payout indexes',
    `CREATE INDEX IF NOT EXISTS idx_referrals_affiliate ON public.referrals(affiliate_id);
     CREATE INDEX IF NOT EXISTS idx_referrals_user ON public.referrals(referred_user_id);
     CREATE INDEX IF NOT EXISTS idx_referrals_status ON public.referrals(status);
     CREATE INDEX IF NOT EXISTS idx_referral_clicks_affiliate ON public.referral_clicks(affiliate_id);
     CREATE INDEX IF NOT EXISTS idx_payout_requests_affiliate ON public.payout_requests(affiliate_id);
     CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON public.payout_requests(status);`
  );

  // M4.5: Fix missing referral_clicks columns (table was created without these)
  // and reload PostgREST schema cache so new columns are visible
  await runSql(
    'referral_clicks missing columns',
    `ALTER TABLE public.referral_clicks ADD COLUMN IF NOT EXISTS converted BOOLEAN DEFAULT false;
     ALTER TABLE public.referral_clicks ADD COLUMN IF NOT EXISTS ip_address TEXT;
     ALTER TABLE public.referral_clicks ADD COLUMN IF NOT EXISTS page_url TEXT;
     ALTER TABLE public.referral_clicks ADD COLUMN IF NOT EXISTS referral_code TEXT;
     ALTER TABLE public.referral_clicks ADD COLUMN IF NOT EXISTS user_agent TEXT;
     NOTIFY pgrst, 'reload schema';`
  );

  await runSql(
    'seed affiliate tiers (spec alignment)',
    `DELETE FROM public.affiliate_tiers;
     INSERT INTO public.affiliate_tiers (name, level, min_orders, min_sales, commission_rate, bonus_rate, description)
     VALUES
       ('Silver', 1, 0, 0, 0.0500, 0, '0-29 qualified sales - 5% commission'),
       ('Gold', 2, 30, 0, 0.1000, 0, '30+ qualified sales - 10% commission (maximum)')
     ON CONFLICT (name) DO NOTHING;`
  );

  await runSql(
    'seed affiliate settings (spec alignment)',
    `DELETE FROM public.affiliate_settings WHERE key IN ('attribution_model', 'cookie_expiry_days', 'referral_reward_type', 'referral_reward_value');
     INSERT INTO public.affiliate_settings (key, value, description)
     VALUES
       ('min_payout', '"2000"', 'Minimum payout threshold in KES'),
       ('commission_period', '"monthly"', 'Commission calculation period'),
       ('attribution_model', '"first_touch"', 'First attribution always wins — never overwritten'),
       ('cookie_expiry_days', '"36525"', 'Permanent cookie (100 years) — spec says never expires'),
       ('cookie_consent_required', '"false"', 'Cookie consent not required for affiliate tracking'),
       ('mpesa_b2c_active', '"true"', 'M-Pesa B2C payouts active'),
       ('tier_upgrade_frequency', '"yearly"', 'Tiers recalculated yearly per spec'),
       ('max_payout_attempts', '"3"', 'Maximum payout retry attempts'),
       ('auto_calculate_enabled', '"true"', 'Auto-calculate commissions on schedule'),
       ('referral_cookie_name', '"omix_ref"', 'Cookie name for referral tracking')
     ON CONFLICT (key) DO NOTHING;`
  );

  await runSql(
    'calculate_affiliate_tier function',
    `CREATE OR REPLACE FUNCTION public.calculate_affiliate_tier(p_affiliate_id UUID)
     RETURNS INTEGER AS $func$
     DECLARE
       v_total_orders INTEGER;
       v_total_sales DECIMAL(12,2);
       v_tier_id INTEGER;
     BEGIN
       SELECT COUNT(DISTINCT o.id), COALESCE(SUM(o.total_amount), 0)
       INTO v_total_orders, v_total_sales
       FROM public.referrals r
       JOIN public.omix_orders o ON o.user_id = r.referred_user_id AND o.status IN ('paid','completed','delivered')
       WHERE r.affiliate_id = p_affiliate_id;
       SELECT id INTO v_tier_id FROM public.affiliate_tiers
       WHERE v_total_orders >= min_orders AND v_total_sales >= min_sales
       ORDER BY level DESC LIMIT 1;
       RETURN COALESCE(v_tier_id, (SELECT id FROM public.affiliate_tiers WHERE level = 1));
     END;
     $func$ LANGUAGE plpgsql;`
  );

  await runSql(
    'calculate_monthly_commission function',
    `CREATE OR REPLACE FUNCTION public.calculate_monthly_commission(
       p_affiliate_id UUID, p_year INTEGER, p_month INTEGER
     )
     RETURNS UUID AS $func$
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
       v_tier_id := public.calculate_affiliate_tier(p_affiliate_id);
       SELECT commission_rate, bonus_rate INTO v_rate, v_bonus_rate
       FROM public.affiliate_tiers WHERE id = v_tier_id;
       SELECT array_agg(referred_user_id) INTO v_user_ids
       FROM public.referrals
       WHERE affiliate_id = p_affiliate_id AND status = 'converted';
       IF v_user_ids IS NULL OR array_length(v_user_ids, 1) = 0 THEN
         RETURN NULL;
       END IF;
       SELECT COALESCE(SUM(o.total_amount), 0), COUNT(DISTINCT o.id)
       INTO v_total_sales, v_order_count
       FROM public.omix_orders o
       WHERE o.user_id = ANY(v_user_ids)
         AND o.status IN ('paid','completed','delivered')
         AND o.created_at >= make_date(p_year, p_month, 1)
         AND o.created_at < make_date(p_year, p_month, 1) + interval '1 month';
       IF v_order_count = 0 THEN RETURN NULL; END IF;
       v_commission_amount := v_total_sales * (v_rate + v_bonus_rate);
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
       DELETE FROM public.commission_order_details WHERE commission_id = v_commission_id;
       INSERT INTO public.commission_order_details (commission_id, order_id, order_amount)
       SELECT v_commission_id, o.id, o.total_amount
       FROM public.omix_orders o
       WHERE o.user_id = ANY(v_user_ids)
         AND o.status IN ('paid','completed','delivered')
         AND o.created_at >= make_date(p_year, p_month, 1)
         AND o.created_at < make_date(p_year, p_month, 1) + interval '1 month';
       RETURN v_commission_id;
     END;
     $func$ LANGUAGE plpgsql;`
  );

  // Auto-convert referral on qualifying order
  await runSql(
    'referral conversion trigger',
    `CREATE OR REPLACE FUNCTION public.convert_referral_on_order()
     RETURNS TRIGGER AS $func$
     BEGIN
       IF NEW.status IN ('paid','completed','delivered') THEN
         UPDATE public.referrals
         SET status = 'converted',
             converted_at = COALESCE(NEW.paid_at, NOW()),
             first_order_id = CASE WHEN first_order_id IS NULL THEN NEW.id ELSE first_order_id END
         WHERE referred_user_id = NEW.user_id
           AND status = 'pending'
           AND first_order_id IS NULL;
       END IF;
       RETURN NEW;
     END;
     $func$ LANGUAGE plpgsql SECURITY DEFINER;
     DROP TRIGGER IF EXISTS trg_convert_referral_on_order ON public.omix_orders;
     CREATE TRIGGER trg_convert_referral_on_order
       AFTER INSERT OR UPDATE OF status ON public.omix_orders
       FOR EACH ROW
       EXECUTE FUNCTION public.convert_referral_on_order();`
  );

  // M5: Self-signup support — allow 'pending' status for affiliate self-application
  await runSql(
    'M5: affiliates status + pending columns',
    `ALTER TABLE public.affiliates DROP CONSTRAINT IF EXISTS affiliates_status_check;
     ALTER TABLE public.affiliates ADD CONSTRAINT affiliates_status_check CHECK (status IN ('active', 'inactive'));
     ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
     ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
     ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS notes TEXT;`
  );

  // M6: Spec alignment — commission lifecycle, yearly tiers, payout columns
  await runSql(
    'M6: monthly_commissions status lifecycle',
    `ALTER TABLE public.monthly_commissions DROP CONSTRAINT IF EXISTS monthly_commissions_status_check;
     ALTER TABLE public.monthly_commissions ADD CONSTRAINT monthly_commissions_status_check
       CHECK (status IN ('pending', 'calculated', 'approved', 'paid', 'cancelled'));`
  );

  await runSql(
    'M6: yearly tier calculation function',
    `CREATE OR REPLACE FUNCTION public.calculate_affiliate_tier(p_affiliate_id UUID)
     RETURNS INTEGER AS $func$
     DECLARE
       v_total_orders INTEGER;
       v_current_year INTEGER := EXTRACT(YEAR FROM NOW());
       v_tier_id INTEGER;
     BEGIN
       SELECT COUNT(DISTINCT o.id)
       INTO v_total_orders
       FROM public.referrals r
       JOIN public.omix_orders o ON o.user_id = r.referred_user_id AND o.status IN ('paid','completed','delivered')
       WHERE r.affiliate_id = p_affiliate_id
         AND EXTRACT(YEAR FROM o.created_at) = v_current_year;
       SELECT id INTO v_tier_id FROM public.affiliate_tiers
       WHERE v_total_orders >= min_orders
       ORDER BY level DESC LIMIT 1;
       RETURN COALESCE(v_tier_id, (SELECT id FROM public.affiliate_tiers WHERE level = 1));
     END;
     $func$ LANGUAGE plpgsql;`
  );

  await runSql(
    'M6: payout_requests approved_at/approved_by columns',
    `ALTER TABLE public.payout_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
     ALTER TABLE public.payout_requests ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;`
  );

  // M7: Self-apply support — allow pending/revoked status + application form columns
  await runSql(
    'M7: affiliates status constraint update',
    `ALTER TABLE public.affiliates DROP CONSTRAINT IF EXISTS affiliates_status_check;
     ALTER TABLE public.affiliates ADD CONSTRAINT affiliates_status_check
       CHECK (status IN ('pending', 'active', 'inactive', 'revoked', 'terminated'));`
  );

  await runSql(
    'M7: affiliates application columns',
    `ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS alternative_phone TEXT;
     ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS physical_address TEXT;
     ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS id_number TEXT;
     ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS date_of_birth DATE;
     ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS mpesa_account_name TEXT;
     ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS promotional_methods JSONB DEFAULT '[]'::jsonb;
     ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS social_media_handles TEXT;
     ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS how_heard TEXT;
     ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'bronze';
     ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS tier_achieved_at TIMESTAMPTZ;`
  );

  // M8: All new e-commerce features (delivery zones, pickup stations, Q&A, wholesale, sellers, returns, rating cache)

  // Pre-M8: Deduplicate pickup_stations before adding unique constraint
  // Must first re-link any orders referencing duplicate stations, then delete, then add constraint
  await runSql(
    'M8-pre: deduplicate pickup_stations',
    `WITH keep_ids AS (
       SELECT MIN(id) AS id, name, area
       FROM public.pickup_stations
       GROUP BY name, area
     ),
     delete_ids AS (
       SELECT p.id FROM public.pickup_stations p
       WHERE NOT EXISTS (SELECT 1 FROM keep_ids k WHERE k.id = p.id)
     )
     UPDATE public.omix_orders o
     SET pickup_station_id = k.id
     FROM keep_ids k, delete_ids d, public.pickup_stations ps
     WHERE o.pickup_station_id = d.id
       AND ps.id = o.pickup_station_id
       AND ps.name = k.name AND ps.area = k.area;

     DELETE FROM public.pickup_stations p
     WHERE EXISTS (SELECT 1 FROM delete_ids d WHERE d.id = p.id);`
  );

  await runSql(
    'M8: delivery_zones table',
    `CREATE TABLE IF NOT EXISTS public.delivery_zones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      estimated_days_min INTEGER NOT NULL DEFAULT 1,
      estimated_days_max INTEGER NOT NULL DEFAULT 3,
      delivery_fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
      free_delivery_threshold DECIMAL(10, 2) DEFAULT NULL,
      is_active BOOLEAN DEFAULT true,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO public.delivery_zones (zone_name, display_name, estimated_days_min, estimated_days_max, delivery_fee, free_delivery_threshold, sort_order) VALUES
      ('kericho_cbd', 'Kericho CBD', 0, 0, 0, NULL, 1),
      ('kericho_town', 'Kericho Town', 1, 2, 0, NULL, 2),
      ('kericho_surrounding', 'Kericho Surrounding', 1, 2, 0, 2000, 3),
      ('litein', 'Litein', 1, 2, 0, 2000, 4),
      ('kipkelion', 'Kipkelion', 2, 3, 150, 2500, 5),
      ('londiani', 'Londiani', 2, 3, 150, 2500, 6),
      ('brooke', 'Brooke', 2, 3, 150, 2500, 7),
      ('sosiot', 'Sosiot', 2, 3, 150, 2500, 8),
      ('outside_kericho', 'Outside Kericho', 3, 5, 300, 5000, 9)
    ON CONFLICT (zone_name) DO NOTHING;
    ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Anyone can view delivery zones" ON public.delivery_zones;
    CREATE POLICY "Anyone can view delivery zones" ON public.delivery_zones FOR SELECT USING (true);`
  );

  await runSql(
    'M8: delivery zone/station columns on orders',
    `ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS delivery_zone_id UUID REFERENCES public.delivery_zones(id);
     ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS delivery_estimate_min INTEGER DEFAULT NULL;
     ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS delivery_estimate_max INTEGER DEFAULT NULL;
     ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS pickup_station_id UUID REFERENCES public.pickup_stations(id);
     ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS delivery_type TEXT DEFAULT 'delivery' CHECK (delivery_type IN ('delivery', 'pickup'));
     ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS delivery_fee DECIMAL(10, 2) DEFAULT 0;`
  );

  await runSql(
    'M8: pickup_stations table',
    `CREATE TABLE IF NOT EXISTS public.pickup_stations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      area TEXT NOT NULL,
      address TEXT, landmark TEXT,
      latitude DECIMAL(10, 7) DEFAULT NULL, longitude DECIMAL(10, 7) DEFAULT NULL,
      operating_hours TEXT DEFAULT 'Mon-Sat 8AM-6PM',
      contact_phone TEXT DEFAULT NULL,
      is_active BOOLEAN DEFAULT true,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE public.pickup_stations DROP CONSTRAINT IF EXISTS pickup_stations_name_area_key;
    ALTER TABLE public.pickup_stations ADD CONSTRAINT pickup_stations_name_area_key UNIQUE (name, area);
    INSERT INTO public.pickup_stations (name, area, address, landmark, latitude, longitude, operating_hours, contact_phone, sort_order) VALUES
      ('Omix Store - CBD', 'Kericho CBD', 'Kericho Town, Opposite Post Bank', 'Next to Kericho Post Office', -0.3689, 35.2839, 'Mon-Sat 8AM-7PM, Sun 9AM-4PM', '254746674392', 1),
      ('Omix Store - Litein', 'Litein', 'Litein Shopping Centre', 'Opposite Litein Market', -0.5833, 35.2000, 'Mon-Sat 8AM-6PM', '254722123456', 2),
      ('Omix Store - Brooke', 'Brooke', 'Brooke Market Area', 'Near Brooke Tea Factory', -0.3667, 35.2833, 'Mon-Sat 8AM-6PM', '254723123456', 3),
      ('Omix Store - Sosiot', 'Sosiot', 'Sosiot Town Centre', 'Next to Sosiot Stage', -0.4833, 35.2167, 'Mon-Sat 8AM-6PM', '254733123456', 4),
      ('Omix Store - Kipkelion', 'Kipkelion', 'Kipkelion Town', 'Near Kipkelion Market', -0.2000, 35.4667, 'Mon-Sat 8AM-6PM', '254740123456', 5),
      ('Omix Store - Kericho Tea Estate', 'Kericho Tea Estate', 'Tea Estate Shopping Complex, Opposite Kericho Golf Club', 'Near Kericho Golf Club', -0.3655, 35.2870, 'Mon-Sat 8AM-6:30PM, Sun 9AM-3PM', '254746674392', 6),
      ('Omix Store - Kapkatet', 'Kapkatet', 'Kapkatet Market Area, Near Kapkatet Dispensary', 'Opposite Kapkatet Dispensary', -0.4333, 35.1500, 'Mon-Sat 8AM-5:30PM', '254755123456', 7)
    ON CONFLICT (name, area) DO NOTHING;
    ALTER TABLE public.pickup_stations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Anyone can view pickup stations" ON public.pickup_stations;
    CREATE POLICY "Anyone can view pickup stations" ON public.pickup_stations FOR SELECT USING (true);`
  );

  await runSql(
    'M8: product_questions table',
    `CREATE TABLE IF NOT EXISTS public.product_questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      user_name TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT DEFAULT NULL,
      answered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      answered_at TIMESTAMPTZ DEFAULT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE public.product_questions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Anyone can view product questions" ON public.product_questions;
    CREATE POLICY "Anyone can view product questions" ON public.product_questions FOR SELECT USING (true);
    DROP POLICY IF EXISTS "Users can insert own questions" ON public.product_questions;
    CREATE POLICY "Users can insert own questions" ON public.product_questions FOR INSERT WITH CHECK (auth.uid() = user_id);
    DROP POLICY IF EXISTS "Admins can answer questions" ON public.product_questions;
    CREATE POLICY "Admins can answer questions" ON public.product_questions FOR UPDATE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
    CREATE INDEX IF NOT EXISTS idx_product_questions_listing_id ON public.product_questions(listing_id);`
  );

  await runSql(
    'M8: wholesale_prices table + listing wholesale columns',
    `CREATE TABLE IF NOT EXISTS public.wholesale_prices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
      min_quantity INTEGER NOT NULL CHECK (min_quantity > 0),
      max_quantity INTEGER DEFAULT NULL,
      unit_price DECIMAL(10, 2) NOT NULL CHECK (unit_price > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT unique_listing_tier UNIQUE (listing_id, min_quantity)
    );
    ALTER TABLE public.wholesale_prices ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Anyone can view wholesale prices" ON public.wholesale_prices;
    CREATE POLICY "Anyone can view wholesale prices" ON public.wholesale_prices FOR SELECT USING (true);
    ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS wholesale_enabled BOOLEAN DEFAULT false;
    ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS wholesale_min_qty INTEGER DEFAULT NULL;`
  );

  await runSql(
    'M8: sellers table',
    `CREATE TABLE IF NOT EXISTS public.sellers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
      shop_name TEXT NOT NULL,
      shop_slug TEXT UNIQUE NOT NULL,
      shop_description TEXT, shop_logo TEXT, shop_banner TEXT,
      phone TEXT, email TEXT, address TEXT,
      business_registration TEXT,
      commission_rate DECIMAL(4, 4) DEFAULT 0.0500,
      total_sales DECIMAL(12, 2) DEFAULT 0,
      total_orders INTEGER DEFAULT 0,
      rating DECIMAL(3, 2) DEFAULT 0,
      seller_score DECIMAL(4, 1) DEFAULT 100.0,
      is_verified BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Anyone can view sellers" ON public.sellers;
    CREATE POLICY "Anyone can view sellers" ON public.sellers FOR SELECT USING (true);
    DROP POLICY IF EXISTS "Users can register as seller" ON public.sellers;
    CREATE POLICY "Users can register as seller" ON public.sellers FOR INSERT WITH CHECK (auth.uid() = user_id);
    DROP POLICY IF EXISTS "Sellers can update own profile" ON public.sellers;
    CREATE POLICY "Sellers can update own profile" ON public.sellers FOR UPDATE USING (auth.uid() = user_id);
    ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES public.sellers(id);
    ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES public.sellers(id);`
  );

  await runSql(
    'M8: seller_payouts table',
    `CREATE TABLE IF NOT EXISTS public.seller_payouts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      seller_id UUID NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
      amount DECIMAL(12, 2) NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'cancelled')),
      period_start DATE NOT NULL, period_end DATE NOT NULL,
      paid_at TIMESTAMPTZ DEFAULT NULL, notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE public.seller_payouts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Sellers can view own payouts" ON public.seller_payouts;
    CREATE POLICY "Sellers can view own payouts" ON public.seller_payouts FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.sellers WHERE id = seller_payouts.seller_id AND user_id = auth.uid()));`
  );

  await runSql(
    'M8: return_requests table',
    `CREATE TABLE IF NOT EXISTS public.return_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES public.omix_orders(id) ON DELETE CASCADE,
      order_item_id UUID REFERENCES public.omix_order_items(id),
      user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'collected', 'refunded', 'rejected')),
      refund_amount DECIMAL(12, 2) DEFAULT NULL,
      notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE public.return_requests ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Users can view own returns" ON public.return_requests;
    CREATE POLICY "Users can view own returns" ON public.return_requests FOR SELECT
      USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
    DROP POLICY IF EXISTS "Users can create return requests" ON public.return_requests;
    CREATE POLICY "Users can create return requests" ON public.return_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
    CREATE INDEX IF NOT EXISTS idx_return_requests_order_id ON public.return_requests(order_id);`
  );

  await runSql(
    'M8: rating cache columns + trigger',
    `ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS avg_rating DECIMAL(3, 2) DEFAULT NULL;
     ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;
     CREATE OR REPLACE FUNCTION public.update_listing_rating()
     RETURNS TRIGGER AS $$
     BEGIN
       UPDATE public.listings
       SET avg_rating = (SELECT ROUND(AVG(rating::decimal), 2) FROM public.product_reviews WHERE listing_id = COALESCE(NEW.listing_id, OLD.listing_id)),
           review_count = (SELECT COUNT(*) FROM public.product_reviews WHERE listing_id = COALESCE(NEW.listing_id, OLD.listing_id))
       WHERE id = COALESCE(NEW.listing_id, OLD.listing_id);
       RETURN NULL;
     END;
     $$ LANGUAGE plpgsql SECURITY DEFINER;
     DROP TRIGGER IF EXISTS trg_update_listing_rating_insert ON public.product_reviews;
     CREATE TRIGGER trg_update_listing_rating_insert AFTER INSERT ON public.product_reviews FOR EACH ROW EXECUTE FUNCTION public.update_listing_rating();
     DROP TRIGGER IF EXISTS trg_update_listing_rating_update ON public.product_reviews;
     CREATE TRIGGER trg_update_listing_rating_update AFTER UPDATE OF rating ON public.product_reviews FOR EACH ROW EXECUTE FUNCTION public.update_listing_rating();
     DROP TRIGGER IF EXISTS trg_update_listing_rating_delete ON public.product_reviews;
     CREATE TRIGGER trg_update_listing_rating_delete AFTER DELETE ON public.product_reviews FOR EACH ROW EXECUTE FUNCTION public.update_listing_rating();
     UPDATE public.listings l SET avg_rating = (SELECT ROUND(AVG(rating::decimal), 2) FROM public.product_reviews WHERE listing_id = l.id),
       review_count = (SELECT COUNT(*) FROM public.product_reviews WHERE listing_id = l.id);`
  );

  await runSql(
    'M8: search indexes',
    `CREATE INDEX IF NOT EXISTS idx_listings_avg_rating ON public.listings(avg_rating);
     CREATE INDEX IF NOT EXISTS idx_listings_wholesale ON public.listings(wholesale_enabled) WHERE wholesale_enabled = true;
     CREATE INDEX IF NOT EXISTS idx_omix_orders_delivery_type ON public.omix_orders(delivery_type);`
  );

  await runSql(
    'M8: grant permissions',
    `GRANT ALL ON public.delivery_zones TO anon, authenticated, service_role;
     GRANT ALL ON public.pickup_stations TO anon, authenticated, service_role;
     GRANT ALL ON public.product_questions TO anon, authenticated, service_role;
     GRANT ALL ON public.wholesale_prices TO anon, authenticated, service_role;
     GRANT ALL ON public.sellers TO anon, authenticated, service_role;
     GRANT ALL ON public.seller_payouts TO anon, authenticated, service_role;
     GRANT ALL ON public.return_requests TO anon, authenticated, service_role;`
  );

  // M9: Seller approval flow — status column + review metadata
  await runSql(
    'M9: seller status + rejection_reason + reviewed_by + reviewed_at',
    `ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended'));
     ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
     ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
     ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;`
  );

  // M10: Enhanced product & order data model
  await runSql(
    'M10: listings — warranty, return policy, shipping dimensions, tags',
    `ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS warranty_period TEXT;
     ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS return_policy TEXT;
     ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS shipping_dimensions JSONB DEFAULT NULL;
     ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';`
  );

  await runSql(
    'M10: omix_orders — street, delivery_instructions, alternate_phone, order_notes, scheduled_date, id_number',
    `ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS street TEXT DEFAULT NULL;
     ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS delivery_instructions TEXT DEFAULT NULL;
     ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS alternate_phone TEXT DEFAULT NULL;
     ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS order_notes TEXT DEFAULT NULL;
     ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS scheduled_date DATE DEFAULT NULL;
     ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS id_number TEXT DEFAULT NULL;`
  );

  await runSql(
    'M10: omix_order_items — variant columns, seller_id, listing_snapshot',
    `ALTER TABLE public.omix_order_items ADD COLUMN IF NOT EXISTS variant_size TEXT DEFAULT NULL;
     ALTER TABLE public.omix_order_items ADD COLUMN IF NOT EXISTS variant_color TEXT DEFAULT NULL;
     ALTER TABLE public.omix_order_items ADD COLUMN IF NOT EXISTS variant_label TEXT DEFAULT NULL;
     ALTER TABLE public.omix_order_items ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES public.sellers(id) ON DELETE SET NULL;
     ALTER TABLE public.omix_order_items ADD COLUMN IF NOT EXISTS listing_snapshot JSONB DEFAULT NULL;`
  );

  await runSql(
    'M10: omix_orders index on new fields',
    `CREATE INDEX IF NOT EXISTS idx_omix_orders_scheduled_date ON public.omix_orders(scheduled_date);
     CREATE INDEX IF NOT EXISTS idx_omix_order_items_seller_id ON public.omix_order_items(seller_id);`
  );

  // M11: Missing columns for search filters (safe IF NOT EXISTS, independent of M8 trigger batch)
  await runSql(
    'M11: ensure search filter columns exist',
    `ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS avg_rating DECIMAL(3, 2) DEFAULT NULL;
     ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;
     ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS compare_at_price DECIMAL(12, 2) DEFAULT NULL;
     CREATE INDEX IF NOT EXISTS idx_listings_avg_rating ON public.listings(avg_rating);
     CREATE INDEX IF NOT EXISTS idx_listings_compare_at_price ON public.listings(compare_at_price) WHERE compare_at_price IS NOT NULL;`
  );

  console.log('[Migration] All startup migrations completed');
})();

if (!PAYSTACK_SECRET) {
  console.warn('PAYSTACK_SECRET_KEY not set — Paystack routes will return 503');
}

const paystackHeaders = PAYSTACK_SECRET ? {
  Authorization: `Bearer ${PAYSTACK_SECRET}`,
  'Content-Type': 'application/json',
} : null;

// ── Health check ──
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'omix-api', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'omix-api' });
});

// ── Advanced Search API ─────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });

    const {
      q = '',
      category = '',
      min_price = '',
      max_price = '',
      condition = '',
      location = '',
      brand = '',
      availability = '',
      min_rating = '',
      has_discount = '',
      size = '',
      seller_id = '',
      wholesale = '',
      sort = '',
      page = 1,
      limit = 20,
    } = req.query;

    // ── Try Meilisearch first for text-search queries ──
    // Only use Meilisearch when ALL active filters can be handled by it.
    // If extra filters (condition, location, availability, min_rating, has_discount, size) are active,
    // skip Meilisearch and go straight to DB to avoid silently ignoring those filters.
    const extraFilters = condition || location || availability || min_rating || has_discount || size || seller_id || wholesale;
    const useMeili = meiliSearch.isAvailable() && !extraFilters && (q || category || brand || min_price || max_price);
    if (useMeili) {
      try {
        const meiliResult = await meiliSearch.searchProducts({
          q,
          category,
          brand,
          min_price,
          max_price,
          sort,
          page,
          limit,
        });
        if (meiliResult) {
          return res.json(meiliResult);
        }
      } catch (meiliErr) {
        console.error('[Search] Meilisearch failed, falling back to DB:', meiliErr.message);
      }
    }

    // ── Fallback: Database search ──
    let query = supabase
      .from('listings')
      .select('*', { count: 'exact' })
      .eq('status', 'active');

    // Text search on title and description
    if (q) {
      const sanitized = q.replace(/[^a-zA-Z0-9\s\-.]/g, '').trim();
      if (sanitized.length > 0) {
        query = query.or(`title.ilike.%${sanitized}%,description.ilike.%${sanitized}%`);
      }
    }

    // Category filter — map category name to integer category_id
    if (category) {
      const CATEGORY_TO_ID = {
        'Electronics': 1,
        'Furniture': 2,
        'Clothing': 3,
        'Books': 4,
        'Vehicles': 5,
        'Home & Garden': 6,
        'Sports': 7,
        'Toys & Games': 8,
        'Health & Beauty': 9,
        'Services': 10,
        'Business Services': 10,
        'Food': 12,
        'Drinks': 13,
        'Snacks': 14,
        'Bakery': 15,
        'Others': 11,
      };
      const catId = CATEGORY_TO_ID[category] || null;
      if (catId) {
        query = query.eq('category_id', catId);
      }
    }

    // Price range
    const minP = parseFloat(min_price) || 0;
    const maxP = parseFloat(max_price) || 999999;
    if (minP > 0) query = query.gte('price', minP);
    if (maxP < 999999) query = query.lte('price', maxP);

    // Condition
    if (condition) {
      const conditions = condition.split(',').map(c => c.trim()).filter(Boolean);
      if (conditions.length === 1) {
        query = query.eq('condition', conditions[0]);
      } else if (conditions.length > 1) {
        query = query.in('condition', conditions);
      }
    }

    // Location — search both city and region columns (table has location_city + location_region, not 'location')
    if (location) {
      query = query.or(`location_city.ilike.%${location}%,location_region.ilike.%${location}%`);
    }

    // Brand
    if (brand) {
      query = query.ilike('brand', `%${brand}%`);
    }

    // Availability
    if (availability === 'in_stock') {
      query = query.gt('stock_quantity', 0);
    } else if (availability === 'out_of_stock') {
      query = query.eq('stock_quantity', 0);
    }

    // Minimum rating filter (requires avg_rating column added by M8 migration)
    if (min_rating) {
      const ratingVal = parseFloat(min_rating);
      if (ratingVal > 0) {
        query = query.gte('avg_rating', ratingVal);
      }
    }

    // Has discount filter (products with compare_at_price set and active sale)
    // Requires compare_at_price column added by M11 migration
    if (has_discount === 'true') {
      query = query.gt('compare_at_price', 0);
    }

    // Size filter - search in variants (supports both old array and new {types,items} format)
    if (size) {
      const oldFormat = JSON.stringify([{ size }]);
      const newFormat = JSON.stringify({ items: [{ attrs: { size } }] });
      query = query.or(`variants.cs.${oldFormat},variants.cs.${newFormat}`);
    }

    // Seller filter
    if (seller_id) {
      query = query.eq('seller_id', seller_id);
    }

    // Wholesale filter
    if (wholesale === 'true') {
      query = query.eq('wholesale_enabled', true);
    }

    // Sort parameter
    switch (sort) {
      case 'price_asc':
        query = query.order('price', { ascending: true });
        break;
      case 'price_desc':
        query = query.order('price', { ascending: false });
        break;
      case 'rating_desc':
        query = query.order('avg_rating', { ascending: false, nullsFirst: false });
        break;
      case 'newest':
      default:
        query = query.order('created_at', { ascending: false });
        break;
    }
    // Tiebreaker: always order by newest as fallback
    query = query.order('created_at', { ascending: false });

    // Pagination
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({
      listings: data || [],
      total: count || 0,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil((count || 0) / limitNum),
    });
  } catch (err) {
    console.error('[Search API] Error:', err.message);
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

// ── Meilisearch Sync Endpoints ─────────────────────────────────────
// POST /api/search/sync — index or update a product document
app.post('/api/search/sync', requireAdmin, async (req, res) => {
  try {
    const { product } = req.body;
    if (!product || !product.id) {
      return res.status(400).json({ success: false, error: 'Product object with id is required' });
    }
    const ok = await meiliSearch.indexProduct(product);
    res.json({ success: ok });
  } catch (err) {
    console.error('[Search Sync] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/search/sync/:id — remove a product document
app.delete('/api/search/sync/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'Product id is required' });
    }
    const ok = await meiliSearch.removeProduct(id);
    res.json({ success: ok });
  } catch (err) {
    console.error('[Search Sync Delete] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Delivery Zones API ────────────────────────────────────────────
app.get('/api/delivery-zones', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const { data, error } = await supabase
      .from('delivery_zones')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    res.json({ zones: data || [] });
  } catch (err) {
    console.error('[DeliveryZones] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Pick-up Stations API ──────────────────────────────────────────
app.get('/api/pickup-stations', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const { data, error } = await supabase
      .from('pickup_stations')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    res.json({ stations: data || [] });
  } catch (err) {
    console.error('[PickupStations] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Product Questions & Answers API ───────────────────────────────
// GET questions for a listing
app.get('/api/products/:id/questions', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const { id } = req.params;
    const { data, error } = await supabase
      .from('product_questions')
      .select('*')
      .eq('listing_id', id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ questions: data || [] });
  } catch (err) {
    console.error('[ProductQuestions] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST a question
app.post('/api/products/:id/questions', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const { id } = req.params;
    const { question, userId, userName } = req.body;
    if (!question || !userId || !userName) {
      return res.status(400).json({ error: 'Question, userId and userName required' });
    }
    const { data, error } = await supabase
      .from('product_questions')
      .insert({
        listing_id: id,
        user_id: userId,
        user_name: userName,
        question,
      })
      .select('*')
      .single();
    if (error) throw error;
    res.json({ success: true, question: data });
  } catch (err) {
    console.error('[PostQuestion] Error:', err.message);
    res.status(500).json({ error: 'Failed to submit question' });
  }
});

// POST answer a question (admin)
app.post('/api/questions/:id/answer', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const { id } = req.params;
    const { answer, userId } = req.body;
    if (!answer) return res.status(400).json({ error: 'Answer required' });
    const { data, error } = await supabase
      .from('product_questions')
      .update({ answer, answered_by: userId, answered_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    res.json({ success: true, question: data });
  } catch (err) {
    console.error('[AnswerQuestion] Error:', err.message);
    res.status(500).json({ error: 'Failed to submit answer' });
  }
});

// ── Wholesale Pricing API ─────────────────────────────────────────
app.get('/api/products/:id/wholesale', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const { id } = req.params;
    const { data, error } = await supabase
      .from('wholesale_prices')
      .select('*')
      .eq('listing_id', id)
      .order('min_quantity', { ascending: true });
    if (error) throw error;
    res.json({ prices: data || [] });
  } catch (err) {
    console.error('[Wholesale] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/products/:id/wholesale — Save wholesale tiers (admin only)
app.post('/api/admin/products/:id/wholesale', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const { id } = req.params;
    const { tiers } = req.body;

    if (!Array.isArray(tiers)) {
      return res.status(400).json({ success: false, error: 'tiers must be an array' });
    }

    if (tiers.length > 5) {
      return res.status(400).json({ success: false, error: 'Maximum 5 wholesale tiers allowed' });
    }

    // Validate each tier
    for (const tier of tiers) {
      const minQty = parseInt(tier.min_qty);
      const price = parseFloat(tier.price);
      if (!minQty || minQty < 1) {
        return res.status(400).json({ success: false, error: 'Each tier must have a valid min_qty (positive integer)' });
      }
      if (!price || price < 0) {
        return res.status(400).json({ success: false, error: 'Each tier must have a valid price' });
      }
    }

    // Delete existing tiers and insert new ones in a transaction
    const { error: deleteError } = await supabase
      .from('wholesale_prices')
      .delete()
      .eq('listing_id', id);

    if (deleteError) throw deleteError;

    if (tiers.length > 0) {
      const inserts = tiers.map(tier => ({
        listing_id: id,
        min_quantity: parseInt(tier.min_qty),
        unit_price: parseFloat(tier.price),
      }));

      const { error: insertError } = await supabase
        .from('wholesale_prices')
        .insert(inserts);

      if (insertError) throw insertError;
    }

    res.json({ success: true, message: 'Wholesale prices saved' });
  } catch (err) {
    console.error('[Admin Wholesale] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Seller Registration / Profile API ─────────────────────────────
// Get seller by user_id
app.get('/api/seller/profile', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id required' });
    const { data, error } = await supabase
      .from('sellers')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (error && error.code === 'PGRST116') return res.json({ seller: null });
    if (error) throw error;
    res.json({ seller: data });
  } catch (err) {
    console.error('[SellerProfile] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get seller by slug (public)
app.get('/api/seller/:slug', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const { slug } = req.params;
    // Avoid colliding with POST /api/seller/register — this GET is for public seller pages by slug
    if (slug === 'register' || slug === 'profile') {
      return res.status(404).json({ error: 'Seller not found' });
    }
    const { data: seller, error } = await supabase
      .from('sellers')
      .select('*')
      .eq('shop_slug', slug)
      .single();
    if (error) {
      // PostgREST returns PGRST116 when single() finds no rows
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Seller not found' });
      }
      throw error;
    }
    // Get seller's listings
    const { data: listings } = await supabase
      .from('listings')
      .select('*')
      .eq('seller_id', seller.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    res.json({ seller, listings: listings || [] });
  } catch (err) {
    console.error('[SellerBySlug] Error:', err.message);
    res.status(500).json({ error: 'Seller not found' });
  }
});

// Register as seller
app.post('/api/seller/register', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const { userId, shopName, shopSlug, description, phone, email, address, businessRegistration, kraPin, idNumber, mpesaPhone } = req.body;
    if (!userId || !shopName || !shopSlug) {
      return res.status(400).json({ error: 'userId, shopName and shopSlug required' });
    }
    const { data, error } = await supabase
      .from('sellers')
      .insert({
        user_id: userId,
        shop_name: shopName,
        shop_slug: shopSlug,
        shop_description: description || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        business_registration: businessRegistration || null,
        kra_pin: kraPin || null,
        id_number: idNumber || null,
        mpesa_phone: mpesaPhone || null,
        status: 'pending',
        is_active: false,
      })
      .select('*')
      .single();
    if (error) throw error;
    res.json({ success: true, seller: data });
  } catch (err) {
    console.error('[SellerRegister] Error:', err.message);
    if (err.message?.includes('duplicate') || err.code === '23505') {
      return res.status(409).json({ error: 'Shop name or slug already taken' });
    }
    res.status(500).json({ error: 'Failed to register seller: ' + err.message });
  }
});

// ── Seller Analytics / Dashboard ──────────────────────────────────
app.get('/api/seller/:id/analytics', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const { id } = req.params;
    const { data: orders, error } = await supabase
      .from('omix_orders')
      .select('id, status, total_amount, created_at')
      .eq('seller_id', id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const totalOrders = orders?.length || 0;
    const totalRevenue = orders?.reduce((sum, o) => sum + (o.total_amount || 0), 0) || 0;
    const completedOrders = orders?.filter(o => o.status === 'delivered' || o.status === 'paid')?.length || 0;
    res.json({
      analytics: {
        total_orders: totalOrders,
        total_revenue: totalRevenue,
        completed_orders: completedOrders,
        pending_orders: orders?.filter(o => o.status === 'pending' || o.status === 'cod_pending')?.length || 0,
      }
    });
  } catch (err) {
    console.error('[SellerAnalytics] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Return Request API ────────────────────────────────────────────
app.post('/api/returns', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const { orderId, orderItemId, userId, reason } = req.body;
    if (!orderId || !reason) return res.status(400).json({ error: 'orderId and reason required' });
    const { data, error } = await supabase
      .from('return_requests')
      .insert({ order_id: orderId, order_item_id: orderItemId || null, user_id: userId || null, reason })
      .select('*')
      .single();
    if (error) throw error;
    res.json({ success: true, returnRequest: data });
  } catch (err) {
    console.error('[ReturnRequest] Error:', err.message);
    res.status(500).json({ error: 'Failed to submit return request' });
  }
});

// ── Improved Order Tracking ───────────────────────────────────────
app.get('/api/orders/:id/tracking-full', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const { id } = req.params;
    const { data: order, error } = await supabase
      .from('omix_orders')
      .select('*, tracking_events(*)')
      .eq('id', id)
      .single();
    if (error) throw error;
    res.json({ order });
  } catch (err) {
    console.error('[OrderTracking] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Auth: Signup (server-side, uses service key) ────────────────
app.post('/api/auth/signup', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });

    const { email, password, fullName, refCode } = req.body;
    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Email, password, and full name are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // 1. Create auth user with email auto-confirmed (uses service key)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (authError) throw new Error(authError.message);

    const userId = authData.user.id;

    // 2. Create profile
    const genRefCode = userId.replace(/-/g, '').slice(0, 8).toUpperCase();
    const { error: profileError } = await supabase.from('profiles').upsert({
      id: userId,
      full_name: fullName,
      email,
      role: 'customer',
      loyalty_points: 0,
      referral_code: genRefCode,
    }, { onConflict: 'id' });
    if (profileError) throw new Error('Failed to create profile: ' + profileError.message);

    // 3. Process referral if provided
    if (refCode) {
      try {
        // Look up affiliate by referral code
        const { data: affiliate } = await supabase
          .from('affiliates')
          .select('id, user_id, tier')
          .eq('referral_code', refCode)
          .eq('status', 'active')
          .single();

        if (affiliate) {
          // Check if user already has a referral attribution
          const { data: existing } = await supabase
            .from('referrals')
            .select('id')
            .eq('referred_user_id', userId)
            .single();

          if (!existing) {
            await supabase.from('referrals').insert({
              affiliate_id: affiliate.id,
              referred_user_id: userId,
              status: 'pending',
              referral_code: refCode,
            });
            // Also set the legacy profiles.referred_by column
            await supabase.from('profiles').update({ referred_by: affiliate.id }).eq('id', userId);
          }
        }
      } catch (refErr) {
        console.warn('[Signup] Referral processing skipped:', refErr.message);
      }
    }

    // 4. Sign the user in (generate session token)
    const { data: sessionData, error: sessionError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    // If session generation succeeds, we return success
    // The frontend will sign in with the credentials directly

    console.log(`[Signup] New user created: ${email} (${userId})`);
    res.json({
      success: true,
      user: { id: userId, email },
    });
  } catch (err) {
    console.error('[Signup] Error:', err.message);
    // Handle duplicate email
    if (/already|exists/i.test(err?.message || '')) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    res.status(500).json({ error: err.message || 'Signup failed' });
  }
});

// ── Auth: Admin Login (uses service key to set/reset password) ──
app.post('/api/auth/admin-login', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // 1. Look up user by email in profiles table
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('email', email)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 2. Verify admin role
    if (profile.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    // 3. Set/reset password using service key admin API
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      profile.id,
      { password }
    );
    if (updateError) throw new Error(updateError.message);

    console.log(`[Admin Login] Password set for admin: ${email}`);

    // 4. Return success — frontend will now sign in with these credentials
    res.json({
      success: true,
      user: { id: profile.id, email },
      message: 'Admin credentials accepted. Try signing in now.'
    });
  } catch (err) {
    console.error('[Admin Login] Error:', err.message);
    res.status(500).json({ error: err.message || 'Admin login failed' });
  }
});

// ── Nia AI Chat Proxy ──────────────────────────────────────────────
const NIA_SYSTEM_PROMPT = `You are Nia, the friendly AI assistant for Omix Store — an online marketplace based in Kericho, Kenya. You talk like a real Kenyan, simple and warm.

## About Omix Store
- **Location:** Kericho, Kenya
- **Website:** https://omixsystems.store
- **Support:** omixsystems@gmail.com | +254 768 213 649 | WhatsApp: +254 768 213 649
- **Hours:** Monday to Saturday, 8 AM — 6 PM. Sunday closed.
- **Payment:** M-Pesa via Paystack STK Push (secure, instant). Cash on delivery also available for selected areas.
- **Buyer Protection:** If an item arrives damaged or not as described, contact us within 24 hours.

## Delivery Information
- **Free delivery** within Kericho and surrounding areas.
- **Kericho CBD:** Same day delivery.
- **Kericho town:** 1-2 days.
- **Outside Kericho:** 2-3 days.

## Return Policy
- **Electronics:** 7 days if defective, with receipt.
- **Clothing:** 3 days with tags and receipt.
- **Shoes:** 3 days if unworn.
- **Furniture:** No returns — inspect on delivery.

## Store Features
- **Browse & Search:** All products on home page, search bar to find items. Filter by category (Clothing, Electronics, Furniture, etc.).
- **Product Variants:** Clothing and other items have size/color options to choose before adding to cart.
- **Wishlist:** Heart icon to save items. View at /wishlist.
- **Cart & Checkout:** Add items to cart, apply promo codes, pay via M-Pesa (STK Push) or Cash on Delivery.
- **Order Tracking:** Track at /track-order or in Account page. Statuses: pending, paid, processing, shipped, delivered, cancelled.
- **Email Notifications:** Order confirmation, payment failed, status updates, and welcome email — all sent to your registered email.
- **Promo Codes:** Enter at checkout for discounts. Admin creates and manages them.
- **Compare Products:** Compare up to 4 products side-by-side at /compare.
- **Flash Deals:** Time-limited discounts on selected products. Shop at /flash-deals.
- **Refurbished Section:** Vetted refurbished electronics at /refurbished.
- **Referral Program:** Refer friends — both get KES 100 off. Link in Account page.
- **Loyalty Points:** 1 point per KES 100 spent. 100 points = KES 50 off.
- **Product Reviews:** Customers can rate and review products they've purchased.
- **PWA Install:** Install the app from your browser for a native-like experience.

## Affiliate Program
- Anyone can apply at /affiliate/apply. Agree to terms at /affiliate/agreement.
- Two tiers: Silver (5% commission) and Gold (10% commission).
- First-touch attribution: whoever shares their link first gets the commission. Cookie lasts 100 years.
- Affiliates get a unique referral code and link. Share on WhatsApp, social media, etc.
- Dashboard at /affiliate-dashboard: see earnings, commissions, referrals, and request payouts.
- Payouts via M-Pesa. Minimum payout: KES 2,000.
- Refer customers via \`?ref=CODE\` in URL or enter referral code at checkout.

## Seller Features
- Sellers can create an account and list products for sale.
- Seller dashboard at /seller/dashboard — manage listings, track orders.
- Products go through admin review before going live.

## Admin Panel
- Admin panel at /admin — manage products, orders, affiliates, promo codes, flash deals, and notifications.
- Affiliate management: view applications, approve/reject, track commissions, process payouts.
- Product management: add/edit products, set variants (sizes/colors), manage stock.
- Order management: update order status, view all orders.
- Push notifications: send browser notifications to users about deals and updates.

## Help Center
- Help center at /help with sections: Payment, Delivery, FAQ, Refund, After-Sale, Shopping Guide, Dispute Resolution.
- Contact: omixsystems@gmail.com or WhatsApp +254 768 213 649.
- Hours: Monday to Saturday, 8 AM — 6 PM. Sunday closed.

## How to Respond
- Answer warmly and helpfully. Use simple Kenyan English. "Sawa", "pole", "asante" naturally.
- Cannot see personal data. Direct users to Account page or support.
- If confused: offer simple next step.
- If angry: "Pole sana for the trouble. Let me help sort this out." Never argue.
- If off-topic: politely redirect to Omix Store.
- If unsure: "I don't have that info right now. Let me connect you to support." Then give email/WhatsApp.
- Never make up prices, stock, or product details.
- Always protect user privacy.
- IMPORTANT: Never use markdown symbols in your responses. NO asterisks (*), no hash symbols (#), no underscores (_), no backticks. Write plain text only. Use dashes (-) for lists if needed.

## CHIPS FORMAT
Every response must end with a line containing only:
CHIPS: <chip1> | <chip2> | <chip3>

Choose 2-4 chips. Default: Browse products | Track my order | Contact support`;

// Hugging Face Inference API via official SDK
// Primary: Qwen2.5-72B-Instruct, Fallback: Qwen2.5-Coder-32B
const NIA_MODELS = [
  'Qwen/Qwen2.5-72B-Instruct',
  'Qwen/Qwen2.5-Coder-32B-Instruct',
];

app.post('/api/nia/chat', async (req, res) => {
  try {
  const apiKey = process.env.HF_API_KEY;

  const { messages, userId, pageContext, cartItems } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Messages required' });

  // If no API key, return simple fallback response directly (no 503 error)
  if (!apiKey) {
    const lastMsg = messages.filter(m => m.role === 'user').pop()?.content?.toLowerCase() || '';
    const isSwahili = /jambo|habari|naomba|nataka|bei|pesa|shilingi|asante|ndio|hapana|nini|wapi|vipi|ngapi|saa|oda|malipo|usafirishaji/i.test(lastMsg);
    let responseText;
    if (isSwahili) {
      responseText = 'Habari! Mimi ni Nia, msaidizi wako wa Omix Store. Ninaweza kukusaidia kutafuta bidhaa, kuangalia oda zako, au kujua jinsi duka letu linavyofanya kazi. Una swali gani leo?';
    } else if (/hello|hi|hey|good morning|good evening/i.test(lastMsg)) {
      responseText = 'Hello! I\'m Nia, your Omix Store assistant. I can help you browse products, track orders, or learn how the store works. What would you like to know?';
    } else {
      responseText = 'Hi there! I\'m Nia, the Omix Store assistant. Feel free to ask me about our products, your orders, or how to use the store. How can I help you today?';
    }
    return res.json({ content: responseText });
  }

  // Build dynamic context
  let contextPrompt = NIA_SYSTEM_PROMPT;
  console.log(`[Nia] chat request: supabase=${supabase ? 'OK' : 'NULL'}, msgCount=${messages.length}, page=${pageContext || 'none'}`);
  try {
    // Detect product queries and fetch matching products
    const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content?.toLowerCase() || '';
    const isProductQuery = /product|item|buy|shop|find|search|price|cost|available|stock|recommend|suggest|show|do you have|gatsby|phone|laptop|tablets?|tv|headphone|charger|cable|airpod/i.test(lastUserMsg);

    if (isProductQuery && supabase) {
      const searchTerms = lastUserMsg.replace(/^(show|find|search|look|get|i want|i need|do you have|any|recommend|suggest|what|where|do you sell|list of)\s*/i, '').trim();
      let query = supabase.from('listings').select('title,price').eq('status', 'active').order('created_at', { ascending: false }).limit(6);
      if (searchTerms.length > 2) {
        query = query.ilike('title', `%${searchTerms}%`);
      }
      const { data: products, error: prodErr } = await query;
      if (prodErr) console.warn('[Nia] Product fetch error:', prodErr.message);
      if (products?.length) {
        contextPrompt += '\n## Available Products:\n' + products.map(p =>
          `- ${p.title}: KES ${p.price.toLocaleString()}`
        ).join('\n');
        contextPrompt += '\n\nRecommend these products if relevant. Include prices.';
      }
    }

    // Add page context if provided
    if (pageContext) {
      contextPrompt += `\n\n## Current Page Context:\nUser is browsing: ${pageContext}`;
      contextPrompt += '\n\nUse this context to give relevant answers. If they ask "how much is this" or "what do you think", refer to what they are looking at.';
    }

    // Add cart context if provided
    if (cartItems && cartItems.length > 0) {
      const cartTotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      contextPrompt += `\n\n## User's Cart (${cartItems.length} items, KES ${cartTotal.toLocaleString()} total):\n`;
      contextPrompt += cartItems.map(c => `- ${c.name || c.title} x${c.quantity} @ KES ${c.price?.toLocaleString() || '?'}`).join('\n');
      contextPrompt += '\n\nReference the cart if user asks about it, total, or checkout.';
    }

    // Add user context if available
    if (userId && supabase) {
      const { data: profile } = await supabase.from('profiles').select('full_name,loyalty_points,referral_code').eq('id', userId).single();
      if (profile) {
        contextPrompt += `\n\n## Current User:\n- Name: ${profile.full_name || 'Customer'}\n- Loyalty Points: ${profile.loyalty_points || 0}`;
        if (profile.referral_code) contextPrompt += `\n- Referral Code: ${profile.referral_code}`;
      }

      // Check if user is asking about a specific order by ID
      const orderIdMatch = lastUserMsg.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
        || lastUserMsg.match(/[0-9a-f]{8}/i);

      if (orderIdMatch && /order|track|status|where/i.test(lastUserMsg)) {
        // Try to find order by full or partial ID
        const { data: specificOrder } = await supabase
          .from('omix_orders')
          .select('id,status,total_amount,customer_name,created_at,omix_order_items(product_name,quantity,price)')
          .eq('user_id', userId)
          .ilike('id', `${orderIdMatch[0]}%`)
          .single();
        if (specificOrder) {
          contextPrompt += `\n\n## Order Lookup Result:\nOrder #${specificOrder.id.slice(0,8).toUpperCase()}: ${specificOrder.status} — KES ${specificOrder.total_amount?.toLocaleString() || '?'} (${new Date(specificOrder.created_at).toLocaleDateString('en-KE')})`;
          if (specificOrder.omix_order_items?.length) {
            contextPrompt += '\nItems:' + specificOrder.omix_order_items.map(i => `\n- ${i.product_name} x${i.quantity}`).join('');
          }
          contextPrompt += '\n\nShare this order status with the user in a friendly way.';
        }
      }

      const { data: orders } = await supabase.from('omix_orders').select('id,status,total_amount,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(3);
      if (orders?.length) {
        contextPrompt += '\n\n## Recent Orders:\n' + orders.map(o =>
          `- Order #${o.id.toString().slice(0, 8).toUpperCase()}: ${o.status} — KES ${o.total_amount?.toLocaleString() || '?'} (${new Date(o.created_at).toLocaleDateString('en-KE')})`
        ).join('\n');
        contextPrompt += '\n\nReference these orders if user asks about them.';
      }
    }
  } catch (ctxErr) {
    console.warn('[Nia] Context fetch failed, using baseline prompt:', ctxErr.message);
  }

  // Detect Swahili
  const lastMsg = messages.filter(m => m.role === 'user').pop()?.content?.toLowerCase() || '';
  const isSwahili = /jambo|habari|naomba|nataka|bei|pesa|shilingi|asante|ndio|hapana|nini|wapi|vipi|ngapi|saa|oda|malipo|usafirishaji/i.test(lastMsg);
  if (isSwahili) {
    contextPrompt += '\n\n⚠️ User is speaking Swahili. Respond in natural, conversational Swahili (Kiswahili).';
  }

  // Use @huggingface/inference SDK for fallback
  const hfClient = new InferenceClient(apiKey);

  let lastError = null;

  // Try OpenCode/Zen API first (primary provider)
  const opencodeKey = process.env.OPENCODE_API_KEY;
  if (opencodeKey) {
    try {
      const opencodeRes = await fetch('https://opencode.ai/zen/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${opencodeKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash-free',
          messages: [
            { role: 'system', content: contextPrompt },
            ...messages,
          ],
          max_tokens: 600,
          temperature: 0.7,
        }),
      });

      if (opencodeRes.ok) {
        const opencodeData = await opencodeRes.json();
        const choice = opencodeData?.choices?.[0] || {};
        let content = choice?.message?.content?.trim?.();

        // Handle reasoning models (content in reasoning_content instead)
        if (!content && choice?.message?.reasoning_content) {
          content = choice.message.reasoning_content.trim();
        }

        if (content) {
          content = content.replace(/\*/g, '').replace(/#{1,6}\s?/g, '').replace(/_{2,}/g, '').replace(/`/g, '').trim();
          console.log('[Nia] Responded via opencode/zen (deepseek-v4-flash-free)');
          res.json({ content });
          return;
        }
      } else {
        const errText = await opencodeRes.text();
        console.warn(`[Nia] OpenCode/Zen error: HTTP ${opencodeRes.status} - ${errText}`);
      }
    } catch (ocErr) {
      lastError = ocErr;
      console.warn(`[Nia] OpenCode/Zen error: ${ocErr.message}`);
    }
  }

  // Try Hugging Face models as fallback
  for (const model of NIA_MODELS) {
    try {
      const completion = await hfClient.chatCompletion({
        model,
        messages: [
          { role: 'system', content: contextPrompt },
          ...messages,
        ],
        max_tokens: 600,
        temperature: 0.7,
      });

      const msg = completion?.choices?.[0]?.message || {};
      let content = msg?.content?.trim?.();

      // Handle reasoning models that put the answer in reasoning_content
      if (!content && msg?.reasoning_content) {
        content = msg.reasoning_content.trim();
      }

      if (!content) {
        console.warn(`[Nia] Model ${model} returned empty, trying next...`);
        continue;
      }

      // Strip markdown symbols for cleaner Telegram-style display
      content = content.replace(/\*/g, '').replace(/#{1,6}\s?/g, '').replace(/_{2,}/g, '').replace(/`/g, '').trim();

      console.log(`[Nia] Responded via ${model}`);
      res.json({ content });
      return;
    } catch (err) {
      lastError = err;
      console.warn(`[Nia] Model ${model} error: ${err.message}, trying next...`);
    }
  }

  // All models failed
  res.status(502).json({ error: `All AI models unavailable. ${lastError?.message || ''}` });
  } catch (err) {
    console.error('[Nia] Unhandled chat error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Initialize Paystack Inline Payment ─────────────────────────────────────────
app.post('/api/paystack/initialize', requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(503).json({ message: 'Payment service not configured' });
  try {
    // Check maintenance mode first (if Supabase is available)
    if (supabase) {
      const { data: maintData } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'maintenance_mode')
        .single();
      if (maintData?.value === true) {
        return res.status(503).json({ message: 'Store is under maintenance. Payments are temporarily disabled.' });
      }
    } else {
      console.warn('Supabase not available — maintenance mode check skipped');
    }

    const { order_id, email, amount, phone, callback_url } = req.body;

    if (!email || !amount) {
      return res.status(400).json({ message: 'Missing required fields: email, amount' });
    }

    // Build Paystack payload for inline payment
    // No channel restriction — Paystack inline supports card, bank, M-Pesa, etc.
    const payload = {
      email,
      amount: Math.round(amount * 100), // Paystack expects amount in cents/kobo
      currency: 'KES',
      callback_url: callback_url || `${process.env.FRONTEND_URL || 'https://stor1-web.onrender.com'}/events/order/callback`,
      metadata: { order_id },
    };

    // If we have a subaccount for split payment, include it
    if (OMIX_SUBACCOUNT_CODE) {
      payload.split_code = OMIX_SUBACCOUNT_CODE;
      // Alternative: use subaccount directly
      // payload.subaccount = OMIX_SUBACCOUNT_CODE;
      // payload.transaction_charge = 0; // buyer pays fees
      // payload.bearer = 'account'; // subaccount bears Paystack fees
    }

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: paystackHeaders,
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!data.status) {
      console.error('Paystack init error:', data);
      return res.status(400).json({ message: data.message || 'Paystack initialization failed' });
    }

    res.json({
      success: true,
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
      access_code: data.data.access_code,
    });
  } catch (error) {
    console.error('Initialize error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ── Verify transaction ──
app.get('/api/paystack/verify/:reference', async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(503).json({ message: 'Payment service not configured' });
  try {
    const { reference } = req.params;

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: 'GET',
      headers: paystackHeaders,
    });

    const data = await response.json();

    if (!data.status) {
      return res.status(400).json({ message: data.message || 'Verification failed' });
    }

    res.json({
      success: true,
      data: {
        status: data.data.status,
        amount: data.data.amount / 100,
        reference: data.data.reference,
        channel: data.data.channel,
        paid_at: data.data.paid_at,
        customer: data.data.customer,
        metadata: data.data.metadata,
        fees: data.data.fees ? data.data.fees / 100 : null,
      },
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ── Paystack Webhook ──
app.post('/api/paystack/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const body = req.rawBody;

    // Verify webhook signature
    if (!signature) return res.status(401).json({ message: 'Missing signature' });
    const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(body).digest('hex');
    if (hash !== signature) return res.status(401).json({ message: 'Invalid signature' });

    const event = JSON.parse(body.toString());

    console.log('Paystack webhook:', event.event, event.data.reference);

    if (event.event === 'charge.success' || event.event === 'transfer.success') {
      const { reference, status, metadata } = event.data;

      if (metadata?.order_id && status === 'success') {
        console.log(`Payment confirmed for order ${metadata.order_id}`);

        // Update order status (idempotent: skip if already paid)
        try {
          const { data: existing } = await supabase
            .from('omix_orders')
            .select('id, status, email, customer_name, total_amount, area, landmark')
            .eq('id', metadata.order_id)
            .single();

          if (existing && existing.status !== 'paid') {
            // Fetch order items for email and stock tracking
            const { data: orderItems } = await supabase
              .from('omix_order_items')
              .select('product_id, product_name, price, quantity, variant')
              .eq('order_id', metadata.order_id);

            // ── Stock Tracking: Decrement quantity & update status ──
            if (orderItems && orderItems.length > 0) {
              for (const item of orderItems) {
                if (!item.product_id) continue;
                try {
                  // Fetch current stock
                  const { data: product } = await supabase
                    .from('listings')
                    .select('stock_quantity, quantity, status, purchase_count')
                    .eq('id', item.product_id)
                    .single();

                  if (product) {
                    // Determine stock field (some tables use stock_quantity, some use quantity)
                    const currentStock = product.stock_quantity ?? product.quantity ?? 0;
                    const newStock = Math.max(0, currentStock - item.quantity);
                    const currentPurchaseCount = product.purchase_count ?? 0;

                    // Determine new status
                    let newStatus = product.status;
                    if (newStock <= 0) {
                      newStatus = 'sold';
                    }

                    // Update stock, purchase_count, and status
                    const updateFields = {
                      status: newStatus,
                      purchase_count: currentPurchaseCount + item.quantity,
                      updated_at: new Date().toISOString(),
                    };
                    // Update whichever stock field exists
                    if (product.stock_quantity !== undefined) {
                      updateFields.stock_quantity = newStock;
                    }
                    if (product.quantity !== undefined) {
                      updateFields.quantity = newStock;
                    }
                    // Auto-featured if purchase_count > 5
                    if (currentPurchaseCount + item.quantity > 5) {
                      updateFields.featured = true;
                    }

                    await supabase
                      .from('listings')
                      .update(updateFields)
                      .eq('id', item.product_id);

                    console.log(`[Stock] Product ${item.product_id}: ${currentStock} → ${newStock}, status: ${newStatus}, purchases: ${currentPurchaseCount + item.quantity}`);
                  }
                } catch (stockErr) {
                  console.error(`[Stock] Failed to update stock for product ${item.product_id}:`, stockErr.message);
                }
              }
            }

            await supabase
              .from('omix_orders')
              .update({ status: 'paid', paystack_reference: reference, paid_at: new Date().toISOString() })
              .eq('id', metadata.order_id);
            console.log(`Order ${metadata.order_id} marked as paid`);
          } else if (existing?.status === 'paid') {
            console.log(`Order ${metadata.order_id} already paid, skipping update`);
          }

          // Send order confirmation email with receipt
          if (existing?.email) {
            const { data: orderItems } = await supabase
              .from('omix_order_items')
              .select('product_name, price, quantity, variant')
              .eq('order_id', metadata.order_id);

            // Enrich items with variant info
            const itemsForEmail = (orderItems || []).map(item => ({
              ...item,
              name: item.product_name + (
                item.variant?.label
                  ? ` (${item.variant.label})`
                  : (item.variant?.size || item.variant?.colorName)
                    ? ` (${item.variant.size || ''}${item.variant.size && item.variant.colorName ? ', ' : ''}${item.variant.colorName || ''})`
                    : ''
              ),
            }));

            emailLib.sendOrderConfirmation({
              to: existing.email,
              orderId: existing.id,
              items: itemsForEmail,
              total: existing.total_amount,
              customerName: existing.customer_name,
              deliveryArea: existing.area,
              deliveryLandmark: existing.landmark,
            }).catch(err => console.error('[Email] Order confirmation failed:', err.message));

            // Send referral reward email if this was a referred user's first paid order
            supabase.from('referrals')
              .select('affiliate_id, converted_at')
              .eq('referred_user_id', existing.user_id)
              .eq('status', 'converted')
              .single()
              .then(({ data: referral }) => {
                if (referral) {
                  supabase.from('affiliates').select('email, referral_code, full_name').eq('id', referral.affiliate_id).single()
                    .then(({ data: aff }) => {
                      if (aff?.email) {
                        emailLib.sendReferralReward({
                          to: aff.email,
                          referralCode: aff.referral_code,
                          rewardAmount: existing.total_amount ? Math.round(existing.total_amount * 0.05) : 100,
                          customerName: aff.full_name,
                        }).catch(err => console.warn('[Email] Referral reward failed:', err.message));
                      }
                    })
                    .catch(() => {});
                }
              })
              .catch(() => {});
          }
        } catch (dbErr) {
          console.error('[DB] Failed to process order:', dbErr.message);
        }
      }
    }

    // Handle payment failure
    if (event.event === 'charge.failed') {
      const { reference, status, metadata, amount } = event.data;
      console.log(`Payment failed for order ${metadata?.order_id}`);

      if (metadata?.order_id) {
        try {
          const { data: existing } = await supabase
            .from('omix_orders')
            .select('id, status, email, customer_name, total_amount')
            .eq('id', metadata.order_id)
            .single();

          if (existing && existing.status === 'pending') {
            await supabase
              .from('omix_orders')
              .update({ status: 'payment_failed' })
              .eq('id', metadata.order_id);
          }

          // Send payment failure email
          if (existing?.email) {
            emailLib.sendPaymentFailed({
              to: existing.email,
              orderId: existing.id,
              customerName: existing.customer_name,
              amount: existing.total_amount,
              reference,
            }).catch(err => console.error('[Email] Payment failure email failed:', err.message));
          }
        } catch (dbErr) {
          console.error('[DB] Failed to process payment failure:', dbErr.message);
        }
      }
    }

    // Always return 200 to Paystack
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).send('OK'); // Still return 200 to prevent retries
  }
});

// ── API Key Auth Middleware ────────────────────────────────────────────────
const API_KEY = process.env.API_KEY;
const requireApiKey = (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (!API_KEY || key !== API_KEY) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
};

// ── Public API endpoints for email services ─────────────────────────────────────

// Send welcome email after user signup
app.post('/api/email/welcome', requireApiKey, async (req, res) => {
  try {
    // Debug: check env vars
    const debug = {
      RESEND_API_KEY: process.env.RESEND_API_KEY ? 'SET (len=' + process.env.RESEND_API_KEY.length + ')' : 'NOT SET',
      RESEND_FROM: process.env.RESEND_FROM || 'NOT SET',
      NODE_ENV: process.env.NODE_ENV || 'NOT SET',
    };
    const { to, name } = req.body;
    if (!to) return res.status(400).json({ message: 'Email address required', debug });

    console.log('[Welcome] Calling sendWelcomeEmail with', { to, name });
    const result = await emailLib.sendWelcomeEmail({ to, name });
    console.log('[Welcome] Result:', JSON.stringify(result));
    res.json({ success: result.sent, message: result.sent ? 'Welcome email sent' : 'Welcome email skipped (no API key)', result });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send welcome email', error: err.message });
  }
});

// Send referral reward notification
app.post('/api/email/referral-reward', requireApiKey, async (req, res) => {
  try {
    const { to, referralCode, rewardAmount, customerName } = req.body;
    if (!to) return res.status(400).json({ message: 'Email address required' });

    const result = await emailLib.sendReferralReward({ to, referralCode, rewardAmount, customerName });
    res.json({ success: result.sent, message: result.sent ? 'Referral reward email sent' : 'Referral reward email skipped (no API key)' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send referral reward email', error: err.message });
  }
});

// Send order status update
app.post('/api/email/order-status', requireApiKey, async (req, res) => {
  try {
    const { to, orderId, status, customerName } = req.body;
    if (!to) return res.status(400).json({ message: 'Email address required' });

    const result = await emailLib.sendOrderStatusUpdate({ to, orderId, status, customerName });
    res.json({ success: result.sent, message: result.sent ? 'Order status email sent' : 'Order status email skipped (no API key)' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send order status email', error: err.message });
  }
});

// Send price drop alert
app.post('/api/email/price-drop', requireApiKey, async (req, res) => {
  try {
    const { to, productName, productUrl, oldPrice, newPrice, productImage } = req.body;
    if (!to) return res.status(400).json({ message: 'Email address required' });

    const result = await emailLib.sendPriceDropAlert({ to, productName, productUrl, oldPrice, newPrice, productImage });
    res.json({ success: result.sent, message: result.sent ? 'Price drop alert sent' : 'Price drop alert skipped (no API key)' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send price drop alert', error: err.message });
  }
});

// Send back in stock alert
app.post('/api/email/back-in-stock', requireApiKey, async (req, res) => {
  try {
    const { to, productName, productUrl, price } = req.body;
    if (!to) return res.status(400).json({ message: 'Email address required' });

    const result = await emailLib.sendBackInStockAlert({ to, productName, productUrl, price });
    res.json({ success: result.sent, message: result.sent ? 'Back in stock alert sent' : 'Back in stock alert skipped (no API key)' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send back in stock alert', error: err.message });
  }
});

// Send abandoned cart reminder
app.post('/api/email/abandoned-cart', requireApiKey, async (req, res) => {
  try {
    const { to, items, total, customerName } = req.body;
    if (!to) return res.status(400).json({ message: 'Email address required' });

    const result = await emailLib.sendAbandonedCartReminder({ to, items, total, customerName });
    res.json({ success: result.sent, message: result.sent ? 'Abandoned cart reminder sent' : 'Abandoned cart reminder skipped (no API key)' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send abandoned cart reminder', error: err.message });
  }
});

// ── Create subaccount (for organizers to receive payouts) ──
app.post('/api/paystack/subaccount', requireApiKey, async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(503).json({ message: 'Payment service not configured' });
  try {
    const { business_name, bank_code, account_number } = req.body;

    const response = await fetch('https://api.paystack.co/subaccount', {
      method: 'POST',
      headers: paystackHeaders,
      body: JSON.stringify({
        business_name,
        bank_code,
        account_number,
        percentage_charge: 95, // organizer gets 95%
        primary_contact_email: process.env.ADMIN_EMAIL,
      }),
    });

    const data = await response.json();

    if (!data.status) {
      return res.status(400).json({ message: data.message || 'Subaccount creation failed' });
    }

    res.json({ success: true, subaccount_code: data.data.subaccount_code });
  } catch (error) {
    console.error('Subaccount error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ── Push Notifications ──
// Receives subscriptions + payload from admin, sends web push via service role
app.post('/api/push/send', requireApiKey, async (req, res) => {
  try {
    const { subscriptions, payload } = req.body;

    if (!subscriptions || !Array.isArray(subscriptions) || subscriptions.length === 0) {
      return res.json({ sent: 0, failed: 0, message: 'No subscriptions' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    // Optionally fetch fresh subscriptions from DB if not provided
    let subs = subscriptions;
    if (subs.length === 0) {
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh_key, auth_key');
      if (error) return res.status(500).json({ error: 'Failed to fetch subscriptions' });
      subs = data || [];
    }

    let sent = 0;
    let failed = 0;

    for (const sub of subs) {
      try {
        const subscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh_key,
            auth: sub.auth_key,
          },
        };

        const pushPayload = JSON.stringify({
          title: payload?.title || 'Omix Store',
          body: payload?.body || '',
          icon: payload?.icon || '/logo192.png',
          badge: '/logo192.png',
          tag: payload?.tag || 'omix-broadcast',
          data: { url: payload?.url || '/' },
          image: payload?.image || undefined,
          actions: payload?.actions || [],
          requireInteraction: payload?.requireInteraction || false,
        });

        await webpush.sendNotification(subscription, pushPayload);
        sent++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired — delete from DB
          failed++;
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint);
        } else {
          failed++;
          console.warn('[Push] send failed:', err.message);
        }
      }
    }

    res.json({ sent, failed, total: subs.length });
  } catch (err) {
    console.error('Push send error:', err);
    res.status(500).json({ message: 'Failed to send push notifications', error: err.message });
  }
});

// ── Admin: List registered users (auth + profile role) ──
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) throw error;
    const authUsers = data.users || [];

    // Pull profile roles in one shot
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, role, created_at');

    const roleMap = {};
    (profiles || []).forEach(p => { roleMap[p.id] = p; });

    const users = authUsers.map(u => {
      const prof = roleMap[u.id] || {};
      return {
        id: u.id,
        email: u.email,
        phone: u.phone,
        full_name: prof.full_name || u.user_metadata?.full_name || null,
        role: prof.role || 'customer',
        created_at: u.created_at,
        last_sign_in: u.last_sign_in_at,
        email_confirmed: !!u.email_confirmed_at,
      };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ success: true, users, count: users.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Admin: Delete a registered user (auth + profile) ──
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: 'user id required' });

    // Guard: never delete the last admin
    const { data: profile } = await supabase.from('profiles').select('role, email').eq('id', id).single();
    if (profile?.role === 'admin') {
      const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
      if ((admins?.length || 0) <= 1) {
        return res.status(400).json({ success: false, error: 'Cannot delete the last remaining admin account' });
      }
    }

    // Delete profile row first (FK), then auth user
    await supabase.from('profiles').delete().eq('id', id);
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) throw error;
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Admin: Apply pending DB migrations (idempotent, admin-only) ──
app.post('/api/admin/apply-migrations', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const fs = await import('fs');
    const path = await import('path');
    const migDir = path.default.join(process.cwd(), 'supabase', 'migrations');
    const files = fs.default.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    if (!SERVICE_KEY || !SUPABASE_URL) return res.status(500).json({ error: 'Service key not available' });
    const applied = [];
    for (const f of files) {
      const sql = fs.default.readFileSync(path.default.join(migDir, f), 'utf8');
      const r = await fetch(`${SUPABASE_URL}/rest/v1/sql`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'params=single-object' },
        body: JSON.stringify({ query: sql }),
      });
      if (!r.ok) {
        const err = await r.text();
        console.error('[Migrate]', f, 'failed:', err);
        return res.status(500).json({ error: `Migration ${f} failed`, detail: err });
      }
      applied.push(f);
    }
    res.json({ success: true, applied });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Get/Update broadcast settings (master toggle + default channels) ──
app.get('/api/admin/broadcast/settings', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { data } = await supabase.from('site_settings').select('value').eq('key', 'broadcast').single();
    res.json({ success: true, settings: data?.value || { enabled: true, default_email: true, default_push: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/broadcast/settings', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { enabled, default_email, default_push } = req.body;
    const settings = {
      enabled: enabled !== undefined ? !!enabled : true,
      default_email: default_email !== undefined ? !!default_email : true,
      default_push: default_push !== undefined ? !!default_push : true,
    };
    await supabase.from('site_settings').upsert({ key: 'broadcast', value: settings, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  WEBAUTHN (BIOMETRIC / PASSKEY) — user-facing
// ═══════════════════════════════════════════════════════════════

// List registered biometric credentials for current user
app.get('/api/webauthn/credentials', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { data } = await supabase
      .from('webauthn_credentials')
      .select('id, device_name, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    res.json({ success: true, credentials: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a biometric credential
app.delete('/api/webauthn/credentials/:id', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    await supabase.from('webauthn_credentials').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Begin registration (returns options to pass to navigator.credentials.create)
app.post('/api/webauthn/register/begin', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const userId = req.user.id;
    const { data: profile } = await supabase.from('profiles').select('email, full_name').eq('id', userId).single();
    const { data: existing } = await supabase.from('webauthn_credentials').select('credential_id').eq('user_id', userId);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: profile?.email || userId,
      userID: Buffer.from(userId),
      userDisplayName: profile?.full_name || profile?.email || 'Omix User',
      attestationType: 'none',
      excludeCredentials: (existing || []).map(c => ({ id: c.credential_id })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      supportedAlgorithmIDs: [-7, -257],
    });
    await supabase.from('webauthn_challenges').upsert({
      user_id: userId, challenge: options.challenge, purpose: 'register', created_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    res.json({ success: true, options });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Complete registration (verify attestation, store credential)
app.post('/api/webauthn/register/complete', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const userId = req.user.id;
    const { data: chal } = await supabase.from('webauthn_challenges').select('challenge').eq('user_id', userId).eq('purpose', 'register').single();
    if (!chal) return res.status(400).json({ error: 'No active registration challenge' });
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: chal.challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Registration verification failed' });
    }
    const { credential } = verification.registrationInfo;
    const deviceName = req.body.deviceName || 'Biometric device';
    await supabase.from('webauthn_credentials').insert({
      user_id: userId,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey).toString('base64'),
      counter: credential.counter,
      device_name: deviceName,
    });
    await supabase.from('webauthn_challenges').delete().eq('user_id', userId).eq('purpose', 'register');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Begin login (returns options to pass to navigator.credentials.get)
app.post('/api/webauthn/login/begin', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const { data: profile } = await supabase.from('profiles').select('id').eq('email', email).single();
    if (!profile) return res.status(404).json({ error: 'No account found' });
    const { data: creds } = await supabase.from('webauthn_credentials').select('credential_id').eq('user_id', profile.id);
    if (!creds || creds.length === 0) return res.status(404).json({ error: 'No biometric credentials for this account' });
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: creds.map(c => ({ id: c.credential_id })),
      userVerification: 'preferred',
    });
    await supabase.from('webauthn_challenges').upsert({
      user_id: profile.id, challenge: options.challenge, purpose: 'login', created_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    res.json({ success: true, options, userId: profile.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Complete login (verify assertion, return userId so client can establish session)
app.post('/api/webauthn/login/complete', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { userId, response } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const { data: chal } = await supabase.from('webauthn_challenges').select('challenge').eq('user_id', userId).eq('purpose', 'login').single();
    if (!chal) return res.status(400).json({ error: 'No active login challenge' });
    const { data: cred } = await supabase.from('webauthn_credentials').select('*').eq('user_id', userId).eq('credential_id', response.id).single();
    if (!cred) return res.status(404).json({ error: 'Unknown credential' });
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: chal.challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: cred.credential_id,
        publicKey: Buffer.from(cred.public_key, 'base64'),
        counter: Number(cred.counter),
        transports: ['internal', 'hybrid'],
      },
    });
    if (!verification.verified) return res.status(400).json({ error: 'Login verification failed' });
    await supabase.from('webauthn_credentials').update({ counter: verification.authenticationInfo.newCounter }).eq('id', cred.id);
    await supabase.from('webauthn_challenges').delete().eq('user_id', userId).eq('purpose', 'login');
    // Issue a Supabase session for the verified user (service-role)
    const { data: sessionData, error: sessErr } = await supabase.auth.admin.signInWithId({ userId });
    if (sessErr || !sessionData?.session) {
      return res.status(500).json({ error: sessErr?.message || 'Could not start session' });
    }
    res.json({
      success: true,
      session: {
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        token_type: sessionData.session.token_type,
        expires_in: sessionData.session.expires_in,
        expires_at: sessionData.session.expires_at,
        user: sessionData.session.user,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Broadcast email + push notification to all users ──
app.post('/api/admin/broadcast', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { subject, body, sendEmail: doEmail, sendPush } = req.body;
    if (!subject || !body) {
      return res.status(400).json({ success: false, error: 'subject and body are required' });
    }

    // Respect master toggle from settings
    const { data: settingRow } = await supabase.from('site_settings').select('value').eq('key', 'broadcast').single();
    const settings = settingRow?.value || { enabled: true, default_email: true, default_push: true };
    if (settings.enabled === false) {
      return res.status(403).json({ success: false, error: 'Broadcast is currently disabled in settings. Enable it to send.' });
    }
    const emailOn = doEmail !== undefined ? doEmail : settings.default_email;
    const pushOn = sendPush !== undefined ? sendPush : settings.default_push;

    // Collect all confirmed user emails
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const emails = (authUsers?.users || [])
      .map(u => u.email)
      .filter(Boolean);

    let emailSent = 0;
    if (emailOn && emails.length > 0) {
      for (const to of emails) {
        try {
          await emailLib.sendEmail({ to, subject, html: emailLib.emailWrapper({ title: subject, content: `<div style="font-size:15px;line-height:1.6;white-space:pre-wrap;color:#27272a">${body.replace(/</g, '&lt;')}</div><p style="font-size:12px;color:#71717a;margin-top:24px;">Omix Store — Kericho, Kenya</p>` }) });
          emailSent++;
        } catch (e) { console.warn('[Broadcast] email failed for', to, e.message); }
      }
    }

    // Fire-and-forget web push to all subscribers
    let pushSent = 0;
    if (pushOn) {
      try {
        const { data: subs } = await supabase
          .from('push_subscriptions')
          .select('endpoint, p256dh_key, auth_key');
        if (subs && subs.length > 0) {
          const payload = JSON.stringify({
            title: subject,
            body: body.slice(0, 200),
            tag: 'omix-broadcast',
            data: { url: '/' },
          });
          for (const sub of subs) {
            try {
              await webpush.sendNotification({
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
              }, payload);
              pushSent++;
            } catch { /* ignore expired subs */ }
          }
        }
      } catch (e) { console.warn('[Broadcast] push failed', e.message); }
    }

    res.json({ success: true, emailSent, pushSent, totalUsers: emails.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── User: Delete own account (auth + profile) ──
app.delete('/api/users/me', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const userId = req.user.id;

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single();
    if (profile?.role === 'admin') {
      const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
      if ((admins?.length || 0) <= 1) {
        return res.status(400).json({ success: false, error: 'The last admin cannot delete their own account' });
      }
    }

    await supabase.from('profiles').delete().eq('id', userId);
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) throw error;
    res.json({ success: true, message: 'Account deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Affiliate: Remove own affiliate account permanently ──
app.delete('/api/affiliate/:id', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: 'affiliate id required' });

    // Only the owner of the affiliate record (or an admin) may delete it
    const { data: aff } = await supabase.from('affiliates').select('user_id').eq('id', id).single();
    if (!aff) return res.status(404).json({ success: false, error: 'Affiliate not found' });

    const isOwner = aff.user_id === req.user.id;
    let isAdmin = false;
    if (!isOwner) {
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', req.user.id).single();
      isAdmin = prof?.role === 'admin';
    }
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    // Delete related rows then the affiliate record
    await supabase.from('referrals').delete().eq('affiliate_id', id);
    await supabase.from('referral_clicks').delete().eq('affiliate_id', id);
    await supabase.from('affiliate_commissions').delete().eq('affiliate_id', id);
    await supabase.from('monthly_commissions').delete().eq('affiliate_id', id);
    await supabase.from('affiliates').delete().eq('id', id);

    res.json({ success: true, message: 'Affiliate account removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Admin SQL endpoint (temporary — delete after migrations applied) ──
app.post('/api/admin/sql', requireAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ message: 'Supabase not configured' });
  const { query } = req.body;
  if (!query || typeof query !== 'string') return res.status(400).json({ message: 'query required' });
  
  // Only allow DDL statements (CREATE POLICY, ALTER TABLE, DROP POLICY)
  const allowed = /^(CREATE\s+POLICY|ALTER\s+TABLE|DROP\s+POLICY|GRANT|REVOKE)/i.test(query.trim());
  if (!allowed) return res.status(403).json({ message: 'Only DDL statements allowed' });

  try {
    const { data, error } = await supabase.rpc('exec_sql', { sql: query });
    if (error) {
      // If exec_sql doesn't exist, try using the Supabase Management API instead
      return res.status(500).json({ message: 'RPC not available', error: error.message });
    }
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ message: 'SQL execution failed', error: err.message });
  }
});

// ── Admin Analytics Endpoint ──────────────────────────────────
app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ message: 'Supabase not configured' });

  try {
    const { period = '30' } = req.query; // days
    const days = parseInt(period, 10) || 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffISO = cutoff.toISOString();

    // Fetch orders in period
    const { data: orders, error: ordersErr } = await supabase
      .from('omix_orders')
      .select('id, total_amount, status, created_at, omix_order_items(product_id, product_name, price, quantity)')
      .gte('created_at', cutoffISO)
      .order('created_at', { ascending: false });

    if (ordersErr) return res.status(500).json({ message: ordersErr.message });

    // Paid orders only for revenue
    const paidOrders = (orders || []).filter(o => o.status === 'paid');
    const totalRevenue = paidOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
    const totalOrders = paidOrders.length;

    // Revenue by day
    const revenueByDay = {};
    const ordersByDay = {};
    const uniqueVisitorsByDay = {};

    paidOrders.forEach(o => {
      const day = new Date(o.created_at).toISOString().split('T')[0];
      revenueByDay[day] = (revenueByDay[day] || 0) + parseFloat(o.total_amount || 0);
      ordersByDay[day] = (ordersByDay[day] || 0) + 1;
      // Approximate unique visitors by counting unique order emails per day
      const email = o.email || 'unknown';
      if (!uniqueVisitorsByDay[day]) uniqueVisitorsByDay[day] = new Set();
      uniqueVisitorsByDay[day].add(email);
    });

    // Build daily chart data
    const dailyData = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      dailyData.push({
        date: d.toLocaleDateString('en-KE', { month: 'short', day: 'numeric' }),
        revenue: Math.round(revenueByDay[key] || 0),
        orders: ordersByDay[key] || 0,
        users: uniqueVisitorsByDay[key] ? uniqueVisitorsByDay[key].size : 0,
      });
    }

    // Weekly aggregation (if period >= 7)
    const weeklyData = [];
    if (days >= 7) {
      for (let i = 0; i < dailyData.length; i += 7) {
        const week = dailyData.slice(i, i + 7);
        weeklyData.push({
          date: week[0]?.date || '',
          revenue: week.reduce((s, d) => s + d.revenue, 0),
          orders: week.reduce((s, d) => s + d.orders, 0),
          users: week.reduce((s, d) => s + d.users, 0),
        });
      }
    }

    // Monthly aggregation (if period >= 30)
    const monthlyData = [];
    if (days >= 30) {
      const monthMap = {};
      dailyData.forEach(d => {
        // Parse the date label back to group by month
        const monthKey = d.date.split(' ')[0]; // e.g. "Jun"
        if (!monthMap[monthKey]) monthMap[monthKey] = { date: monthKey, revenue: 0, orders: 0, users: 0 };
        monthMap[monthKey].revenue += d.revenue;
        monthMap[monthKey].orders += d.orders;
        monthMap[monthKey].users += d.users;
      });
      monthlyData.push(...Object.values(monthMap));
    }

    // Top selling products
    const productSales = {};
    paidOrders.forEach(order => {
      (order.omix_order_items || []).forEach(item => {
        const id = item.product_id || item.product_name;
        if (!productSales[id]) {
          productSales[id] = {
            product_id: item.product_id,
            name: item.product_name,
            quantitySold: 0,
            revenue: 0,
          };
        }
        productSales[id].quantitySold += item.quantity || 1;
        productSales[id].revenue += (item.price || 0) * (item.quantity || 1);
      });
    });

    const topProducts = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // COD (Cash on Delivery) tracking
    const codOrders = (orders || []).filter(o => o.status === 'cod_pending' || o.payment_method === 'cod');
    const codRevenue = codOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
    const codProductSales = {};
    codOrders.forEach(order => {
      (order.omix_order_items || []).forEach(item => {
        const id = item.product_id || item.product_name;
        if (!codProductSales[id]) {
          codProductSales[id] = {
            product_id: item.product_id,
            name: item.product_name,
            quantitySold: 0,
            revenue: 0,
          };
        }
        codProductSales[id].quantitySold += item.quantity || 1;
        codProductSales[id].revenue += (item.price || 0) * (item.quantity || 1);
      });
    });
    const codTopProducts = Object.values(codProductSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Order status breakdown
    const statusBreakdown = {};
    (orders || []).forEach(o => {
      statusBreakdown[o.status] = (statusBreakdown[o.status] || 0) + 1;
    });

    // Conversion rate: paid orders /ximated by total orders)
    const totalAllOrders = (orders || []).length;
    const conversionRate = totalAllOrders > 0
      ? ((totalOrders / totalAllOrders) * 100).toFixed(1)
      : '0.0';

    // App usage metrics
    const { data: totalListings } = await supabase
      .from('listings')
      .select('id', { count: 'exact', head: true });

    const { data: totalUsers } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true });

    res.json({
      period: days,
      summary: {
        totalRevenue: Math.round(totalRevenue),
        totalOrders,
        totalAllOrders,
        avgOrderValue: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
        conversionRate: parseFloat(conversionRate),
        totalListings: totalListings?.length || 0,
        totalUsers: totalUsers?.length || 0,
      },
      cod: {
        totalOrders: codOrders.length,
        totalCashAmount: Math.round(codRevenue),
        topProducts: codTopProducts,
      },
      statusBreakdown,
      topProducts,
      charts: {
        daily: dailyData,
        weekly: weeklyData,
        monthly: monthlyData,
      },
    });
  } catch (err) {
    console.error('[Analytics] Error:', err);
    res.status(500).json({ message: 'Analytics fetch failed', error: err.message });
  }
});

// ── Affiliate Program Admin Endpoints ────────────────────────────────

// Helper: require admin role
async function requireAdmin(req, res, next) {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    // Get auth token from Authorization header or Supabase auth cookie
    let token = null;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.headers.cookie) {
      // Look for sb-{project-ref}-auth-token cookie
      for (const c of req.headers.cookie.split(';')) {
        const eq = c.indexOf('=');
        const key = eq > 0 ? c.slice(0, eq).trim() : c.trim();
        const val = eq > 0 ? c.slice(eq + 1).trim() : '';
        if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
          try {
            const session = JSON.parse(decodeURIComponent(val));
            token = session.access_token || null;
          } catch { /* ignore malformed cookie */ }
          break;
        }
      }
    }

    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    // Verify token with Supabase Auth
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Unauthorized' });

    // Check admin role in profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('requireAdmin error:', err.message);
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// List all affiliates
app.get('/api/admin/affiliates', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('affiliates')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create affiliate
app.post('/api/admin/affiliates', requireAdmin, async (req, res) => {
  try {
    const { full_name, email, phone, mpesa_number, password } = req.body;
    if (!full_name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Full name, email, and password are required' });
    }

    // 1. Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role: 'affiliate' },
    });
    if (authError) throw new Error(authError.message);

    const userId = authData.user.id;

    // 2. Create profile with affiliate role
    const genRefCode = userId.replace(/-/g, '').slice(0, 8).toUpperCase();
    await supabase.from('profiles').upsert({
      id: userId,
      full_name,
      email,
      phone: phone || null,
      role: 'affiliate',
      referral_code: genRefCode,
    });

    // 3. Create affiliate record
    const code = `AFF-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const { data: affiliate, error: affError } = await supabase
      .from('affiliates')
      .insert({
        user_id: userId,
        full_name,
        email,
        phone: phone || null,
        mpesa_number: mpesa_number || null,
        referral_code: code,
        status: 'active',
      })
      .select()
      .single();

    if (affError) throw new Error(affError.message);

    // 4. Log the creation
    await supabase.from('affiliate_logs').insert({
      affiliate_id: affiliate.id,
      event_type: 'ACCOUNT_CREATED',
      details: { full_name, email, created_by: 'admin' },
    });

    res.json({ success: true, affiliate, referral_code: code });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update affiliate
app.patch('/api/admin/affiliates/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};
    if (req.body.full_name) updates.full_name = req.body.full_name;
    if (req.body.phone) updates.phone = req.body.phone;
    if (req.body.mpesa_number) updates.mpesa_number = req.body.mpesa_number;
    if (req.body.status) updates.status = req.body.status;

    const { data, error } = await supabase
      .from('affiliates')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await supabase.from('affiliate_logs').insert({
      affiliate_id: id,
      event_type: 'AFFILIATE_UPDATED',
      details: updates,
    });

    res.json({ success: true, affiliate: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Approve or reject affiliate application
app.patch('/api/admin/affiliates/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, notes } = req.body;

    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Action must be "approve" or "reject"' });
    }

    const newStatus = action === 'approve' ? 'active' : 'terminated';

    // Update affiliate status
    const updates = {
      status: newStatus,
      notes: notes || null,
    };

    if (action === 'approve') {
      updates.approved_at = new Date().toISOString();
      updates.approved_by = req.user.id;
    }

    const { data: affiliate, error } = await supabase
      .from('affiliates')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Update user profile role
    if (action === 'approve') {
      await supabase.from('profiles').update({ role: 'affiliate' }).eq('id', affiliate.user_id);
    } else {
      await supabase.from('profiles').update({ role: 'user' }).eq('id', affiliate.user_id);
    }

    // Log
    await supabase.from('affiliate_logs').insert({
      affiliate_id: id,
      event_type: action === 'approve' ? 'AFFILIATE_ACTIVATED' : 'AFFILIATE_DEACTIVATED',
      details: { action, notes, processed_by: req.user.id },
    });

    // ── Send email & in-app notification ──
    try {
      const affiliateData = affiliate;
      if (action === 'approve') {
        // Send approval email
        emailLib.sendAffiliateApproved({
          to: affiliateData.email,
          name: affiliateData.full_name,
          referralCode: affiliateData.referral_code,
          dashboardUrl: `${process.env.FRONTEND_URL || 'https://stor1-web.onrender.com'}/affiliate-dashboard`,
        });

        // In-app notification
        await supabase.from('notifications').insert({
          user_id: affiliateData.user_id,
          type: 'AFFILIATE_APPROVED',
          title: 'Affiliate Application Approved',
          body: `Congratulations ${affiliateData.full_name}! Your affiliate application has been approved. Start earning commissions now.`,
          url: '/affiliate-dashboard',
          tag: 'affiliate',
        });
      } else {
        // Send rejection email
        emailLib.sendAffiliateRejected({
          to: affiliateData.email,
          name: affiliateData.full_name,
        });

        // In-app notification
        await supabase.from('notifications').insert({
          user_id: affiliateData.user_id,
          type: 'AFFILIATE_REJECTED',
          title: 'Affiliate Application Update',
          body: `Your affiliate application has been reviewed. Please check your email for more details.`,
          url: null,
          tag: 'affiliate',
        });
      }
    } catch (notifErr) {
      console.error('[Affiliate Notify] Failed to send notification:', notifErr.message);
      // Non-blocking - do not fail the request
    }

    res.json({ success: true, affiliate });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Admin: Seller Management ─────────────────────────────────────

// GET /api/admin/sellers — list all sellers with filters
app.get('/api/admin/sellers', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });

    const { status, search, page = 1, limit = 50 } = req.query;
    let query = supabase
      .from('sellers')
      .select('*', { count: 'exact' });

    // Filter by status
    if (status && ['pending', 'approved', 'rejected', 'suspended'].includes(status)) {
      query = query.eq('status', status);
    }

    // Search by shop name
    if (search) {
      query = query.ilike('shop_name', `%${search}%`);
    }

    // Order and paginate
    query = query.order('created_at', { ascending: false });

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({
      success: true,
      sellers: data || [],
      total: count || 0,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil((count || 0) / limitNum),
    });
  } catch (err) {
    console.error('[Admin Sellers] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/sellers/:id/approve — approve a seller
app.post('/api/admin/sellers/:id/approve', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const { id } = req.params;

    const { data, error } = await supabase
      .from('sellers')
      .update({
        status: 'approved',
        is_verified: true,
        is_active: true,
        reviewed_by: req.user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ success: true, seller: data });
  } catch (err) {
    console.error('[Admin Sellers] Approve error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/sellers/:id/reject — reject a seller
app.post('/api/admin/sellers/:id/reject', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, error: 'Rejection reason is required.' });
    }

    const { data, error } = await supabase
      .from('sellers')
      .update({
        status: 'rejected',
        is_active: false,
        rejection_reason: reason.trim(),
        reviewed_by: req.user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ success: true, seller: data });
  } catch (err) {
    console.error('[Admin Sellers] Reject error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Calculate monthly commission for all affiliates via PG function
// POST /api/admin/commissions/calculate?year=2026&month=7
// Supports ?key=CRON_SECRET for scheduled cron jobs (no JWT expiry issue)
app.post('/api/admin/commissions/calculate', async (req, res) => {
  try {
    // Allow cron key auth for scheduled jobs
    const cronKey = req.query.key;
    const cronSecret = process.env.CRON_SECRET;
    if (cronKey && cronKey === cronSecret) {
      await handleCommissionCalc(req, res);
    } else {
      requireAdmin(req, res, async () => {
        await handleCommissionCalc(req, res);
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

async function handleCommissionCalc(req, res) {
  try {
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || (now.getMonth() + 1); // 1-indexed

    // Get all active affiliates
    const { data: affiliates, error: affError } = await supabase
      .from('affiliates')
      .select('id, full_name')
      .eq('status', 'active');

    if (affError) throw affError;

    if (!affiliates || affiliates.length === 0) {
      return res.json({ success: true, message: 'No active affiliates', commissions: [] });
    }

    const results = [];

    for (const affiliate of affiliates) {
      try {
        const { data: commissionId, error: rpcError } = await supabase
          .rpc('calculate_monthly_commission', {
            p_affiliate_id: affiliate.id,
            p_year: year,
            p_month: month,
          });

        if (rpcError) throw rpcError;

        if (commissionId) {
          const { data: record } = await supabase
            .from('monthly_commissions')
            .select('*')
            .eq('id', commissionId)
            .single();

          await supabase.from('affiliate_logs').insert({
            affiliate_id: affiliate.id,
            event_type: 'COMMISSION_CALCULATED',
            details: { year, month, commission_id: commissionId, total_sales: record?.total_sales, commission_amount: record?.commission_amount },
          });

          results.push(commissionId);
        } else {
          results.push(null);
        }
      } catch (err) {
        console.error(`Commission calc failed for affiliate ${affiliate.id}:`, err.message);
        results.push(null);
      }
    }

    // Fetch all updated commissions for the response
    const { data: commissions } = await supabase
      .from('monthly_commissions')
      .select('*, affiliates(full_name, email, referral_code)')
      .eq('year', year)
      .eq('month', month)
      .order('commission_amount', { ascending: false });

    res.json({
      success: true,
      message: `Calculated commissions for ${affiliates.length} affiliates`,
      commissions: commissions || [],
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// List monthly commissions
app.get('/api/admin/commissions', requireAdmin, async (req, res) => {
  try {
    const { year, month } = req.query;
    let query = supabase
      .from('monthly_commissions')
      .select('*, affiliates(full_name, email, referral_code)')
      .order('year', { ascending: false })
      .order('month', { ascending: false });

    if (year) query = query.eq('year', parseInt(year));
    if (month) query = query.eq('month', parseInt(month));

    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Approve commission
app.patch('/api/admin/commissions/:id/approve', requireAdmin, async (req, res) => {
  try {
    // Guard: only calculated commissions can be approved
    const { data: existing } = await supabase.from('monthly_commissions').select('status').eq('id', req.params.id).single();
    if (existing?.status !== 'calculated') return res.status(400).json({ success: false, error: `Cannot approve commission with status '${existing?.status}'. Must be 'calculated'.` });

    const { data, error } = await supabase
      .from('monthly_commissions')
      .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: req.user.id })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    await supabase.from('affiliate_logs').insert({
      affiliate_id: data.affiliate_id,
      event_type: 'COMMISSION_APPROVED',
      details: { commission_id: data.id, amount: data.commission_amount, month: data.month, year: data.year },
    });

    res.json({ success: true, commission: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Mark commission as paid
app.patch('/api/admin/commissions/:id/pay', requireAdmin, async (req, res) => {
  try {
    const { paystack_reference } = req.body;

    // Guard: only approved commissions can be marked paid
    const { data: existing } = await supabase.from('monthly_commissions').select('status').eq('id', req.params.id).single();
    if (existing?.status !== 'approved') return res.status(400).json({ success: false, error: `Cannot pay commission with status '${existing?.status}'. Must be 'approved'.` });

    const { data, error } = await supabase
      .from('monthly_commissions')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        paystack_reference: paystack_reference || null,
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    await supabase.from('affiliate_logs').insert({
      affiliate_id: data.affiliate_id,
      event_type: 'PAYOUT_EXECUTED',
      details: {
        commission_id: data.id, amount: data.commission_amount,
        month: data.month, year: data.year, reference: paystack_reference,
      },
    });

    res.json({ success: true, commission: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get audit logs
app.get('/api/admin/affiliate-logs', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('affiliate_logs')
      .select('*, affiliates(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(parseInt(req.query.limit) || 200);

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Alias: /api/admin/audit-logs → affiliate_logs table
app.get('/api/admin/audit-logs', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('affiliate_logs')
      .select('*, affiliates(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(parseInt(req.query.limit) || 50);

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Admin Payout Request Management ────────────────────────────

// List payout requests (admin)
app.get('/api/admin/payout-requests', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase
      .from('payout_requests')
      .select('*, affiliates(full_name, email, mpesa_number)')
      .order('created_at', { ascending: false })
      .limit(parseInt(req.query.limit) || 200);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Alias: /api/admin/payouts → payout_requests table (frontend compat)
app.get('/api/admin/payouts', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase
      .from('payout_requests')
      .select('*, affiliates(full_name, email, mpesa_number)')
      .order('created_at', { ascending: false })
      .limit(parseInt(req.query.limit) || 50);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Approve or reject a payout request (admin)
app.patch('/api/admin/payout-requests/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, admin_notes } = req.body;

    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Action must be "approve" or "reject"' });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    const updateFields = {
      status: newStatus,
      admin_notes: admin_notes || null,
    };

    // Approval sets approved_at/approved_by; rejection sets processed_at/processed_by
    if (action === 'approve') {
      updateFields.approved_at = new Date().toISOString();
      updateFields.approved_by = req.user.id;
    } else {
      updateFields.processed_at = new Date().toISOString();
      updateFields.processed_by = req.user.id;
    }

    const { data: payout, error } = await supabase
      .from('payout_requests')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Log the action
    await supabase.from('affiliate_logs').insert({
      affiliate_id: payout.affiliate_id,
      event_type: action === 'approve' ? 'PAYOUT_APPROVED' : 'PAYOUT_REJECTED',
      details: { payout_id: id, amount: payout.amount, admin_notes, [action === 'approve' ? 'approved_by' : 'processed_by']: req.user.id },
    });

    // Send payout confirmation email
    if (action === 'approve') {
      supabase.from('affiliates').select('email, full_name').eq('id', payout.affiliate_id).single()
        .then(({ data: aff }) => {
          if (aff?.email) {
            emailLib.sendPayoutConfirmation({
              to: aff.email,
              name: aff.full_name,
              amount: payout.amount,
              paymentMethod: payout.payment_method || 'M-Pesa',
              payoutDate: new Date().toISOString(),
            }).catch(err => console.warn('[Email] Payout confirmation failed:', err.message));
          }
        })
        .catch(err => console.warn('[Email] Could not fetch affiliate for payout email:', err.message));
    }

    res.json({ success: true, data: payout });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Public Affiliate API Routes ──────────────────────────────────

// Auth middleware — verifies user is logged in (any role)
async function requireAuth(req, res, next) {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.headers.cookie) {
      for (const c of req.headers.cookie.split(';')) {
        const eq = c.indexOf('=');
        const key = eq > 0 ? c.slice(0, eq).trim() : c.trim();
        const val = eq > 0 ? c.slice(eq + 1).trim() : '';
        if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
          try {
            const session = JSON.parse(decodeURIComponent(val));
            token = session.access_token || null;
          } catch { /* ignore */ }
          break;
        }
      }
    }

    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Unauthorized' });

    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// 1. GET /api/affiliate/profile/:userId — Get affiliate by user ID
app.get('/api/affiliate/profile/:userId', requireAuth, async (req, res) => {
  try {
    // IDOR guard: only the owner or an admin can view this profile
    if (req.params.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const { data, error } = await supabase
      .from('affiliates')
      .select('*')
      .eq('user_id', req.params.userId)
      .single();

    if (error && error.code === 'PGRST116') {
      return res.json({ success: true, data: null, message: 'Not an affiliate' });
    }
    if (error) throw error;

    // Calculate their tier
    let tierId = null;
    try {
      tierId = await supabase.rpc('calculate_affiliate_tier', { p_affiliate_id: data.id });
    } catch { /* function may not exist yet */ }

    res.json({ success: true, data: { ...data, current_tier_id: tierId?.data || null } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. GET /api/affiliate/profile/by-code/:code — Lookup by referral code
app.get('/api/affiliate/profile/by-code/:code', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('affiliates')
      .select('id, full_name, referral_code')
      .eq('referral_code', req.params.code)
      .eq('status', 'active')
      .single();

    if (error && error.code === 'PGRST116') {
      return res.json({ success: true, data: null });
    }
    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST /api/affiliate/link — Link user to affiliate (first-attribution wins)
app.post('/api/affiliate/link', requireAuth, async (req, res) => {
  try {
    const { referral_code } = req.body;
    if (!referral_code) return res.status(400).json({ error: 'referral_code required' });

    // Find the affiliate
    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('id, user_id')
      .eq('referral_code', referral_code)
      .eq('status', 'active')
      .single();

    if (!affiliate) return res.json({ success: false, message: 'Invalid referral code' });

    // Block self-referral
    if (affiliate.user_id === req.user.id) {
      return res.status(400).json({ success: false, error: 'Self-referral is not permitted' });
    }

    // Check existing referral (first-attribution: never overwrite)
    const { data: existing } = await supabase
      .from('referrals')
      .select('id')
      .eq('referred_user_id', req.user.id)
      .single();

    if (existing) {
      return res.json({ success: true, message: 'Already linked' });
    }

    // Create referral
    const { data: referral, error } = await supabase
      .from('referrals')
      .insert({
        affiliate_id: affiliate.id,
        referred_user_id: req.user.id,
        referral_code: referral_code,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;

    // Also update profiles.referred_by for backward compatibility
    await supabase.from('profiles').update({ referred_by: affiliate.id }).eq('id', req.user.id);

    // Log
    await supabase.from('affiliate_logs').insert({
      affiliate_id: affiliate.id,
      event_type: 'USER_LINKED',
      details: { referred_user_id: req.user.id, referral_code },
    });

    res.json({ success: true, data: referral });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3b. POST /api/affiliates/apply — Submit affiliate application (self-service)
// Supports both logged-in users and new users signing up with a password
app.post('/api/affiliates/apply', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const {
      full_name,
      phone,
      alternative_phone,
      email,
      password,
      physical_address,
      id_number,
      date_of_birth,
      mpesa_number,
      mpesa_account_name,
      promotional_methods,
      social_media_handles,
      how_heard,
      agreed,
    } = req.body;

    // ── Validation ──
    if (!full_name) return res.status(400).json({ success: false, error: 'Full name is required' });
    if (!phone) return res.status(400).json({ success: false, error: 'Phone number is required' });
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });
    if (!mpesa_number) return res.status(400).json({ success: false, error: 'M-Pesa payout number is required' });
    if (!agreed) return res.status(400).json({ success: false, error: 'You must agree to the Affiliate Partner Agreement' });

    // ── Resolve user — either from auth header or create new account ──
    let userId = null;

    // Check for existing auth token
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (!authError && user) {
        userId = user.id;
      }
    }

    // If no authenticated user, create one via admin API (requires password)
    if (!userId) {
      if (!password || password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'Password is required and must be at least 6 characters long.',
        });
      }

      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      });

      if (createError) {
        if (createError.message?.includes('already') || createError.code === 'email_exists') {
          return res.status(409).json({
            success: false,
            error: 'An account with this email already exists. Please sign in and then apply.',
          });
        }
        console.error('[Affiliate Apply] User creation error:', JSON.stringify(createError));
        return res.status(500).json({ success: false, error: 'Failed to create account. Please try again.' });
      }

      userId = newUser.user.id;

      // Create profile entry for the new user
      try {
        await supabase.from('profiles').insert({
          id: userId,
          email: email,
          full_name: full_name,
          role: 'user',
        });
      } catch (profileErr) {
        console.error('[Affiliate] Profile insert error:', profileErr?.message || profileErr);
      }
    }

    // Check for existing application for this user
    const { data: existing } = await supabase
      .from('affiliates')
      .select('id, status')
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        success: false,
        error: existing.status === 'pending'
          ? 'You already have a pending application. We will review it shortly.'
          : 'You are already registered as an affiliate partner.',
      });
    }

    // Generate unique referral code
    const refSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const referral_code = `AFF-${refSuffix}`;

    const insertData = {
      user_id: userId,
      full_name,
      phone,
      alternative_phone: alternative_phone || null,
      email,
      physical_address: physical_address || null,
      id_number: id_number || null,
      date_of_birth: date_of_birth || null,
      mpesa_number,
      mpesa_account_name: mpesa_account_name || null,
      promotional_methods: promotional_methods || [],
      social_media_handles: social_media_handles || null,
      how_heard: how_heard || null,
      referral_code,
      status: 'pending',
    };

    const { data: affiliate, error } = await supabase
      .from('affiliates')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      // Handle duplicate email gracefully
      if (error.message?.includes('affiliates_email_key') || error.code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'An affiliate with this email already exists.',
        });
      }
      throw error;
    }

    // Log the application
    await supabase.from('affiliate_logs').insert({
      affiliate_id: affiliate.id,
      event_type: 'AFFILIATE_APPLIED',
      details: { source: 'self-service', applied_at: new Date().toISOString() },
    });

    // Send credentials email (async — don't block response)
    if (password) {
      emailLib.sendAffiliateCredentials({
        to: email,
        name: full_name,
        email: email,
        loginUrl: `${process.env.FRONTEND_URL || 'https://stor1-web.onrender.com'}/login`,
      });
    }

    // Notify admin of new application
    emailLib.sendEmail({
      to: process.env.ADMIN_EMAIL || 'omixsystems@gmail.com',
      subject: `New Affiliate Application: ${full_name}`,
      html: `<p><strong>${full_name}</strong> has applied for the affiliate program.</p>
        <table cellpadding="6" style="font-size:14px;">
          <tr><td style="color:#71717a;">Email</td><td>${email}</td></tr>
          <tr><td style="color:#71717a;">Phone</td><td>${phone}</td></tr>
          <tr><td style="color:#71717a;">M-Pesa</td><td>${mpesa_number}</td></tr>
          <tr><td style="color:#71717a;">Location</td><td>${physical_address || '—'}</td></tr>
        </table>
        <p><a href="${process.env.FRONTEND_URL || 'https://stor1-web.onrender.com'}/admin/affiliates" style="background:#ff385c;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;">Review Application</a></p>`,
    }).catch(() => {});

    res.status(201).json({
      success: true,
      data: { id: affiliate.id, referral_code, status: 'pending' },
      message: 'Application submitted successfully. We will review your application and get back to you.',
    });
  } catch (err) {
    console.error('[Affiliate Apply] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. GET /api/affiliate/referrals/:affiliateId — Recent referrals
app.get('/api/affiliate/referrals/:affiliateId', requireAuth, async (req, res) => {
  try {
    // Ownership check: verify the authenticated user owns this affiliate
    const { data: affCheck } = await supabase.from('affiliates').select('user_id').eq('id', req.params.affiliateId).single();
    if (!affCheck || affCheck.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

    const { limit = 20 } = req.query;
    // Fetch referrals first (no FK join — Supabase schema cache missing relations)
    const { data: referrals, error } = await supabase
      .from('referrals')
      .select('*')
      .eq('affiliate_id', req.params.affiliateId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit) || 20);

    if (error) throw error;

    // Enrich with referred user profile info
    const enriched = await Promise.all((referrals || []).map(async (ref) => {
      let referredUser = null;
      if (ref.referred_user_id) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', ref.referred_user_id)
          .single();
        referredUser = prof;
      }

      let orderInfo = null;
      if (ref.first_order_id) {
        const { data: ord } = await supabase
          .from('omix_orders')
          .select('id, status, total_amount')
          .eq('id', ref.first_order_id)
          .single();
        orderInfo = ord;
      }

      return {
        ...ref,
        full_name: referredUser?.full_name || 'Customer',
        email: referredUser?.email || null,
        first_order: orderInfo,
      };
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. GET /api/affiliate/commissions/:affiliateId — Monthly commissions
app.get('/api/affiliate/commissions/:affiliateId', requireAuth, async (req, res) => {
  try {
    const { data: affCheck } = await supabase.from('affiliates').select('user_id').eq('id', req.params.affiliateId).single();
    if (!affCheck || affCheck.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

    const { limit = 12 } = req.query;
    const { data, error } = await supabase
      .from('monthly_commissions')
      .select('*, commission_order_details(order_id, order_amount, omix_orders(id, status))')
      .eq('affiliate_id', req.params.affiliateId)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(parseInt(limit) || 12);

    if (error) throw error;

    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. GET /api/affiliate/orders/:affiliateId — Qualifying orders (referred users' paid orders)
app.get('/api/affiliate/orders/:affiliateId', requireAuth, async (req, res) => {
  try {
    const { data: affCheck } = await supabase.from('affiliates').select('user_id').eq('id', req.params.affiliateId).single();
    if (!affCheck || affCheck.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
    const { limit = 20, status } = req.query;

    // Get referred user IDs
    const { data: referrals } = await supabase
      .from('referrals')
      .select('referred_user_id')
      .eq('affiliate_id', req.params.affiliateId);

    if (!referrals || referrals.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const userIds = referrals.map(r => r.referred_user_id);

    let query = supabase
      .from('omix_orders')
      .select('*, omix_order_items(product_name, quantity, price, product_id)')
      .in('user_id', userIds)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit) || 20);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. POST /api/affiliate/payout-request — Submit payout request
app.post('/api/affiliate/payout-request', requireAuth, async (req, res) => {
  try {
    const { affiliate_id, amount, mpesa_number, mpesa_name } = req.body;
    if (!affiliate_id || !amount || !mpesa_number) {
      return res.status(400).json({ error: 'affiliate_id, amount, and mpesa_number required' });
    }

    // Check min payout
    const { data: settings } = await supabase
      .from('affiliate_settings')
      .select('value')
      .eq('key', 'min_payout')
      .single();

    const minPayout = parseFloat(settings?.value || '2000');
    const parsedAmount = parseFloat(amount);

    if (parsedAmount < minPayout) {
      return res.status(400).json({
        error: `Minimum payout is KES ${minPayout.toLocaleString()}`,
        min_payout: minPayout,
      });
    }

    // Verify the affiliate belongs to this user
    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('id, user_id')
      .eq('id', affiliate_id)
      .single();

    if (!affiliate || affiliate.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { data, error } = await supabase
      .from('payout_requests')
      .insert({
        affiliate_id,
        amount: parsedAmount,
        mpesa_number,
        mpesa_name: mpesa_name || '',
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;

    await supabase.from('affiliate_logs').insert({
      affiliate_id,
      event_type: 'PAYOUT_REQUESTED',
      details: { amount: parsedAmount, mpesa_number, request_id: data.id },
    });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. GET /api/affiliate/payouts/:affiliateId — Payout history
app.get('/api/affiliate/payouts/:affiliateId', requireAuth, async (req, res) => {
  try {
    const { data: affCheck } = await supabase.from('affiliates').select('user_id').eq('id', req.params.affiliateId).single();
    if (!affCheck || affCheck.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('payout_requests')
      .select('*')
      .eq('affiliate_id', req.params.affiliateId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. GET /api/affiliate/tiers — Get tier definitions
app.get('/api/affiliate/tiers', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('affiliate_tiers')
      .select('*')
      .order('level', { ascending: true });

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. GET /api/affiliate/dashboard/:affiliateId — Aggregated dashboard stats
app.get('/api/affiliate/dashboard/:affiliateId', requireAuth, async (req, res) => {
  try {
    const affiliateId = req.params.affiliateId;
    const { data: affCheck } = await supabase.from('affiliates').select('user_id').eq('id', affiliateId).single();
    if (!affCheck || affCheck.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-indexed
    const monthStart = new Date(currentYear, currentMonth - 1, 1).toISOString();
    const monthEnd = new Date(currentYear, currentMonth, 1).toISOString();

    // Get affiliate info with tier
    const { data: affiliate, error: affError } = await supabase
      .from('affiliates')
      .select('*')
      .eq('id', affiliateId)
      .maybeSingle();

    if (affError) throw affError;
    if (!affiliate) return res.status(404).json({ error: 'Affiliate not found' });

    // Referral counts
    const { data: referrals } = await supabase
      .from('referrals')
      .select('status')
      .eq('affiliate_id', affiliateId);

    const totalReferrals = referrals?.length || 0;
    const convertedReferrals = referrals?.filter(r => r.status === 'converted').length || 0;

    // Click counts
    const { data: clicks } = await supabase
      .from('referral_clicks')
      .select('id', { count: 'exact', head: true })
      .eq('affiliate_id', affiliateId);

    const totalClicks = clicks?.length || 0;

    // Current month sales from referred users
    const referredUserIds = referrals?.filter(r => r.status === 'converted').map(r => r.referred_user_id) || [];
    let monthlySales = 0;
    let monthlyOrders = 0;

    if (referredUserIds.length > 0) {
      const { data: orders } = await supabase
        .from('omix_orders')
        .select('total_amount')
        .in('user_id', referredUserIds)
        .in('status', ['paid', 'completed', 'delivered'])
        .gte('created_at', monthStart)
        .lt('created_at', monthEnd);

      monthlySales = orders?.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0) || 0;
      monthlyOrders = orders?.length || 0;
    }

    // Latest commission record (may not exist yet for new affiliates)
    const { data: latestCommission, error: lcError } = await supabase
      .from('monthly_commissions')
      .select('*')
      .eq('affiliate_id', affiliateId)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lcError) throw lcError;

    // Commission totals by status
    const { data: allCommissions } = await supabase
      .from('monthly_commissions')
      .select('status, commission_amount')
      .eq('affiliate_id', affiliateId);

    const totalPendingCommission = (allCommissions || [])
      .filter(c => c.status === 'pending' || c.status === 'approved')
      .reduce((s, c) => s + parseFloat(c.commission_amount || 0), 0);

    const totalPaidCommission = (allCommissions || [])
      .filter(c => c.status === 'paid')
      .reduce((s, c) => s + parseFloat(c.commission_amount || 0), 0);

    // Determine current tier
    let currentTier = { id: 1, name: 'Silver', level: 1, commission_rate: 0.05, bonus_rate: 0 };
    try {
      const tierId = await supabase.rpc('calculate_affiliate_tier', { p_affiliate_id: affiliateId });
      if (tierId?.data) {
        const { data: tierData } = await supabase
          .from('affiliate_tiers')
          .select('*')
          .eq('id', tierId.data)
          .single();
        if (tierData) currentTier = tierData;
      }
    } catch { /* use default */ }

    // Next tier
    const { data: allTiers } = await supabase
      .from('affiliate_tiers')
      .select('*')
      .order('level', { ascending: true });

    const nextTier = allTiers?.find(t => t.level === currentTier.level + 1) || null;

    // Progress to next tier
    let progress = null;
    if (nextTier) {
      const { data: yearOrders } = await supabase
        .from('omix_orders')
        .select('total_amount')
        .in('user_id', referredUserIds)
        .in('status', ['paid', 'completed', 'delivered']);
      const totalYearlySales = yearOrders?.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0) || 0;
      const totalYearlyOrders = yearOrders?.length || 0;

      progress = {
        current_orders: totalYearlyOrders,
        required_orders: nextTier.min_orders,
        current_sales: totalYearlySales,
        required_sales: nextTier.min_sales,
        orders_pct: nextTier.min_orders > 0 ? Math.min(100, Math.round((totalYearlyOrders / nextTier.min_orders) * 100)) : 100,
        sales_pct: nextTier.min_sales > 0 ? Math.min(100, Math.round((totalYearlySales / nextTier.min_sales) * 100)) : 100,
      };
    }

    res.json({
      success: true,
      data: {
        affiliate,
        currentTier,
        nextTier,
        progress,
        stats: {
          totalReferrals,
          convertedReferrals,
          conversionRate: totalReferrals > 0 ? Math.round((convertedReferrals / totalReferrals) * 100) : 0,
          totalClicks,
          monthlySales: Math.round(monthlySales),
          monthlyOrders,
        },
        latestCommission,
        totalPendingCommission,
        totalPaidCommission,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. POST /api/affiliate/log-click — Log referral click (no auth required)
app.post('/api/affiliate/log-click', async (req, res) => {
  try {
    const { affiliate_id, referral_code, page_url } = req.body;
    if (!referral_code && !affiliate_id) {
      return res.status(400).json({ error: 'referral_code or affiliate_id required' });
    }

    // If only referral_code provided, look up the affiliate
    let resolvedAffiliateId = affiliate_id;
    if (!resolvedAffiliateId && referral_code) {
      const { data: aff } = await supabase
        .from('affiliates')
        .select('id')
        .eq('referral_code', referral_code)
        .eq('status', 'active')
        .single();
      if (aff) resolvedAffiliateId = aff.id;
    }

    if (!resolvedAffiliateId) {
      return res.status(404).json({ error: 'Affiliate not found' });
    }

    const { data, error } = await supabase
      .from('referral_clicks')
      .insert({
        affiliate_id: resolvedAffiliateId,
        referral_code: referral_code || '',
        ip_address: req.headers['x-forwarded-for'] || req.ip,
        user_agent: req.headers['user-agent'] || null,
        page_url: page_url || null,
        converted: false,
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Review Management API ──

// GET /api/product-reviews?listing_id=X - Get reviews for a listing (public)
app.get('/api/product-reviews', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const { listing_id } = req.query;
    if (!listing_id) {
      return res.status(400).json({ error: 'listing_id query parameter is required' });
    }

    const { data, error } = await supabase
      .from('product_reviews')
      .select(`*`)
      .eq('listing_id', listing_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Fetch display names for each review's user_id
    if (data && data.length > 0) {
      const userIds = [...new Set(data.map(r => r.user_id))];
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', userIds);
      if (!pErr && profiles) {
        const nameMap = Object.fromEntries(profiles.map(p => [p.id, p.display_name]));
        data.forEach(r => {
          r.display_name = nameMap[r.user_id] || 'Anonymous';
        });
      } else {
        data.forEach(r => { r.display_name = 'Anonymous'; });
      }
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/product-reviews/admin - Get all reviews with listing info (admin only)
app.get('/api/product-reviews/admin', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const status = req.query.status;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('product_reviews')
      .select(`*`, { count: 'exact' });

    if (status && ['approved', 'pending', 'flagged'].includes(status)) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Enrich with display names and listing titles
    if (data && data.length > 0) {
      const userIds = [...new Set(data.map(r => r.user_id))];
      const listingIds = [...new Set(data.map(r => r.listing_id))];
      const [profilesRes, listingsRes] = await Promise.allSettled([
        supabase.from('profiles').select('id, display_name').in('id', userIds),
        supabase.from('listings').select('id, title').in('id', listingIds),
      ]);
      const nameMap = {};
      if (profilesRes.status === 'fulfilled' && profilesRes.value.data) {
        profilesRes.value.data.forEach(p => { nameMap[p.id] = p.display_name; });
      }
      const titleMap = {};
      if (listingsRes.status === 'fulfilled' && listingsRes.value.data) {
        listingsRes.value.data.forEach(l => { titleMap[l.id] = l.title; });
      }
      data.forEach(r => {
        r.display_name = nameMap[r.user_id] || 'Anonymous';
        r.listing_title = titleMap[r.listing_id] || 'Unknown';
      });
    }

    res.json({
      success: true,
      data: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/product-reviews/:id - Delete a review (admin only)
app.delete('/api/product-reviews/:id', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const { id } = req.params;
    const { data, error } = await supabase
      .from('product_reviews')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Review not found' });
      }
      throw error;
    }

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/product-reviews/:id - Update review status (admin only)
app.patch('/api/product-reviews/:id', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['approved', 'flagged', 'hidden'].includes(status)) {
      return res.status(400).json({ error: 'Valid status is required (approved, flagged, or hidden)' });
    }

    const { data, error } = await supabase
      .from('product_reviews')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Review not found' });
      }
      throw error;
    }

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/product-reviews - Submit a review (authenticated)
app.post('/api/product-reviews',
  requireAuth,
  [
    body('listing_id').notEmpty().withMessage('listing_id is required').isUUID().withMessage('listing_id must be a valid UUID'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('rating must be an integer between 1 and 5'),
    body('review').isString().trim().isLength({ min: 1, max: 2000 }).withMessage('review must be 1-2000 characters'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array().map(e => e.msg).join(', ') });
      }

      if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

      const { listing_id, rating, review } = req.body;
      const userId = req.user.id;

      const { data, error } = await supabase
        .from('product_reviews')
        .insert({
          listing_id,
          user_id: userId,
          rating,
          review: review.trim(),
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

// ── Flash Deals API ──

// GET /api/flash-deals/active - Get currently active deals with their items
app.get('/api/flash-deals/active', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const { data: deals, error: dErr } = await supabase
      .from('flash_deals')
      .select('*')
      .eq('is_active', true)
      .lte('start_at', new Date().toISOString())
      .gte('end_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (dErr) throw dErr;

    if (!deals || deals.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Get items for all active deals
    const dealIds = deals.map(d => d.id);
    const { data: items, error: iErr } = await supabase
      .from('deal_items')
      .select(`
        *,
        listing:listings!inner(title, images, price)
      `)
      .in('deal_id', dealIds);

    if (iErr) throw iErr;

    // Group items by deal_id
    const itemsByDeal = {};
    for (const item of items || []) {
      if (!itemsByDeal[item.deal_id]) itemsByDeal[item.deal_id] = [];
      itemsByDeal[item.deal_id].push(item);
    }

    const result = deals.map(deal => ({
      ...deal,
      items: itemsByDeal[deal.id] || [],
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/flash-deals - Get all deals (admin only) for management
app.get('/api/flash-deals', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const { data, error } = await supabase
      .from('flash_deals')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get items for all deals
    const dealIds = (data || []).map(d => d.id);
    if (dealIds.length > 0) {
      const { data: items, error: iErr } = await supabase
        .from('deal_items')
        .select('*')
        .in('deal_id', dealIds);

      if (!iErr && items) {
        const itemsByDeal = {};
        for (const item of items) {
          if (!itemsByDeal[item.deal_id]) itemsByDeal[item.deal_id] = [];
          itemsByDeal[item.deal_id].push(item);
        }
        for (const deal of data) {
          deal.items = itemsByDeal[deal.id] || [];
        }
      }
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/flash-deals - Create deal (admin only)
app.post('/api/flash-deals', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const { title, description, banner_url, start_at, end_at, is_active } = req.body;

    if (!title || !start_at || !end_at) {
      return res.status(400).json({ error: 'title, start_at, and end_at are required' });
    }

    const { data, error } = await supabase
      .from('flash_deals')
      .insert({
        title,
        description: description || null,
        banner_url: banner_url || null,
        start_at,
        end_at,
        is_active: is_active !== undefined ? is_active : true,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/flash-deals/:id - Update deal (admin only)
app.put('/api/flash-deals/:id', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const { id } = req.params;
    const { title, description, banner_url, start_at, end_at, is_active } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (banner_url !== undefined) updates.banner_url = banner_url;
    if (start_at !== undefined) updates.start_at = start_at;
    if (end_at !== undefined) updates.end_at = end_at;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabase
      .from('flash_deals')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/flash-deals/:id - Delete deal (admin only)
app.delete('/api/flash-deals/:id', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const { id } = req.params;

    // Delete items first (CASCADE should handle this, but be explicit)
    await supabase.from('deal_items').delete().eq('deal_id', id);

    const { error } = await supabase
      .from('flash_deals')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/deal-items - Add item to deal (admin only)
app.post('/api/deal-items', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const { deal_id, listing_id, deal_price, discount_percent, max_quantity } = req.body;

    if (!deal_id || !listing_id) {
      return res.status(400).json({ error: 'deal_id and listing_id are required' });
    }

    const { data, error } = await supabase
      .from('deal_items')
      .insert({
        deal_id,
        listing_id,
        deal_price: deal_price || null,
        discount_percent: discount_percent || null,
        max_quantity: max_quantity || 0,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/deal-items/:id - Remove item from deal (admin only)
app.delete('/api/deal-items/:id', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const { id } = req.params;
    const { error } = await supabase
      .from('deal_items')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Chat / Messages API ──

// GET /api/conversations - list conversations for the current user (admin sees all, buyer sees own)
app.get('/api/conversations', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const userId = req.user.id;

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    // Get conversation IDs this user participates in (admin sees all)
    let partQuery = supabase
      .from('conversation_participants')
      .select('conversation_id');

    if (!profile || profile.role !== 'admin') {
      partQuery = partQuery.eq('user_id', userId);
    }

    const { data: participations, error: partErr } = await partQuery;
    if (partErr) throw partErr;

    const convIds = [...new Set((participations || []).map(p => p.conversation_id))];
    if (convIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .in('id', convIds)
      .order('last_message_at', { ascending: false, nulls: 'last' });

    if (error) throw error;

    // Enrich with participant info
    const enriched = await Promise.all((data || []).map(async (conv) => {
      const { data: participants } = await supabase
        .from('conversation_participants')
        .select('user_id, profiles:user_id(full_name, avatar_url, email)')
        .eq('conversation_id', conv.id);

      return {
        ...conv,
        participants: (participants || []).map(p => ({
          user_id: p.user_id,
          full_name: p.profiles?.full_name || null,
          avatar_url: p.profiles?.avatar_url || null,
          email: p.profiles?.email || null,
        })),
      };
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/conversations - create a new conversation
app.post('/api/conversations', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const userId = req.user.id;
    const { participant_id, subject } = req.body;

    if (!participant_id) {
      return res.status(400).json({ error: 'participant_id is required' });
    }

    if (participant_id === userId) {
      return res.status(400).json({ error: 'Cannot create conversation with yourself' });
    }

    // Validate participant exists
    const { data: participant, error: pErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', participant_id)
      .single();

    if (pErr || !participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    // Create the conversation
    const { data: conv, error: cErr } = await supabase
      .from('conversations')
      .insert({
        subject: (subject || '').toString().substring(0, 255),
        created_by: userId,
      })
      .select()
      .single();

    if (cErr) throw cErr;

    // Add both participants
    const { error: cpErr } = await supabase
      .from('conversation_participants')
      .insert([
        { conversation_id: conv.id, user_id: userId },
        { conversation_id: conv.id, user_id: participant_id },
      ]);

    if (cpErr) throw cpErr;

    res.status(201).json({ success: true, data: conv });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/conversations/unread-count - get unread count for current user
app.get('/api/conversations/unread-count', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const userId = req.user.id;

    const { count, error } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .neq('sender_id', userId)
      .is('read_at', null);

    if (error) throw error;

    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/conversations/:id/messages - get messages for a conversation
app.get('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const userId = req.user.id;
    const conversationId = req.params.id;

    // Verify user is a participant
    const { data: part, error: pErr } = await supabase
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (pErr) throw pErr;
    if (!part) {
      return res.status(403).json({ error: 'Not a participant of this conversation' });
    }

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/conversations/:id/messages - send a message in a conversation
app.post('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const userId = req.user.id;
    const conversationId = req.params.id;
    const { content } = req.body;

    if (!content || !content.toString().trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Verify user is a participant
    const { data: part, error: pErr } = await supabase
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (pErr) throw pErr;
    if (!part) {
      return res.status(403).json({ error: 'Not a participant of this conversation' });
    }

    const contentStr = content.toString().substring(0, 5000);

    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: userId,
        content: contentStr,
      })
      .select()
      .single();

    if (error) throw error;

    // Update conversation metadata
    const preview = contentStr.substring(0, 100);
    await supabase
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: preview,
      })
      .eq('id', conversationId);

    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/conversations/:id/read - mark all messages in conversation as read for current user
app.patch('/api/conversations/:id/read', requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
    const userId = req.user.id;
    const conversationId = req.params.id;

    // Verify user is a participant
    const { data: part, error: pErr } = await supabase
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (pErr) throw pErr;
    if (!part) {
      return res.status(403).json({ error: 'Not a participant of this conversation' });
    }

    // Mark unread messages from other users as read
    const { data, error } = await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .neq('sender_id', userId)
      .is('read_at', null)
      .select();

    if (error) throw error;

    res.json({ success: true, data, updated: (data || []).length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Store Profile API ──────────────────────────────────────────────────
// GET /api/store/profile - Public, returns store settings
app.get('/api/store/profile', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });

    const { data, error } = await supabase
      .from('store_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      // Return defaults if no row exists yet
      return res.json({
        store_name: 'Omix Store',
        tagline: "Kericho's Premier Tech Marketplace",
        description: 'Omix Store is Kericho\'s trusted destination for quality electronics and gadgets.',
        logo_url: '',
        banner_url: '',
        phone: '+254 768 213 649',
        email: 'omixsystems@gmail.com',
        address: 'Kericho, Kenya',
        whatsapp: '+254 768 213 649',
        total_orders: 0,
        satisfaction_rate: 0,
        member_since: '2024-01-15',
        response_time: 'Under 1 hour',
        is_verified: true,
      });
    }

    res.json(data);
  } catch (err) {
    console.error('[Store Profile] GET error:', err.message);
    res.status(500).json({ error: 'Failed to fetch store profile', details: err.message });
  }
});

// PUT /api/store/profile - Admin only, update store settings
app.put('/api/store/profile', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });

    const allowedFields = [
      'store_name', 'tagline', 'description', 'logo_url', 'banner_url',
      'phone', 'email', 'address', 'whatsapp',
      'total_orders', 'satisfaction_rate', 'response_time', 'is_verified',
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Get the first row's ID
    const { data: existing } = await supabase
      .from('store_settings')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (!existing) {
      // Insert first row with updates merged with defaults
      const insertData = {
        store_name: 'Omix Store',
        tagline: "Kericho's Premier Tech Marketplace",
        ...updates,
      };
      const { data: inserted, error: insertError } = await supabase
        .from('store_settings')
        .insert(insertData)
        .select()
        .single();

      if (insertError) throw insertError;
      return res.json(inserted);
    }

    const { data, error } = await supabase
      .from('store_settings')
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('[Store Profile] PUT error:', err.message);
    res.status(500).json({ error: 'Failed to update store profile', details: err.message });
  }
});

// ── Tracking Events API ──────────────────────────────────────────────

// GET /api/orders/:id/tracking - Return tracking events for an order, ordered by created_at ASC
app.get('/api/orders/:id/tracking', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });

    const { id } = req.params;
    const { data, error } = await supabase
      .from('tracking_events')
      .select('*')
      .eq('order_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[Tracking] GET error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tracking events', details: err.message });
  }
});

// POST /api/admin/orders/:id/status - Admin updates order status + creates tracking event
app.post('/api/admin/orders/:id/status',
  requireAdmin,
  [
    param('id').isUUID().withMessage('Order ID must be a valid UUID'),
    body('status').isString().notEmpty().isIn(['pending', 'processing', 'shipped', 'delivered', 'cancelled'])
      .withMessage('Status must be one of: pending, processing, shipped, delivered, cancelled'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array().map(e => e.msg).join(', ') });
      }

      if (!supabase) return res.status(503).json({ error: 'Database not available' });

      const { id } = req.params;
      const { status, note } = req.body;

      const validStatuses = ['pending', 'cod_pending', 'processing', 'shipped', 'delivered', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      }

    // Update the order status
    const { error: orderError } = await supabase
      .from('omix_orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (orderError) throw orderError;

    // Create a tracking event
    const { error: trackingError } = await supabase
      .from('tracking_events')
      .insert({
        order_id: id,
        status,
        note: note || null,
      });

    if (trackingError) throw trackingError;

    console.log(`[Tracking] Order ${id.slice(0, 8)} status updated to ${status}`);

    // Send order status update email (fire-and-forget)
    supabase.from('omix_orders').select('email, customer_name').eq('id', id).single()
      .then(({ data: orderData }) => {
        if (orderData?.email && status !== 'pending') {
          emailLib.sendOrderStatusUpdate({
            to: orderData.email,
            orderId: id,
            status,
            customerName: orderData.customer_name || undefined,
          }).catch((err) => console.warn('[Email] Order status email failed:', err.message));
        }
      })
      .catch((err) => console.warn('[Email] Could not fetch order for status email:', err.message));

    res.json({ success: true, status, note: note || null });
  } catch (err) {
    console.error('[Tracking] POST admin error:', err.message);
    res.status(500).json({ error: 'Failed to update order status', details: err.message });
  }
});

// ── Product Recommendations ──────────────────────────────────────

// GET /api/products/:id/recommendations - Up to 6 same-category listings, excluding current
app.get('/api/products/:id/recommendations', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });
    const { id } = req.params;

    // Look up the product's category
    const { data: product, error: productErr } = await supabase
      .from('listings')
      .select('category_id, category')
      .eq('id', id)
      .single();

    if (productErr || !product) {
      // Fallback: random active listings
      const { data: fallback } = await supabase
        .from('listings')
        .select('id, title, price, images, slug, category')
        .eq('status', 'active')
        .limit(6);
      return res.json({ recommendations: fallback || [] });
    }

    const categoryId = product.category_id;
    const categoryName = product.category;

    // Get total count of same-category listings (excluding current)
    let countQuery = supabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .neq('id', id);

    if (categoryId != null) {
      countQuery = countQuery.eq('category_id', categoryId);
    } else if (categoryName) {
      countQuery = countQuery.eq('category', categoryName);
    }

    const { count } = await countQuery;

    if (!count || count === 0) {
      // Fallback: random active listings
      const { data: fallback } = await supabase
        .from('listings')
        .select('id, title, price, images, slug, category')
        .eq('status', 'active')
        .limit(6);
      return res.json({ recommendations: fallback || [] });
    }

    // Pick 6 random listings from the pool using random offset
    const limit = Math.min(count, 6);
    const maxStart = count - limit;
    const start = maxStart > 0 ? Math.floor(Math.random() * (maxStart + 1)) : 0;

    let query = supabase
      .from('listings')
      .select('id, title, price, images, slug, category')
      .eq('status', 'active')
      .neq('id', id);

    if (categoryId != null) {
      query = query.eq('category_id', categoryId);
    } else if (categoryName) {
      query = query.eq('category', categoryName);
    }

    query = query.order('id', { ascending: true }).range(start, start + limit - 1);

    const { data } = await query;
    return res.json({ recommendations: data || [] });
  } catch (err) {
    console.error('[Recommendations] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch recommendations', details: err.message });
  }
});

// GET /api/recommendations/trending - Top 6 most ordered products (30 days)
app.get('/api/recommendations/trending', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffISO = cutoff.toISOString();

    // Aggregate order items by product_id, count occurrences
    const { data: orderItems, error: itemsErr } = await supabase
      .from('omix_order_items')
      .select('product_id, quantity')
      .gte('created_at', cutoffISO);

    if (itemsErr) throw itemsErr;

    if (orderItems && orderItems.length > 0) {
      // Count orders per product
      const productCounts = {};
      orderItems.forEach(item => {
        const pid = item.product_id;
        if (pid) {
          productCounts[pid] = (productCounts[pid] || 0) + (parseInt(item.quantity) || 1);
        }
      });

      // Sort by count descending, take top 6
      const topIds = Object.entries(productCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([id]) => id);

      if (topIds.length > 0) {
        const { data: products } = await supabase
          .from('listings')
          .select('id, title, price, images, slug, category')
          .in('id', topIds)
          .eq('status', 'active');

        if (products && products.length > 0) {
          // Preserve the trending order
          const sorted = topIds
            .map(id => products.find(p => String(p.id) === String(id)))
            .filter(Boolean);
          return res.json({ recommendations: sorted });
        }
      }
    }

    // Fallback: random active listings
    const { data: fallback } = await supabase
      .from('listings')
      .select('id, title, price, images, slug, category')
      .eq('status', 'active')
      .limit(6);

    return res.json({ recommendations: fallback || [] });
  } catch (err) {
    console.error('[Recommendations] Trending error:', err.message);
    res.status(500).json({ error: 'Failed to fetch trending', details: err.message });
  }
});

// ── Sitemap XML Endpoint ──────────────────────────────────────────────
app.get('/api/sitemap.xml', async (req, res) => {
  const siteUrl = process.env.SITE_URL || 'https://market.omixsystems.store';
  const today = new Date().toISOString().split('T')[0];

  // Static pages
  const staticPages = [
    { loc: '/', priority: '1.0', changefreq: 'daily' },
    { loc: '/how-it-works', priority: '0.8', changefreq: 'monthly' },
    { loc: '/about', priority: '0.7', changefreq: 'monthly' },
    { loc: '/privacy', priority: '0.5', changefreq: 'monthly' },
    { loc: '/terms', priority: '0.5', changefreq: 'monthly' },
    { loc: '/help', priority: '0.6', changefreq: 'monthly' },
    { loc: '/help/shopping-guide', priority: '0.6', changefreq: 'monthly' },
    { loc: '/help/refund', priority: '0.6', changefreq: 'monthly' },
    { loc: '/help/delivery', priority: '0.6', changefreq: 'monthly' },
    { loc: '/help/faq', priority: '0.6', changefreq: 'monthly' },
    { loc: '/help/payment', priority: '0.6', changefreq: 'monthly' },
    { loc: '/wishlist', priority: '0.5', changefreq: 'weekly' },
    { loc: '/compare', priority: '0.5', changefreq: 'weekly' },
    { loc: '/flash-deals', priority: '0.8', changefreq: 'daily' },
    { loc: '/wholesale', priority: '0.6', changefreq: 'weekly' },
    { loc: '/search', priority: '0.7', changefreq: 'daily' },
    { loc: '/affiliate', priority: '0.5', changefreq: 'monthly' },
    { loc: '/refurbished', priority: '0.6', changefreq: 'weekly' },
    { loc: '/install', priority: '0.4', changefreq: 'monthly' },
  ];

  try {
    let urls = staticPages.map(p => `
  <url>
    <loc>${siteUrl}${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('');

    // Dynamic product URLs from active listings
    if (supabase) {
      const { data: listings, error } = await supabase
        .from('listings')
        .select('id, title, updated_at, category_id')
        .eq('status', 'active');

      if (!error && listings?.length) {
        urls += listings.map(l => {
          const lastmod = l.updated_at ? new Date(l.updated_at).toISOString().split('T')[0] : today;
          return `
  <url>
    <loc>${siteUrl}/listing/${l.id}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`;
        }).join('');
      }
    }

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>`;

    res.set('Content-Type', 'application/xml');
    res.send(sitemap);
  } catch (err) {
    console.error('[Sitemap] Error:', err.message);
    res.status(500).type('text/plain').send('Failed to generate sitemap');
  }
});

// ── AI Product Comparison Endpoint ─────────────────────────────────────
const COMPARE_MODELS = [
  'Qwen/Qwen2.5-72B-Instruct',
  'microsoft/Phi-3.5-mini-instruct',
];

// Rate limit: 10 requests per minute per IP
const compareLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many comparison requests, please try again in a moment.' }
});

app.post('/api/compare', compareLimiter, async (req, res) => {
  const { product_ids } = req.body;

  if (!product_ids || !Array.isArray(product_ids) || product_ids.length < 2 || product_ids.length > 3) {
    return res.status(400).json({ error: 'Provide 2 or 3 product IDs in product_ids array' });
  }

  try {
    if (!supabase) return res.status(503).json({ error: 'Database not available' });

    const { data: products, error: prodErr } = await supabase
      .from('listings')
      .select('id, title, description, price, images, brand, condition, avg_rating, review_count, category_id, features, specifications')
      .in('id', product_ids)
      .eq('status', 'active');

    if (prodErr) throw prodErr;
    if (!products || products.length < 2) {
      return res.status(404).json({ error: 'Could not find enough active products for comparison' });
    }

    const apiKey = process.env.HF_API_KEY;

    // Build a natural language comparison prompt (~300 words)
    const productDescriptions = products.map((p, i) => {
      const features = p.features ? (Array.isArray(p.features) ? p.features.join(', ') : String(p.features)) : 'N/A';
      const specs = p.specifications ? (typeof p.specifications === 'object' ? JSON.stringify(p.specifications) : String(p.specifications)) : 'N/A';
      const rating = p.avg_rating ? `${p.avg_rating}/5 (${p.review_count || 0} reviews)` : 'No ratings yet';
      return `Product ${i + 1}: ${p.title}
  - Price: KES ${Number(p.price).toLocaleString()}
  - Brand: ${p.brand || 'N/A'}
  - Condition: ${p.condition || 'N/A'}
  - Rating: ${rating}
  - Description: ${(p.description || '').substring(0, 200)}
  - Features: ${features.substring(0, 200)}
  - Specifications: ${specs.substring(0, 200)}`;
    }).join('\n\n');

    const comparePrompt = `You are a friendly Kenyan shopping assistant helping a customer compare products on Omix Store. Write a natural, conversational "This or That" comparison of the products below. Do NOT use markdown, bullet lists, or tables. Write in plain, flowing sentences using simple Kenyan English. Keep it to about 300 words max. Highlight the key differences (price, quality, features, value) and give a clear, helpful recommendation.

Products to compare:
${productDescriptions}

Write a short, warm comparison in plain text. End with a clear "Verdict:" recommending which product is better for most people and why.`;

    // If no HF API key, generate a simple server-side comparison
    if (!apiKey) {
      const comparison = generateFallbackComparison(products);
      return res.json({ comparison, products });
    }

    const hfClient = new InferenceClient(apiKey);

    for (const model of COMPARE_MODELS) {
      try {
        const completion = await hfClient.chatCompletion({
          model,
          messages: [
            { role: 'system', content: 'You are a friendly Kenyan shopping assistant. Respond in plain text without markdown formatting.' },
            { role: 'user', content: comparePrompt },
          ],
          max_tokens: 500,
          temperature: 0.7,
        });

        const msg = completion?.choices?.[0]?.message || {};
        let content = msg?.content?.trim?.();

        if (!content && msg?.reasoning_content) {
          content = msg.reasoning_content.trim();
        }

        if (!content) {
          console.warn(`[Compare] Model ${model} returned empty, trying next...`);
          continue;
        }

        // Strip any remaining markdown symbols
        content = content.replace(/\*/g, '').replace(/#{1,6}\s?/g, '').replace(/_{2,}/g, '').replace(/`/g, '').trim();

        console.log(`[Compare] Responded via ${model}`);
        return res.json({ comparison: content, products });
      } catch (err) {
        console.warn(`[Compare] Model ${model} error: ${err.message}, trying next...`);
      }
    }

    // All AI models failed — fallback to server-side comparison
    console.warn('[Compare] All AI models failed, using fallback comparison');
    const comparison = generateFallbackComparison(products);
    return res.json({ comparison, products });

  } catch (err) {
    console.error('[Compare] Error:', err.message);
    // Last-resort fallback
    try {
      const comparison = generateFallbackComparison(products || []);
      return res.json({ comparison, products: products || [] });
    } catch {
      return res.status(500).json({ error: 'Comparison failed', details: err.message });
    }
  }
});

// Server-side fallback: generates a simple spec-based comparison
function generateFallbackComparison(products) {
  if (!products || products.length < 2) return 'Not enough products to compare.';

  const lines = [];
  lines.push(`Let me compare the ${products.map(p => p.title).join(' vs ')} for you.\n`);

  // Price comparison
  const sortedByPrice = [...products].sort((a, b) => Number(a.price) - Number(b.price));
  lines.push(`On price: ${sortedByPrice[0].title} is the most affordable at KES ${Number(sortedByPrice[0].price).toLocaleString()}, while ${sortedByPrice[sortedByPrice.length - 1].title} costs KES ${Number(sortedByPrice[sortedByPrice.length - 1].price).toLocaleString()}.`);

  // Rating comparison
  const ratedProducts = products.filter(p => p.avg_rating != null);
  if (ratedProducts.length >= 2) {
    const topRated = [...ratedProducts].sort((a, b) => (b.avg_rating || 0) - (a.avg_rating || 0))[0];
    lines.push(`For customer satisfaction, ${topRated.title} leads with ${topRated.avg_rating}/5 from ${topRated.review_count || 0} reviews.`);
  }

  // Brand & condition
  const brands = products.map(p => p.brand).filter(Boolean);
  if (brands.length) lines.push(`Brands: ${[...new Set(brands)].join(', ')}.`);
  const conditions = [...new Set(products.map(p => p.condition).filter(Boolean))];
  if (conditions.length) lines.push(`Condition options: ${conditions.join(', ')}.`);

  // Recommendation
  const bestValue = sortedByPrice[0];
  lines.push(`\nVerdict: If you are watching your budget, ${bestValue.title} at KES ${Number(bestValue.price).toLocaleString()} is your best bet.`);

  return lines.join('\n');
}

// Global error handler — catches anything express-async-errors forwards
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err?.message || err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// API-only: no SPA fallback — unmatched routes return 404 JSON

app.listen(PORT, () => {
  console.log(`🚀 Omix API server running on port ${PORT}`);
  console.log(`   Paystack: ${PAYSTACK_SECRET?.startsWith('sk_live') ? 'PRODUCTION' : 'TEST'}`);
  console.log(`   Subaccount: ${OMIX_SUBACCOUNT_CODE || 'Not configured'}`);
});
// CRON_SECRET pick up marker
