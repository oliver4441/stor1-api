// Omix Paystack API Server
// Handles Paystack inline payment initialization, verification, webhook, and split payments
// Deploy to Render/Railway/Fly.io as a separate service

import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fetch from 'node-fetch';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import email from './lib/email.js';

const app = express();
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: ['https://stor1-web.onrender.com', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

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
// Runs DDL migrations using the Supabase Management API (service_role key)
(async function runMigrations() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return;

  const projectRef = process.env.SUPABASE_URL?.match(/https:\/\/([^.]+)/)?.[1];
  if (!projectRef) return;

  const mgmtApiUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

  async function runSql(description, query) {
    try {
      const res = await fetch(mgmtApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ query }),
      });
      if (res.ok) {
        console.log(`[Migration] ${description} ✅`);
        return true;
      } else {
        const text = await res.text().catch(() => 'unknown error');
        console.warn(`[Migration] ${description} failed: ${text}`);
        return false;
      }
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

  await runSql(
    'seed affiliate tiers',
    `INSERT INTO public.affiliate_tiers (name, level, min_orders, min_sales, commission_rate, bonus_rate, description)
     VALUES
       ('Bronze', 1, 0, 0, 0.0300, 0, 'Entry tier - 3% commission'),
       ('Silver', 2, 5, 50000, 0.0500, 0.0050, '5+ orders, 50K KES sales - 5% commission + 0.5% bonus'),
       ('Gold', 3, 20, 250000, 0.0800, 0.0100, '20+ orders, 250K KES sales - 8% commission + 1% bonus'),
       ('Platinum', 4, 50, 1000000, 0.1200, 0.0200, '50+ orders, 1M KES sales - 12% commission + 2% bonus')
     ON CONFLICT (name) DO NOTHING;`
  );

  await runSql(
    'seed affiliate settings',
    `INSERT INTO public.affiliate_settings (key, value, description)
     VALUES
       ('min_payout', '"2000"', 'Minimum payout threshold in KES'),
       ('referral_reward_type', '"points"', 'Reward type: points or cash'),
       ('referral_reward_value', '"1"', 'Default referral reward value'),
       ('commission_period', '"monthly"', 'Commission calculation period'),
       ('attribution_model', '"last_touch"', 'Attribution model for referrals'),
       ('cookie_expiry_days', '"30"', 'Referral cookie expiration in days'),
       ('cookie_consent_required', '"true"', 'Whether cookie consent is required'),
       ('mpesa_b2c_active', '"false"', 'Whether M-Pesa B2C payouts are active'),
       ('tier_upgrade_frequency', '"monthly"', 'How often tiers are recalculated'),
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

  console.log('[Migration] All startup migrations completed');
})();

if (!PAYSTACK_SECRET) {
  console.error('PAYSTACK_SECRET_KEY not set!');
  process.exit(1);
}

const paystackHeaders = {
  Authorization: `Bearer ${PAYSTACK_SECRET}`,
  'Content-Type': 'application/json',
};

// ── Health check ──
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'omix-api', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'omix-api' });
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
- **Browse & Search:** All products on home page, search bar to find items.
- **Wishlist:** Tap heart icon to save items. View at /wishlist.
- **Promo Codes:** Enter at checkout for discounts.
- **Order Tracking:** Track at /track-order or in Account page.
- **Referral Program:** Unique referral link in Account. Both get KES 100 off.
- **Loyalty Points:** 1 point per KES 100 spent. 100 points = KES 50 off.
- **PWA Install:** Customers can install the app from browser.

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

// Free model list with fallbacks (verified working order)
// nemotron-3-ultra-free and north-mini-code-free produce actual content reliably
// deepseek-v4-flash-free is a reasoning model (content is empty, only reasoning_content exists)
const NIA_MODELS = [
  'nemotron-3-ultra-free',
  'north-mini-code-free',
  'deepseek-v4-flash-free',
];

app.post('/api/nia/chat', async (req, res) => {
  const apiKey = process.env.OPENCODE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI service not configured' });

  const { messages, userId, pageContext, cartItems } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Messages required' });

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

  // Try each model in order until one works
  for (const model of NIA_MODELS) {
    try {
      const resp = await fetch('https://opencode.ai/zen/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'OmixStore-Nia/1.0',
          'HTTP-Referer': 'https://omixsystems.store',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: contextPrompt },
            ...messages,
          ],
          max_tokens: 600,
          temperature: 0.7,
        }),
      });

      if (!resp.ok) {
        console.warn(`[Nia] Model ${model} returned ${resp.status}, trying next...`);
        continue;
      }

      const data = await resp.json();
      const msg = data?.choices?.[0]?.message || {};
      // Some models put reasoning in reasoning_content and leave content empty
      let content = msg?.content?.trim();
      if (!content && msg?.reasoning_content) {
        content = msg.reasoning_content.trim();
      }
      if (!content) {
        console.warn(`[Nia] Model ${model} returned empty, trying next...`);
        continue;
      }

      // Strip any markdown symbols that leaked through
      content = content.replace(/\*/g, '').replace(/#{1,6}\s?/g, '').replace(/_{2,}/g, '').replace(/`/g, '').trim();

      console.log(`[Nia] Responded via ${model}`);
      res.json({ content });
      return;
    } catch (err) {
      console.warn(`[Nia] Model ${model} error: ${err.message}, trying next...`);
    }
  }

  // All models failed
  res.status(502).json({ error: 'All AI models unavailable. Please try again.' });
});

// ── Initialize Paystack Inline Payment ─────────────────────────────────────────
app.post('/api/paystack/initialize', async (req, res) => {
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
app.post('/api/paystack/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const body = req.body;

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
                    .from('omix_listings')
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
                      .from('omix_listings')
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

            // Enrich items with variant info (size/color)
            const itemsForEmail = (orderItems || []).map(item => ({
              ...item,
              name: item.product_name + (item.variant?.size ? ` (${item.variant.size})` : '') + (item.variant?.colorName ? ` — ${item.variant.colorName}` : ''),
            }));

            email.sendOrderConfirmation({
              to: existing.email,
              orderId: existing.id,
              items: itemsForEmail,
              total: existing.total_amount,
              customerName: existing.customer_name,
              deliveryArea: existing.area,
              deliveryLandmark: existing.landmark,
            }).catch(err => console.error('[Email] Order confirmation failed:', err.message));
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
            email.sendPaymentFailed({
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
    const { to, name } = req.body;
    if (!to) return res.status(400).json({ message: 'Email address required' });

    const result = await email.sendWelcomeEmail({ to, name });
    res.json({ success: result.sent, message: result.sent ? 'Welcome email sent' : 'Welcome email skipped (no API key)' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send welcome email', error: err.message });
  }
});

// Send referral reward notification
app.post('/api/email/referral-reward', requireApiKey, async (req, res) => {
  try {
    const { to, referralCode, rewardAmount, customerName } = req.body;
    if (!to) return res.status(400).json({ message: 'Email address required' });

    const result = await email.sendReferralReward({ to, referralCode, rewardAmount, customerName });
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

    const result = await email.sendOrderStatusUpdate({ to, orderId, status, customerName });
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

    const result = await email.sendPriceDropAlert({ to, productName, productUrl, oldPrice, newPrice, productImage });
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

    const result = await email.sendBackInStockAlert({ to, productName, productUrl, price });
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

    const result = await email.sendAbandonedCartReminder({ to, items, total, customerName });
    res.json({ success: result.sent, message: result.sent ? 'Abandoned cart reminder sent' : 'Abandoned cart reminder skipped (no API key)' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send abandoned cart reminder', error: err.message });
  }
});

// ── Create subaccount (for organizers to receive payouts) ──
app.post('/api/paystack/subaccount', requireApiKey, async (req, res) => {
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

// ── Admin SQL endpoint (temporary — delete after migrations applied) ──
app.post('/api/admin/sql', requireApiKey, async (req, res) => {
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
app.get('/api/admin/analytics', requireApiKey, async (req, res) => {
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
      .from('omix_listings')
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
      .select('*, profiles(full_name, email, role)')
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

// Calculate monthly commission for all affiliates
// POST /api/admin/commissions/calculate?year=2026&month=6
app.post('/api/admin/commissions/calculate', requireAdmin, async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth(); // 0-indexed

    const monthStart = new Date(year, month, 1).toISOString();
    const monthEnd = new Date(year, month + 1, 1).toISOString();

    // Get all active affiliates
    const { data: affiliates } = await supabase
      .from('affiliates')
      .select('*')
      .eq('status', 'active');

    if (!affiliates || affiliates.length === 0) {
      return res.json({ success: true, message: 'No active affiliates', commissions: [] });
    }

    const commissions = [];

    for (const affiliate of affiliates) {
      // Get referred user IDs
      const { data: referredUsers } = await supabase
        .from('profiles')
        .select('id')
        .eq('referred_by', affiliate.id);

      const userIds = (referredUsers || []).map(u => u.id);
      if (userIds.length === 0) continue;

      // Get qualified orders in this month
      const { data: orders } = await supabase
        .from('omix_orders')
        .select('id, total_amount, status')
        .in('user_id', userIds)
        .gte('created_at', monthStart)
        .lt('created_at', monthEnd)
        .in('status', ['paid', 'completed', 'delivered']);

      if (!orders || orders.length === 0) continue;

      const totalSales = orders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
      const orderCount = orders.length;

      // Determine tier and rate
      // Count total qualified sales in current year
      const yearStart = new Date(year, 0, 1).toISOString();
      const { data: yearOrders } = await supabase
        .from('omix_orders')
        .select('id')
        .in('user_id', userIds)
        .gte('created_at', yearStart)
        .lt('created_at', monthEnd)
        .in('status', ['paid', 'completed', 'delivered']);

      const yearlyCount = (yearOrders || []).length;
      const tier = yearlyCount >= 30 ? 'gold' : 'silver';
      const rate = tier === 'gold' ? 0.10 : 0.05;
      const commissionAmount = Math.round(totalSales * rate);

      // Upsert commission record
      const { data: existing } = await supabase
        .from('monthly_commissions')
        .select('id')
        .eq('affiliate_id', affiliate.id)
        .eq('year', year)
        .eq('month', month + 1)
        .single();

      let commission;
      if (existing) {
        const { data: updated } = await supabase
          .from('monthly_commissions')
          .update({
            total_sales: totalSales,
            qualified_order_count: orderCount,
            commission_rate: rate,
            commission_amount: commissionAmount,
          })
          .eq('id', existing.id)
          .select()
          .single();
        commission = updated;
      } else {
        const { data: inserted } = await supabase
          .from('monthly_commissions')
          .insert({
            affiliate_id: affiliate.id,
            year,
            month: month + 1,
            total_sales: totalSales,
            qualified_order_count: orderCount,
            commission_rate: rate,
            commission_amount: commissionAmount,
          })
          .select()
          .single();
        commission = inserted;
      }

      // Store individual order details for audit
      const orderDetails = orders.map(o => ({
        commission_id: commission.id,
        order_id: o.id,
        order_amount: o.total_amount,
      }));

      if (orderDetails.length > 0) {
        // Clear previous order links, then insert fresh
        await supabase.from('commission_order_details').delete().eq('commission_id', commission.id);
        await supabase.from('commission_order_details').insert(orderDetails);
      }

      // Log the calculation
      await supabase.from('affiliate_logs').insert({
        affiliate_id: affiliate.id,
        event_type: 'COMMISSION_CALCULATED',
        details: { year, month: month + 1, totalSales, orderCount, rate, commissionAmount },
      });

      commissions.push(commission);
    }

    res.json({ success: true, commissions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
    const { data, error } = await supabase
      .from('monthly_commissions')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
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
      .limit(200);

    if (error) throw error;
    res.json({ success: true, data: data || [] });
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
    const { data, error } = await supabase
      .from('affiliates')
      .select('*, affiliate_tiers(name, level, commission_rate, bonus_rate, description)')
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

// 3. POST /api/affiliate/link — Link user to affiliate (last-touch attribution)
app.post('/api/affiliate/link', requireAuth, async (req, res) => {
  try {
    const { referral_code } = req.body;
    if (!referral_code) return res.status(400).json({ error: 'referral_code required' });

    // Find the affiliate
    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('id')
      .eq('referral_code', referral_code)
      .eq('status', 'active')
      .single();

    if (!affiliate) return res.json({ success: false, message: 'Invalid referral code' });

    // Check existing referral
    const { data: existing } = await supabase
      .from('referrals')
      .select('id')
      .eq('referred_user_id', req.user.id)
      .single();

    if (existing) {
      return res.json({ success: true, message: 'Already linked' });
    }

    // Create referral (last-touch)
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

// 4. GET /api/affiliate/referrals/:affiliateId — Recent referrals
app.get('/api/affiliate/referrals/:affiliateId', requireAuth, async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const { data, error } = await supabase
      .from('referrals')
      .select('*, profiles(full_name, email), omix_orders!referrals_first_order_id_fkey(id, status, total_amount)')
      .eq('affiliate_id', req.params.affiliateId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit) || 20);

    if (error) throw error;

    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. GET /api/affiliate/commissions/:affiliateId — Monthly commissions
app.get('/api/affiliate/commissions/:affiliateId', requireAuth, async (req, res) => {
  try {
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
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-indexed
    const monthStart = new Date(currentYear, currentMonth - 1, 1).toISOString();
    const monthEnd = new Date(currentYear, currentMonth, 1).toISOString();

    // Get affiliate info with tier
    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('*, affiliate_tiers(name, level, commission_rate, bonus_rate, description)')
      .eq('id', affiliateId)
      .single();

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

    // Latest commission record
    const { data: latestCommission } = await supabase
      .from('monthly_commissions')
      .select('*')
      .eq('affiliate_id', affiliateId)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(1)
      .single();

    // Determine current tier
    let currentTier = { id: 1, name: 'Bronze', level: 1, commission_rate: 0.03, bonus_rate: 0 };
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

app.listen(PORT, () => {
  console.log(`🚀 Omix API server running on port ${PORT}`);
  console.log(`   Paystack: ${PAYSTACK_SECRET?.startsWith('sk_live') ? 'PRODUCTION' : 'TEST'}`);
  console.log(`   Subaccount: ${OMIX_SUBACCOUNT_CODE || 'Not configured'}`);
});
