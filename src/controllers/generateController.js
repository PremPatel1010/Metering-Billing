import { recordUsage, findUsageByIdempotencyKey } from "../services/MeterService.js";
import { checkQuota } from "../services/quotaService.js";
import { findTenantById, findActiveSubscription } from "../services/tenantService.js";
import { costOfUsageEvent, formatUsd } from "../services/CostService.js";

const VALID_TYPES = ['api_call', 'ai_tokens'];

const msUntilMonthEnd = () => {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0);
  return nextMonth.getTime() - now.getTime();
};

export const generateController = async (req, res) => {
  const { tenantId, type, quantity, metadata = {}, idempotencyKey } = req.body;

  if (!tenantId || !type || !quantity || !idempotencyKey) {
    return res.status(400).json({
      error: "Bad Request",
      message: "Missing required fields: tenantId, type, quantity, idempotencyKey",
    });
  }

  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({
      error: "Bad Request",
      message: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`,
    });
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({
      error: "Bad Request",
      message: "quantity must be a positive integer",
    });
  }

  const tenant = await findTenantById(tenantId);
  if (!tenant) {
    return res.status(404).json({
      error: "Not Found",
      message: `Tenant ${tenantId} does not exist`,
    });
  }

  // Idempotent replay always mirrors the original result, even if the quota
  // has since been exhausted — a retried request is never double-counted.
  const existing = await findUsageByIdempotencyKey(idempotencyKey);
  if (existing) {
    return res.status(200).json({
      message: "Usage Event Already Recorded",
      event: existing,
    });
  }

  // Quota is enforced BEFORE the action is recorded.
  const quota = await checkQuota(tenant.id, tenant.current_plan, type, quantity);
  if (!quota.allowed) {
    const activeSub = await findActiveSubscription(tenant.id);

    if (!activeSub && tenant.current_plan !== 'free') {
      return res.status(402).json({
        error: "Payment Required",
        message: "Your subscription is not active. Please renew or upgrade to continue.",
      });
    }

    res.set('Retry-After', `${Math.ceil(msUntilMonthEnd() / 1000)}`);
    return res.status(429).json({
      error: "Too Many Requests",
      message: `Usage quota exceeded for ${type}. Limit is ${quota.limit}, used ${quota.used}. ` +
               `This request would push you to ${quota.usedAfter}. ` +
               `Upgrade to Pro to raise your limit, or retry after the billing period resets.`,
      usage: { used: quota.used, limit: quota.limit, requested: quantity },
    });
  }

  // Insert is atomic on the idempotency_key UNIQUE constraint, so two racing
  // requests with the same key still produce exactly one usage event.
  const result = await recordUsage(tenantId, type, quantity, metadata, idempotencyKey);

  if (result.isDuplicate) {
    return res.status(200).json({
      message: "Usage Event Already Recorded",
      event: result.event,
    });
  }

  return res.status(201).json({
    message: "Usage Event Created",
    event: result.event,
    cost_usd: formatUsd(costOfUsageEvent(result.event)),
  });
};