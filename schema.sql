CREATE TYPE plan as enum(
  'free',
  'pro'
);


CREATE TABLE tenants 
(
   id SERIAL PRIMARY KEY,
   name VARCHAR(25) NOT NULL,
   email VARCHAR(25) NOT NULL,
   current_plan plan,
   stripe_customer_id VARCHAR(50),
   created_at TIMESTAMPTZ DEFAULT NOW()
);


CREATE TABLE usage_events 
(
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
  type VARCHAR(50), 
  quantity INT,
  metadata JSONB DEFAULT '{}',
  idempotency_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE subscriptions 
(
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_subscription_id VARCHAR(50),
  status VARCHAR(25) NOT NULL,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ, 
  created_at TIMESTAMPTZ DEFAULT NOW()
);