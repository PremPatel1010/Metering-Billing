import pool from "../db/db.js";

export const findTenantById = async (tenantId) => {
  const result = await pool.query(
    `SELECT id, name, email, current_plan, stripe_customer_id, created_at
     FROM tenants WHERE id = $1`,
    [tenantId],
  );
  return result.rows[0] || null;
};

// Returns the tenant's active subscription (excluding canceled/unpaid), if any.
export const findActiveSubscription = async (tenantId) => {
  const result = await pool.query(
    `SELECT id, tenant_id, stripe_subscription_id, status, current_period_start, current_period_end
     FROM subscriptions
     WHERE tenant_id = $1
       AND status IN ('active', 'trialing')
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId],
  );
  return result.rows[0] || null;
};

export const updateTenantPlan = async (tenantId, plan) => {
  return pool.query(
    `UPDATE tenants SET current_plan = $1 WHERE id = $2`,
    [plan, tenantId],
  );
};

export const upsertSubscription = async ({
  tenantId,
  stripeSubscriptionId,
  status,
  currentPeriodStart,
  currentPeriodEnd,
}) => {
  return pool.query(
    `INSERT INTO subscriptions
       (tenant_id, stripe_subscription_id, status, current_period_start, current_period_end)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (stripe_subscription_id)
     DO UPDATE SET status = EXCLUDED.status,
                   current_period_start = EXCLUDED.current_period_start,
                   current_period_end = EXCLUDED.current_period_end`,
    [tenantId, stripeSubscriptionId, status, currentPeriodStart, currentPeriodEnd],
  );
};

export const removeSubscription = async (stripeSubscriptionId) => {
  return pool.query(
    `DELETE FROM subscriptions WHERE stripe_subscription_id = $1`,
    [stripeSubscriptionId],
  );
};