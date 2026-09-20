import Stripe from "stripe";
import pool from "../db/db.js";
import {
  updateTenantPlan,
  upsertSubscription,
  removeSubscription,
} from "../services/tenantService.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Registers an event id as processed. Returns false if it was already
// processed (replay) — an UNIQUE constraint makes this race-safe.
const markProcessed = async (stripeEventId, type) => {
  try {
    await pool.query(
      `INSERT INTO webhook_events (stripe_event_id, type) VALUES ($1, $2)`,
      [stripeEventId, type],
    );
    return true;
  } catch (error) {
    if (error.code === '23505') return false; // duplicate event — already handled
    throw error;
  }
};

const handleCheckoutSessionCompleted = async (session) => {
  const tenantId = Number(session.metadata?.tenant_id ?? session.client_reference_id);
  if (!tenantId) return;

  const sub = session.subscription;
  let periodStart = null;
  let periodEnd = null;
  let status = session.subscription ? 'active' : session.payment_status;

  if (typeof sub === 'string') {
    const subObj = await stripe.subscriptions.retrieve(sub);
    status = subObj.status;
    periodStart = new Date(subObj.current_period_start * 1000);
    periodEnd = new Date(subObj.current_period_end * 1000);
  } else if (sub && sub.id) {
    status = sub.status;
    periodStart = sub.current_period_start ? new Date(sub.current_period_start * 1000) : null;
    periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
  }

  await updateTenantPlan(tenantId, 'pro');
  await upsertSubscription({
    tenantId,
    stripeSubscriptionId: typeof sub === 'string' ? sub : sub?.id,
    status,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
  });
};

const handleSubscriptionUpdated = async (subscription) => {
  const subId = subscription.id;
  const status = subscription.status;

  const subRow = await pool.query(
    `SELECT tenant_id FROM subscriptions WHERE stripe_subscription_id = $1`,
    [subId],
  );

  let tenantId = subRow.rows[0]?.tenant_id;
  if (!tenantId) {
    const sub = await pool.query(
      `SELECT id FROM tenants WHERE stripe_customer_id = $1`,
      [subscription.customer],
    );
    tenantId = sub.rows[0]?.id;
  }
  if (!tenantId) return;

  const cancelledOrInactive =
    status === 'canceled' || status === 'unpaid' || status === 'past_due';

  await upsertSubscription({
    tenantId,
    stripeSubscriptionId: subId,
    status,
    currentPeriodStart: new Date(subscription.current_period_start * 1000),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
  });

  // Plan sync mirrors payment truth at Stripe.
  await updateTenantPlan(tenantId, cancelledOrInactive ? 'free' : 'pro');
};

const handleSubscriptionDeleted = async (subscription) => {
  const subId = subscription.id;
  const subRow = await pool.query(
    `SELECT tenant_id FROM subscriptions WHERE stripe_subscription_id = $1`,
    [subId],
  );
  const tenantId = subRow.rows[0]?.tenant_id;
  if (tenantId) {
    await updateTenantPlan(tenantId, 'free');
  }
  await removeSubscription(subId);
};

export const stripeWebhookController = async (req, res) => {
  const sig = req.headers['stripe-signature'];

  // Signature verification comes FIRST: a forged webhook must get a 400.
  // If the webhook secret is unset/misconfigured, constructEvent throws and
  // the request is rejected here rather than trusted.
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({
      error: "Bad Request",
      message: `Webhook signature verification failed: ${err.message}`,
    });
  }

  try {
    // Deduplicate: a replayed event is acknowledged but never applied twice.
    if (!(await markProcessed(event.id, event.type))) {
      return res.status(200).json({ received: true, duplicate: true, type: event.type });
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true, type: event.type });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};