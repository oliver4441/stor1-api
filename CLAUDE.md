# Omix Store Backend API (stor1-api)

## Project Overview
Express.js backend for Omix Store e-commerce marketplace. Handles Paystack payments, Supabase admin operations, affiliate commissions, email notifications, Nia AI chat, push notifications, and order management. Deployed on Render.

## Tech Stack
- **Runtime**: Node.js 20+ (ESM modules, `"type": "module"`)
- **Framework**: Express 4 with Helmet, CORS, rate limiting
- **Database**: Supabase (PostgreSQL) via `@supabase/supabase-js`
- **Payments**: Paystack API (M-Pesa via STK push, inline, split payments)
- **Email**: Resend API via `./lib/email.js`
- **AI**: HuggingFace Inference (Nia AI chatbot for product Q&A)
- **Push**: web-push (VAPID) for browser notifications

## Key Architecture
- **Single entry**: `server.js` (~5000 lines) — all routes, middleware, and migrations in one file
- **Supabase client**: Service role key for admin ops, anon key for public queries
- **Auth middleware**: `requireAuth` (validates Supabase session), `requireAdmin` (checks admin role), `requireApiKey` (checks API key header)
- **Migrations**: Idempotent `ADD COLUMN IF NOT EXISTS` run on startup (M10 migration pattern)
- **Cron**: Commission calculation uses `exec_sql` RPC (not HTTP CRON_SECRET)

## Key Routes
| Route | Purpose |
|-------|---------|
| `POST /api/paystack/initialize` | Initiate M-Pesa STK push |
| `POST /api/paystack/webhook` | Paystack charge.success/customeridentification |
| `POST /api/auth/signup` | Registration with optional affiliate refCode |
| `POST /api/affiliates/apply` | Affiliate application |
| `PATCH /api/admin/affiliates/:id/approve` | Approve/reject affiliate |
| `POST /api/admin/sql` | Admin SQL console (requireAdmin) |
| `POST /api/nia/chat` | Nia AI product Q&A |
| `POST /api/admin/orders/:id/status` | Order status transitions |
| `GET /api/orders/:id/tracking` | Customer order tracking |

## Database Tables
`listings`, `omix_orders`, `omix_order_items`, `sellers`, `affiliates`, `affiliate_commissions`, `payouts`, `promo_codes`, `profiles`, `product_reviews`, `flash_deals`, `conversations`

## Conventions
- **ESM only** — no `require()`, use `import/export`
- **Idempotent migrations** — always use `ADD COLUMN IF NOT EXISTS`, never drop columns without verification
- **Input sanitization** — XSS protection strips HTML tags from all request bodies
- **Env vars** set in Render Dashboard — never read from .env files in production
- **Rate limited** — `/api/` routes: 100 req/15min per IP

## Order Statuses
`pending`, `cod_pending`, `paid`, `processing`, `shipped`, `delivered`, `cancelled`, `payment_failed`

## Affiliate Program
- Tiers: Silver 5%, Gold 10%
- First-touch attribution, 100-year cookie
- Commission DB function: `calculate_monthly_commission()`
- Payout approval: sets `approved_at`/`approved_by`; reject sets `processed_at`/`processed_by`

## Deployment
- Render: `https://stor1-api.onrender.com/`
- Start: `node server.js`
- Health check: `GET /health`
- Env vars set in Render Dashboard — PUT API replaces all vars, never rely on GET to discover vars
