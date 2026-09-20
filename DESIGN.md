# Design Document — Usage Metering & Billing Engine

## 1. Problem Statement

This system meters API usage for a multi-tenant SaaS product and enforces
subscription-based quotas. Tenants are on either a Free or Pro plan, each
with a defined monthly limit (Free = 1,000 API calls / 100k AI tokens;
Pro = 5,000 API calls / 1M AI tokens). Every billable action is recorded as
a usage event; once a tenant reaches their plan's quota, further requests are
rejected with a clear error (429 / 402) until they upgrade or the billing
period resets. Stripe test mode handles upgrades (Checkout) and plan sync
(signature-verified, deduplicated webhooks).

## 2. Data Model

```sql
CREATE TYPE plan AS ENUM ('free', 'pro');

CREATE TABLE tenants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(25) NOT NULL,
    email VARCHAR(25) NOT NULL,
    current_plan plan DEFAULT 'free',
    stripe_customer_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE usage_events (
    id SERIAL PRIMARY KEY,
    tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
    type VARCHAR(50),
    quantity INT CHECK (quantity >= 0),
    metadata JSONB DEFAULT '{}',
    idempotency_key VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_usage_events_tenant_type_month
  ON usage_events (tenant_id, type, created_at);

CREATE TABLE subscriptions (
    id SERIAL PRIMARY KEY,
    tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
    stripe_subscription_id VARCHAR(255) UNIQUE,
    status VARCHAR(25) NOT NULL,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE webhook_events (
    id SERIAL PRIMARY KEY,
    stripe_event_id VARCHAR(255) UNIQUE NOT NULL,
    type VARCHAR(100) NOT NULL,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 3. API Surface

| Method | Route                 | Purpose |
|--------|-----------------------|---------|
| POST   | `/generate`           | Dummy billable endpoint — validates, enforces quota, records an idempotent usage event, returns cost |
| GET    | `/usage/:tenantId`    | Returns a tenant's current usage, plan limits, and calculated cost for the billing period |
| POST   | `/checkout`           | Creates a Stripe Checkout session for a tenant upgrading to Pro |
| POST   | `/webhooks/stripe`    | Receives Stripe webhook events, verifies signature, deduplicates, syncs tenant plan/sub status |

## 4. Idempotency Strategy

Every billable request must include a client-generated `idempotency_key`.
The key carries a `UNIQUE` constraint on `usage_events`, making the INSERT the
atomic deduplication point — two racing requests with the same key produce one
row, and the loser re-fetches and mirrors the original event.

Flow on `POST /generate`:
```
validate body → find tenant → idempotency pre-check (mirror if exists)
  → quota check (used + requested ≤ limit?  else 429/402, nothing recorded)
  → INSERT usage_event (23505 → mirror original, 200)
  → 201 Created + cost
```

Quota is enforced *before* the action is recorded ("enforced before the action,
not after"), so rejected requests never inflate usage counters. A retried
request whose key was already recorded always mirrors the original response,
even if quota was later exhausted — a retry never double-counts.

## 5. Money Math

All money is stored/computed as integers (micro-units, 1/1,000,000 USD).
Floats are never used for money arithmetic. Pricing constants are pinned in
`src/config/pricing.js`:

| Category     | µ per token | USD per 1M |
|--------------|------------:|-----------:|
| input        | 0.5         | $0.50      |
| cached_input | 0.1         | $0.10      |
| output       | 1.5         | $1.50      |
| reasoning    | 6.0         | $6.00      |

Each token category is priced at its own rate and the results summed —
categories are never added together before pricing. Reasoning tokens are billed
as premium output, never free.

## 6. Stripe Safety

- Checkout sessions are created in test mode against a recurring Pro price.
- Webhooks verify the `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET`
  (raw body preserved via `express.raw` mounted before `express.json()`);
  forgeries → `400`.
- Every processed event is recorded in `webhook_events` (UNIQUE on
  `stripe_event_id`); replays return 200 with `duplicate: true` and change
  nothing.
- `checkout.session.completed` → tenant plan → `pro` + subscription row.
- `customer.subscription.updated` → sync status/period, plan per status.
- `customer.subscription.deleted` → tenant back to `free`, subscription removed.

## 7. Non-Goal

This system does not implement **usage alerts** (80%/100% notifications),
**invoicing**, **proration**, or **overage billing** — all documented stretch
goals outside the core scope. There is also no real AI integration: token
counts are simulated via request metadata.