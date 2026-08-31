import { recordUsage } from "../services/MeterService.js";

export const generateController = async (req, res) => {
  try {
    const { tenantId, type, quantity, metadata = {}, idempotencyKey } = req.body;

    if (!tenantId || !type || !quantity || !idempotencyKey) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Missing required fields",
      });
    }

    const result = await recordUsage(
      tenantId,
      type,
      quantity,
      metadata,
      idempotencyKey,
    );

    if (result.isDuplicate) {
      return res.status(200).json({
        message: "Usage Event Already Recorded",
        event: result.event,
      });
    }

    return res.status(201).json({
      message: "Usage Event Created",
      event: result.event
    });
  } catch (error) {
    return res.status(500).json({
      error: error.stack,
    });
  }
};
