import express from "express";
import { stripeWebhookController } from "../controllers/stripeWebhookController.js";

const router = express.Router();

// The webhook MUST receive the raw body so that signature verification
// reconstructs exactly what Stripe signed.
router.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  stripeWebhookController,
);

export default router;