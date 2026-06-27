// Omix Paystack API Server
// Handles Paystack inline payment initialization, verification, webhook, and split payments
// Deploy to Render/Railway/Fly.io as a separate service

import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import email from './lib/email.js';

const app = express();
app.use(cors({
  origin: ['https://stor1-web.onrender.com', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
}));
app.use(express.json());

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
app.post('/api/nia/chat', async (req, res) => {
  const apiKey = process.env.VITE_OPENCODE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI service not configured' });

  const { messages, model = 'mimo-v2.5-free' } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Messages required' });

  try {
    const resp = await fetch('https://opencode.ai/zen/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are Nia, the Omix Store assistant in Kericho, Kenya. Help with products, orders, M-Pesa payments (Paystack STK Push), delivery. Be concise (under 80 words). Never make up info. Offer human support (omixsystems@gmail.com / +254 768 213 649) if unsure.' },
          ...messages,
        ],
        max_tokens: 500,
        temperature: 0.7,
        reasoning_effort: 'none',
      }),
    });
    if (!resp.ok) return res.status(502).json({ error: 'AI service error' });
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content?.trim() || null;
    if (!content) return res.status(502).json({ error: 'Empty AI response' });
    res.json({ content });
  } catch (err) {
    console.error('[Nia]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
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
            .select('id, status, email, customer_name, total, area, landmark, order_items')
            .eq('id', metadata.order_id)
            .single();

          if (existing && existing.status !== 'paid') {
            await supabase
              .from('omix_orders')
              .update({ status: 'paid', paystack_reference: reference, paid_at: new Date().toISOString() })
              .eq('id', metadata.order_id);
            console.log(`Order ${metadata.order_id} marked as paid`);
          } else if (existing?.status === 'paid') {
            console.log(`Order ${metadata.order_id} already paid, skipping update`);
          }

          // Send order confirmation email
          if (existing?.email) {
            const items = typeof existing.order_items === 'string'
              ? JSON.parse(existing.order_items)
              : (existing.order_items || []);

            email.sendOrderConfirmation({
              to: existing.email,
              orderId: existing.id,
              items,
              total: existing.total,
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

app.listen(PORT, () => {
  console.log(`🚀 Omix API server running on port ${PORT}`);
  console.log(`   Paystack: ${PAYSTACK_SECRET?.startsWith('sk_live') ? 'PRODUCTION' : 'TEST'}`);
  console.log(`   Subaccount: ${OMIX_SUBACCOUNT_CODE || 'Not configured'}`);
});
