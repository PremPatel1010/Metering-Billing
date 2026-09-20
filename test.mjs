import 'dotenv/config';
import pool from './src/db/db.js';

const BASE = 'http://localhost:3000';
let pass = 0;
let fail = 0;

const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const post = async (path, body) => {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, retryAfter: res.headers.get('retry-after') };
};

const get = async (path) => {
  const res = await fetch(BASE + path);
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

// Seed a fresh free-plan tenant just for this test run.
const tenant = (await pool.query(
  `INSERT INTO tenants (name, email, current_plan) VALUES ('Test-Corp', 'test@example.com', 'free') RETURNING id`
)).rows[0];
const T = tenant.id;
console.log(`Using fresh tenant id=${T}`);

console.log('--- Validation (boundary at the front door) ---');
{
  const r = await post('/generate', { type: 'api_call', quantity: 1 });
  check('missing fields -> 400', r.status === 400, `status=${r.status}`);
  const r2 = await post('/generate', { tenantId: T, type: 'bogus', quantity: 1, idempotencyKey: 'k1' });
  check('invalid type -> 400', r2.status === 400, `status=${r2.status}`);
  const r3 = await post('/generate', { tenantId: T, type: 'api_call', quantity: -5, idempotencyKey: 'k1' });
  check('negative quantity -> 400', r3.status === 400, `status=${r3.status}`);
  const r4 = await post('/generate', { tenantId: 99999, type: 'api_call', quantity: 1, idempotencyKey: 'k1' });
  check('nonexistent tenant -> 404', r4.status === 404, `status=${r4.status}`);
}

console.log('--- Idempotency (Probe 1) ---');
{
  const key = `idem-${Date.now()}`;
  const r1 = await post('/generate', { tenantId: T, type: 'api_call', quantity: 1, idempotencyKey: key });
  const r2 = await post('/generate', { tenantId: T, type: 'api_call', quantity: 1, idempotencyKey: key });
  const r3 = await post('/generate', { tenantId: T, type: 'api_call', quantity: 99, idempotencyKey: key });
  check('first request 201', r1.status === 201, `status=${r1.status}`);
  check('retry mirrors original 200', r2.status === 200, `status=${r2.status}`);
  check('same event id in retry', r2.json?.event?.id === r1.json?.event?.id, `id=${r2.json?.event?.id}`);
  check('third attempt (different qty, same key) still mirrors', r3.status === 200 && r3.json?.event?.id === r1.json?.event?.id, `status=${r3.status}`);
  const rows = (await pool.query('SELECT COUNT(*)::int AS c FROM usage_events WHERE idempotency_key = $1', [key])).rows[0].c;
  check(`only ONE usage row for key (${rows})`, rows === 1, '');
}

console.log('--- AI token pricing (Probe 5) ---');
{
  const key = `pricing-${Date.now()}`;
  const r = await post('/generate', {
    tenantId: T,
    type: 'ai_tokens',
    quantity: 10000,
    metadata: { input: 4000, cached_input: 2000, output: 3000, reasoning: 1000 },
    idempotencyKey: key,
  });
  // micro: 4000*0.5 + 2000*0.1 + 3000*1.5 + 1000*6 = 12700 => $0.0127
  check('pricing event created', r.status === 201, `status=${r.status}`);
  check('cost = 0.0127', r.json?.cost_usd === '0.0127', `cost=${r.json?.cost_usd}`);
}

console.log('--- GET /usage (read path) ---');
{
  const u = await get(`/usage/${T}`);
  check('usage returns 200', u.status === 200, `status=${u.status}`);
  check('tenant plan is free', u.json?.tenant?.plan === 'free', `plan=${u.json?.tenant?.plan}`);
  const m = u.json?.metrics?.find(x => x.type === 'ai_tokens');
  check('ai_tokens limit == 100000', m?.limit === 100000, JSON.stringify(m));
  check('ai_tokens cost == 0.0127', m?.cost_usd === '0.0127', `cost=${m?.cost_usd}`);
}

console.log('--- Quota boundary (Probe 2) ---');
{
  const u = await get(`/usage/${T}`);
  const metric = u.json.metrics.find(m => m.type === 'api_call');
  const used = metric.used;
  const toBoundary = 1000 - used;
  const keyA = `boundary-${Date.now()}`;
  const near = await post('/generate', { tenantId: T, type: 'api_call', quantity: toBoundary, idempotencyKey: keyA });
  check(`request landing exactly on limit (qty ${toBoundary}) allowed -> 201`, near.status === 201, `status=${near.status}`);
  const keyB = `boundary-over-${Date.now()}`;
  const over = await post('/generate', { tenantId: T, type: 'api_call', quantity: 1, idempotencyKey: keyB });
  check('request over limit -> 429', over.status === 429, `status=${over.status}`);
  check('429 carries Retry-After', over.retryAfter && Number(over.retryAfter) > 0, `Retry-After=${over.retryAfter}`);
  check('429 has clear message', over.json?.message?.includes('Usage quota exceeded'), '');
  const after = (await get(`/usage/${T}`)).json.metrics.find(m => m.type === 'api_call').used;
  check(`429 did not record usage (used=${after})`, after === 1000, '');
  const dup = await post('/generate', { tenantId: T, type: 'api_call', quantity: 1, idempotencyKey: keyA });
  check('retry of boundary request still mirrors (200)', dup.status === 200, `status=${dup.status}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail > 0 ? 1 : 0);