# Review Instructions — Omix Store Backend API

## What Important means here
Reserve Important (red) for findings that would:
- Break payment processing (Paystack initialization, verification, webhook handling, split payments)
- Cause incorrect financial calculations (commission computation, payout amounts, order totals)
- Leak sensitive data (Paystack secret keys, Supabase service role key, user PII in logs or error messages)
- Break auth middleware (requireAuth, requireAdmin, requireApiKey logic)
- Introduce SQL injection or NoSQL injection (especially in `/api/admin/sql` and raw queries)
- Cause data loss (incorrect order status transitions, deletion without verification)
- Break the webhook processing path (charge.success, customeridentification)

Style, code organization, variable naming, and refactoring suggestions are Nit at most.

## Cap the nits
Report at most five Nits per review. If you found more, say "plus N similar items" in the summary. If everything you found is a Nit, lead with "No blocking issues."

## Do not report
- Comment quality or documentation style
- Missing tests (no test suite exists yet)
- Line length or formatting issues
- Anything CI already enforces (Node syntax check via `node -c`)
- Unused variable warnings that existed before the PR
- Helper function extraction suggestions (monolith file is by design)

## Always check
- New API routes have appropriate rate limiting and auth middleware
- Database queries are scoped (no unbounded SELECT * without LIMIT)
- Paystack webhook signature verification is correct (HMAC-SHA256)
- Order status transitions follow the valid flow (no skipping from pending to delivered)
- New amount/price fields are validated as positive numbers
- Error responses don't leak internal details (stack traces, env var names)
- Migrations are idempotent (IF NOT EXISTS / IF EXISTS patterns)
- Affiliate commission calculations use the correct tier percentage
- Payout approval/rejection sets the correct timestamp fields
- No hardcoded secrets or API keys in source code

## Verification bar
Findings about logic errors need a code path citation — show the exact lines that would produce the wrong behavior. Do not flag based on variable naming or comments alone.

## Re-review convergence
After the first review, suppress new Nits and post Important findings only — unless the PR touches payment, auth, or financial calculation logic, in which case run a full review.
