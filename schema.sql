CREATE TYPE plan AS enum(
  'free',
  'pro'
);


CREATE TABLE tenants
(
   id SERIAL PRIMARY KEY,
   name VARCHAR(25) NOT NULL,
   email VARCHAR(25) NOT NULL,
   current_plan plan DEFAULT 'free',
   stripe_customer_id VARCHAR(255),
   created_at TIMESTAMPTZ DEFAULT NOW()
);


CREATE TABLE usage_events
(
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
  type VARCHAR(50),
  quantity INT CHECK (quantity >= 0),
  metadata JSONB DEFAULT '{}',
  idempotency_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rollup + quota queries filter by (tenant, type, month)
CREATE INDEX idx_usage_events_tenant_type_month
  ON usage_events (tenant_id, type, created_at);


CREATE TABLE subscriptions
(
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_subscription_id VARCHAR(255) UNIQUE,
  status VARCHAR(25) NOT NULL,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- Stripe webhook deduplication: every processed event is recorded here by
-- its Stripe event id, so replays can never be applied twice.
CREATE TABLE webhook_events
(
  id SERIAL PRIMARY KEY,
  stripe_event_id VARCHAR(255) UNIQUE NOT NULL,
  type VARCHAR(100) NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);


-- Background-job output: monthly usage rollup (aggregated off the request path).
CREATE TABLE usage_rollups
(
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  month DATE NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  cost_micro_units BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, type, month)
);