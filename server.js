// Omix Paystack API Server
// Handles Paystack STK push initialization, verification, webhook, and split payments
// Deploy to Render/Railway/Fly.io as a separate service

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json());

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC = process.env.PAYSTACK_PUBLIC_KEY;
const OMIX_SUBACCOUNT_CODE = process.env.OMIX_SUBACCOUNT_CODE; // Your Paystack subaccount for receiving commissions
const PORT = process.env.PORT || 3001;

if (!PAYSTACK_SECRET) {
  console.error('PAYSTACK_SECRET_KEY not set!');
  process.exit(1);
}

const paystackHeaders = {
  Authorization: `Bearer ${PAYSTACK_SECRET}`,
  'Content-Type': 'application/json',
};

// ── Health check ──
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'omix-api' });
});

// ── Initialize STK Push with Split Payment ──
app.post('/api/paystack/initialize', async (req, res) => {
  try {
    const { order_id, email, amount, phone, callback_url } = req.body;

    if (!email || !amount || !phone) {
      return res.status(400).json({ message: 'Missing required fields: email, amount, phone' });
    }

    // Build Paystack payload
    // Transaction charges paid by buyer (charges_api: false means buyer pays)
    const payload = {
      email,
      amount: Math.round(amount * 100), // Paystack expects amount in cents/kobo
      currency: 'KES',
      callback_url: callback_url || `${process.env.FRONTEND_URL || 'https://stor1-web.onrender.com'}/events/order/callback`,
      metadata: { order_id },
      channels: ['mobile_money'],
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

    // Verify webhook signature in production
    // const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(body).digest('hex');
    // if (hash !== signature) return res.status(401).json({ message: 'Invalid signature' });

    const event = JSON.parse(body.toString());

    console.log('Paystack webhook:', event.event, event.data.reference);

    if (event.event === 'charge.success' || event.event === 'transfer.success') {
      const { reference, status, metadata } = event.data;

      if (metadata?.order_id && status === 'success') {
        console.log(`✅ Payment confirmed for order ${metadata.order_id}`);
        // The frontend polling handles the rest, but you could also:
        // - Send email confirmation
        // - Update Supabase directly via service role
        // - Trigger push notification
      }
    }

    // Always return 200 to Paystack
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).send('OK'); // Still return 200 to prevent retries
  }
});

// ── Create subaccount (for organizers to receive payouts) ──
app.post('/api/paystack/subaccount', async (req, res) => {
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
