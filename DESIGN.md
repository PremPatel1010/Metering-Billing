# Design Document — Usage Metering & Billing Engine

## 1. Problem Statement

This system meters API usage for a multi-tenant SaaS product and enforces
subscription-based quotas. Tenants are on either a Free or Pro plan, each
with a defined monthly limit (e.g., Free = 1,000 API calls). Every billable
action is recorded as a usage event; once a tenant exceeds their plan's
quota, further requests are rejected with a clear error until they upgrade
or their billing period resets.

## 2. Data Model

```sql
CREATE TYPE plan AS ENUM ('free', 'pro');

CREATE TABLE tenants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(25) NOT NULL,
    email VARCHAR(25) NOT NULL,
    current_plan plan,
    stripe_customer_id VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE usage_events (
    id SERIAL PRIMARY KEY,
    tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
    type VARCHAR(50),
    quantity INT,
    metadata JSONB DEFAULT '{}',
    idempotency_key VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE subscriptions (
    id SERIAL PRIMARY KEY,
    tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
    stripe_subscription_id VARCHAR(50),
    status VARCHAR(25) NOT NULL,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 3. API Surface

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/generate` | Dummy billable endpoint — simulates a metered action (e.g., an AI call), records a usage event, checks quota, returns cost |
| GET | `/usage` | Returns a tenant's current usage, plan limit, and calculated cost for the billing period |
| POST | `/checkout` | Creates a Stripe Checkout session for a tenant upgrading to Pro |
| POST | `/webhooks/stripe` | Receives Stripe webhook events (checkout completed, subscription updated/deleted), verifies signature, and syncs tenant plan/subscription status |

## 4. Idempotency Strategy

Every billable request must include a client-generated `idempotency_key`.
This key is stored with a `UNIQUE` constraint on `usage_events`. When a
request arrives, the system attempts to insert a new usage event with that
key. If the insert succeeds, the action is processed normally. If it fails
due to a unique constraint violation, the system treats this as a retry of
an already-processed request — it looks up the original event and returns
the same response, without creating a duplicate or double-counting usage.

## 5. Non-Goal

This system will not implement **usage alerts** (e.g., notifying customers
at 80% or 100% of their quota). The core scope is limited to metering,
quota enforcement, cost calculation, and Stripe subscription sync — alerts
are explicitly out of scope for this build.