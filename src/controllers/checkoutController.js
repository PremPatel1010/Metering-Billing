import Stripe from "stripe";
import pool from "../db/db.js";
import { findTenantById } from "../services/tenantService.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const checkoutController = async (req, res) => {
  const { tenantId } = req.body;

  if (!tenantId) {
    return res.status(400).json({
      error: "Bad Request",
      message: "Missing required field: tenantId",
    });
  }

  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('REPLACE_WITH_YOUR')) {
    return res.status(500).json({
      error: "Server Error",
      message: "STRIPE_SECRET_KEY is not configured. Add your Stripe test-mode secret key to .env.",
    });
  }

  const tenant = await findTenantById(tenantId);
  if (!tenant) {
    return res.status(404).json({
      error: "Not Found",
      message: `Tenant ${tenantId} does not exist`,
    });
  }

  if (tenant.current_plan === 'pro') {
    return res.status(409).json({
      error: "Conflict",
      message: "Tenant is already on the Pro plan",
    });
  }

  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId || priceId.includes('REPLACE_WITH_YOUR')) {
    return res.status(500).json({
      error: "Server Error",
      message: "STRIPE_PRO_PRICE_ID is not configured. Create a Pro plan price in Stripe test mode and set it in .env",
    });
  }

  try {
    let stripeCustomerId = tenant.stripe_customer_id;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: tenant.email,
        name: tenant.name,
        metadata: { tenant_id: String(tenant.id) },
      });
      stripeCustomerId = customer.id;
      await pool.query(
        `UPDATE tenants SET stripe_customer_id = $1 WHERE id = $2`,
        [stripeCustomerId, tenant.id],
      );
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: process.env.STRIPE_SUCCESS_URL || `${req.protocol}://${req.get('host')}/success`,
      cancel_url: process.env.STRIPE_CANCEL_URL || `${req.protocol}://${req.get('host')}/cancel`,
      client_reference_id: String(tenant.id),
      metadata: { tenant_id: String(tenant.id) },
    });

    return res.status(201).json({
      message: "Checkout session created",
      url: session.url,
      session_id: session.id,
    });
  } catch (err) {
    return res.status(502).json({
      error: "Stripe Error",
      message: err.message,
    });
  }
};