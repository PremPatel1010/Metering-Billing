import { findTenantById } from "../services/tenantService.js";
import { getTenantUsageSummary } from "../services/usageService.js";

export const usageController = async (req, res) => {
  const tenantId = Number(req.params.tenantId ?? req.query.tenantId);

  if (!tenantId || !Number.isInteger(tenantId)) {
    return res.status(400).json({
      error: "Bad Request",
      message: "Send a valid numeric tenantId (path or ?tenantId=)",
    });
  }

  const tenant = await findTenantById(tenantId);
  if (!tenant) {
    return res.status(404).json({
      error: "Not Found",
      message: `Tenant ${tenantId} does not exist`,
    });
  }

  const summary = await getTenantUsageSummary(tenant);
  return res.status(200).json(summary);
};