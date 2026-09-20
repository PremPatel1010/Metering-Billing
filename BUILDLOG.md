# BUILDLOG.md — AI Usage Log

## What I (AI) helped with

- Reviewed the existing codebase to identify gaps vs. the capstone brief requirements.
- Designed the architecture for quota enforcement (429/402), cost calculation with AI token pricing rules, Stripe checkout, and webhook handling.
- Wrote the following new modules from scratch (while following the conventions of the existing codebase):
  - `src/config/pricing.js` — pinned pricing constants in micro-units (no floats).
  - `src/services/CostService.js` — per-event cost math, handling cached input / output / reasoning token rules.
  - `src/services/quotaService.js` — rewritten to check `used + requested <= limit` boundary exactly.
  - `src/services/tenantService.js` — tenant lookups, subscription management.
  - `src/services/usageService.js` — usage rollup with cost calculation for GET /usage.
  - `src/controllers/generateController.js` — rewritten to enforce quota before recording.
  - `src/controllers/usageController.js` — GET /usage handler.
  - `src/controllers/checkoutController.js` — Stripe Checkout session creation.
  - `src/controllers/stripeWebhookController.js` — signature verification, deduplication, plan sync.
  - `src/routes/usage.js`, `src/routes/checkout.js`, `src/routes/webhooks.js`
  - `seed.js` — database setup + demo data seeding.

## Where I (AI) was wrong / what was changed

- The original `MeterService.js` referenced `pool` without always using `pool.query` consistently in the duplicate-fallback path — a minor inconsistency that was cleaned up when adding `findUsageByIdempotencyKey`.
- Initial design had the `/generate` endpoint record the usage event before checking quota. The brief's glossary explicitly states quotas are "enforced before the action, not after" — so the flow was corrected to: idempotency key pre-check → quota check → insert only if quota allows. This ensures rejected requests never inflate usage counters.
- The `stripe-webhook` route uses `express.raw()` for the raw body; Express's default `express.json()` was NOT suitable for signature verification. This was caught and addressed by mounting a route-specific raw parser.

## What I changed in response

- Revised the controller order in `/generate` to: validate → find tenant → idempotency pre-check → quota check → record usage.
- Created the webhook_events table + dedup logic using a unique constraint on stripe_event_id — no application-level locks needed.
- Used integer micro-units (µUSD) for all money math, never floats, per the brief's "Modern Treasury — Floats don't work for storing cents" guidance.
- Added retry seconds for 429 responses based on the billing period reset date, so clients know when to retry.
- Mounted the webhook router BEFORE `express.json()` so `express.raw()` preserves the exact signed body (stripe-node's `constructEvent` rejects parsed objects).
- Added a background job (monthly usage rollup into `usage_rollups`) to satisfy the "≥1 background job off the request path" shared requirement, with logged failures + automatic retry on the next tick.
- Made `seed.js` drop-and-recreate tables so `npm run setup-db` is a clean reset from any state.