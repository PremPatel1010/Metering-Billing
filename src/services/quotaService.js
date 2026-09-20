import pool from "../db/db.js";
import plans from "../config/plans.js";

// Returns usage/limit for a tenant + usage type within the current calendar month.
export const getUsage = async (tenantId, usageType) => {
  const query = `SELECT SUM(quantity) as total_usage
                 FROM usage_events
                 WHERE tenant_id = $1
                    AND type = $2
                    AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`;
  const values = [tenantId, usageType];
  const result = await pool.query(query, values);
  return Number(result.rows[0].total_usage) || 0;
};

// Quota boundary check: a request is allowed only if
//   used + requestedQuantity <= limit
// so a tenant may land exactly ON their limit, but never exceed it.
export const checkQuota = async (tenantId, planType, usageType, requestedQuantity) => {
  const limit = plans[planType][usageType];
  const used = await getUsage(tenantId, usageType);

  const usedAfter = used + requestedQuantity;
  const allowed = usedAfter <= limit;

  return {
    used,
    limit,
    requested: requestedQuantity,
    usedAfter,
    remaining: Math.max(limit - usedAfter, 0),
    allowed,
    exceeded: used > limit,
  };
};