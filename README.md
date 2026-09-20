# Usage Metering & Billing Engine

A multi-tenant backend service that meters API usage, enforces subscription-based quotas, calculates costs (including AI token pricing rules), and integrates Stripe test mode for subscription management — with idempotent, signature-verified webhook handling.

Built as a FlyRank Internship Backend Track capstone project.

---

## What This System Does

Three questions every SaaS must answer:

1. **How much has this customer used?** — every billable action is recorded as a usage event, deduplicated by idempotency key.
2. **How much should they pay?** — usage rolls up into a cost figure with correct AI token pricing (cached input, output, reasoning tokens each priced separately).
3. **Have they hit their plan limits?** — quota is enforced before the action, with exact boundary behavior (429 Too Many Requests / 402 Payment Required).

---

## Architecture

```
Client
  │
  ├── POST /generate          (billable action)
  │      │
  │      ├── findTenant
  │      ├── idempotency pre-check  (SELECT by key → mirror if exists)
  │      ├── quota check            (used + requested ≤ limit?)
  │      │      └─ exceeded → 429 / 402 + Retry-After
  │      └── INSERT usage_event     (unique on idempotency_key)
  │             └─ duplicate → 23505 → mirror original (200)
  │
  ├── GET /usage/:tenantId    (read path)
  │      │
  │      └── rollup usage_events by type
  │             → { used, limit, remaining, cost_usd }
  │
  ├── POST /checkout          (Stripe Checkout session)
  │      │
  │      └── create/find Stripe customer
  │             → return Checkout URL
  │
  └── POST /webhooks/stripe   (Stripe → your server)
         │
         ├── verify signature     (rejects forgeries → 400)
         ├── deduplicate event    (UNIQUE on stripe_event_id)
         └── handle events:
              checkout.session.completed  → set tenant pro, create subscription
              customer.subscription.updated → sync status + period
              customer.subscription.deleted → revert to free
```

---

## Plans & Limits

| Plan   | API Calls / Month | AI Tokens / Month |
|--------|------------------:|-------------------:|
| Free   | 1,000             | 100,000            |
| Pro    | 5,000             | 1,000,000          |

---

## AI Token Pricing (Micro-Unit Math)

All money is stored as integers (micro-units, 1/1,000,000 USD). No floats are used for money arithmetic.

| Token Category        | Rate per 1M tokens | Notes                           |
|----------------------|-------------------:|---------------------------------|
| Fresh input tokens   | $0.50              | Standard input pricing          |
| Cached input tokens  | $0.10              | 5x cheaper — provider had cached |
| Output tokens        | $1.50              | Standard output pricing         |
| Reasoning tokens     | $6.00              | Billed as premium output, never free |

Categories are priced separately and summed — they are never added together before applying rates.

---

## Quick Start (Docker + Node.js)

### Prerequisites
- Docker (for PostgreSQL)
- Node.js 18+ and npm
- Stripe account (test mode) + Stripe CLI installed

### 1. Start PostgreSQL

```bash
docker compose up -d
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your Stripe test mode keys:
- `STRIPE_SECRET_KEY` — from https://dashboard.stripe.com/test/apikeys
- `STRIPE_WEBHOOK_SECRET` — from running `stripe listen` (see step 5)
- `STRIPE_PRO_PRICE_ID` — create a recurring $X/month price in Stripe test dashboard

### 3. Install dependencies

```bash
npm install
```

### 4. Set up database + seed demo data

```bash
npm run setup-db
```

This creates the schema and seeds two tenants:
- **Acme Corp** (id=1) — Free plan
- **StartupXYZ** (id=2) — Pro plan

### 5. Start the Stripe CLI listener (in a separate terminal)

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

Copy the `whsec_...` secret it prints into your `.env` as `STRIPE_WEBHOOK_SECRET`.

### 6. Start the server

```bash
npm start
```

Server runs at `http://localhost:3000`.

---

## API Reference

### `POST /generate` — Record a billable usage event

**Body:**
```json
{
  "tenantId": 1,
  "type": "api_call",
  "quantity": 1,
  "idempotencyKey": "unique-request-id",
  "metadata": {}
}
```

**For AI tokens**, include the breakdown in `metadata`:
```json
{
  "tenantId": 1,
  "type": "ai_tokens",
  "quantity": 10000,
  "idempotencyKey": "ai-req-123",
  "metadata": {
    "input": 4000,
    "cached_input": 2000,
    "output": 3000,
    "reasoning": 1000
  }
}
```

**Responses:**
- `201 Created` — new usage event recorded (includes `cost_usd`)
- `200 OK` — duplicate idempotency key, mirrors original event (no double-count)
- `400 Bad Request` — missing/invalid fields
- `404 Not Found` — tenant does not exist
- `429 Too Many Requests` — usage quota exceeded (includes `Retry-After` header)
- `402 Payment Required` — subscription is inactive, payment needed

### `GET /usage/:tenantId` — Usage summary + cost rollup

Returns current-month usage, plan limits, remaining quota, and cost per usage type.

### `POST /checkout` — Create Stripe Checkout session

**Body:** `{ "tenantId": 1 }`

Returns a Checkout URL the client can redirect to for payment.

### `POST /webhooks/stripe` — Stripe webhook receiver

Stripe CLI or Stripe servers POST signed events here. Forged signatures → `400`. Duplicate events → `200` with `duplicate: true`, no state change.

---

## Background Job: Monthly Usage Rollup

A scheduled background job (`src/jobs/usageRollupJob.js`) aggregates usage per
tenant/usage-type **off the request path** into the `usage_rollups` table:

- Runs immediately on boot, then every `JOB_INTERVAL_MS` (default `60000` ms; set `0`/`off` to disable).
- Fails are logged with `[rollup-job] FAILED:`; the next tick retries automatically (retry + alert semantics).
- Cost is summed in integer micro-units per event (same math as the request path).

```sql
SELECT * FROM usage_rollups;  -- tenant_id, type, month, quantity, cost_micro_units, updated_at
```

---

## Required Files

| File            | Purpose                                                    |
|-----------------|------------------------------------------------------------|
| `README.md`     | This file — what the system does, how to run it            |
| `capstone.yaml` | Manifest for evaluator: run/seed/test commands, endpoints  |
| `EVIDENCE.md`   | One proof per requirement checkbox (curl transcripts)      |
| `BUILDLOG.md`   | AI usage log: what helped, what was wrong, what changed    |
| `.env.example`  | All required env vars with placeholder values              |

---

## Limitations

- **No invoicing or proration** — upgrades happen mid-period without prorated billing (this is a stretch goal).
- **No usage alerts** — the system does not notify tenants when approaching limits.
- **No rate limiting** — the service does not implement per-IP or per-tenant rate limiting beyond plan quotas.
- **Single server** — designed for local/demo use; no horizontal scaling, no background job queue, no distributed tracing.
- **AI tokens are simulated** — the service meters numbers, it does not call any real AI model.
- **Free plan tenants don't go through Checkout** — they use the service directly without Stripe.

---

## License

ISC