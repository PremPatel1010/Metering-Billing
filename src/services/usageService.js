import { getUsage } from "./quotaService.js";
import { costOfUsageEvent, formatUsd } from "./CostService.js";
import { PRICING } from "../config/pricing.js";
import pool from "../db/db.js";
import plans from "../config/plans.js";

const USAGE_TYPES = ['api_call', 'ai_tokens'];

export const getTenantUsageSummary = async (tenant) => {
  const metrics = [];

  for (const type of USAGE_TYPES) {
    const used = await getUsage(tenant.id, type);
    const limit = plans[tenant.current_plan][type];

    const events = await pool.query(
      `SELECT type, quantity, metadata, created_at
       FROM usage_events
       WHERE tenant_id = $1 AND type = $2
         AND created_at >= DATE_TRUNC('month', CURRENT_DATE)
       ORDER BY created_at ASC`,
      [tenant.id, type],
    );

    const costMicro = events.rows.reduce((acc, e) => acc + costOfUsageEvent(e), 0);

    metrics.push({
      type,
      used,
      limit,
      remaining: Math.max(limit - used, 0),
      cost_usd: formatUsd(costMicro),
      cost_micro_units: costMicro,
    });
  }

  const totalCostMicro = metrics.reduce((acc, m) => acc + m.cost_micro_units, 0);

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      email: tenant.email,
      plan: tenant.current_plan,
    },
    period_month: new Date().toISOString().slice(0, 7),
    metrics,
    total_cost_usd: formatUsd(totalCostMicro),
    total_cost_micro_units: totalCostMicro,
    pricing: PRICING,
  };
};