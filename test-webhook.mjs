import 'dotenv/config';
import crypto from 'crypto';
import pool from './src/db/db.js';

const BASE = 'http://localhost:3000';
const secret = process.env.STRIPE_WEBHOOK_SECRET;

const signedPayload = (event) => {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = `${timestamp}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return { payload, signature: `t=${timestamp},v1=${sig}` };
};

const eventId = `evt_test_dedup_${Date.now()}`;
const event = {
  id: eventId,
  object: 'event',
  api_version: '2024-06-20',
  type: 'invoice.created',
  data: { object: { id: 'in_test_001' } },
};

const { payload, signature } = signedPayload(event);

// Attempt 1: valid signature, fresh event → processed
const r1 = await fetch(`${BASE}/webhooks/stripe`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
  body: payload,
});
console.log(`Attempt 1 (valid, first delivery): status=${r1.status} body=${JSON.stringify(await r1.json())}`);

// Attempt 2: replay of same event → duplicate, ignored
const r2 = await fetch(`${BASE}/webhooks/stripe`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
  body: payload,
});
console.log(`Attempt 2 (replay): status=${r2.status} body=${JSON.stringify(await r2.json())}`);

// Forged signature → 400, nothing stored
const r3 = await fetch(`${BASE}/webhooks/stripe`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=forged' },
  body: payload,
});
console.log(`Attempt 3 (forged): status=${r3.status} body=${JSON.stringify(await r3.json())}`);

const rows = (await pool.query('SELECT COUNT(*)::int AS c FROM webhook_events WHERE stripe_event_id = $1', [eventId])).rows[0].c;
console.log(`Rows in webhook_events for ${eventId}: ${rows} (must be 1)`);
await pool.end();