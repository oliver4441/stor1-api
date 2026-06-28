// Omix Paystack API Server
// Handles Paystack inline payment initialization, verification, webhook, and split payments
// Deploy to Render/Railway/Fly.io as a separate service

import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fetch from 'node-fetch';
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

## CHIPS FORMAT
Every response must end with a line containing only:
CHIPS: <chip1> | <chip2> | <chip3>

Choose 2-4 chips. Default: Browse products | Track my order | Contact support`;

// Free model list with fallbacks
const NIA_MODELS = [
  'opencode/deepseek-v4-flash-free',
  'opencode/mimo-v2.5-free',
  'opencode/qwen3.6-plus-free',
  'opencode/minimax-m3-free',
  'opencode/nemotron-3-ultra-free',
  'opencode/north-mini-code-free',
];

app.post('/api/nia/chat', async (req, res) => {
  const apiKey = process.env.OPENCODE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI service not configured' });

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Messages required' });

  // Try each model in order until one works
  for (const model of NIA_MODELS) {
    try {
      const resp = await fetch('https://api.opencode.ai/v1/chat/completions', {
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
            { role: 'system', content: NIA_SYSTEM_PROMPT },
            ...messages,
          ],
          max_tokens: 500,
          temperature: 0.7,
        }),
      });

      if (!resp.ok) {
        console.warn(`[Nia] Model ${model} returned ${resp.status}, trying next...`);
        continue;
      }

      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content?.trim() || null;
      if (!content) {
        console.warn(`[Nia] Model ${model} returned empty, trying next...`);
        continue;
      }

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
            // Fetch order items for email
            const { data: orderItems } = await supabase
              .from('omix_order_items')
              .select('product_name, price, quantity, variant')
              .eq('order_id', metadata.order_id);

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

        const response = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'TTL': '86400',
          },
          body: pushPayload,
        });

        if (response.ok || response.status === 201) {
          sent++;
        } else if (response.status === 410 || response.status === 404) {
          // Subscription expired — delete from DB
          failed++;
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint);
        } else {
          failed++;
        }
      } catch {
        failed++;
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

app.listen(PORT, () => {
  console.log(`🚀 Omix API server running on port ${PORT}`);
  console.log(`   Paystack: ${PAYSTACK_SECRET?.startsWith('sk_live') ? 'PRODUCTION' : 'TEST'}`);
  console.log(`   Subaccount: ${OMIX_SUBACCOUNT_CODE || 'Not configured'}`);
});
