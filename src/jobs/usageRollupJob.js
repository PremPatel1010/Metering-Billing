import pool from "../db/db.js";
import { costOfUsageEvent } from "../services/CostService.js";

// Background job: rolls up monthly usage per tenant/type OFF the request path.
// Runs on an interval configured by JOB_INTERVAL_MS (default 60_000ms for demo).
// Failures are logged; the next tick retries automatically. In production this
// would page an alerting channel on repeated failures.

let running = false;

const runRollup = async () => {
  if (running) return; // never overlap ticks
  running = true;
  try {
    // Aggregate this month's usage per (tenant, type), with cost computed per
    // event in integer micro-units before summing.
    const events = await pool.query(
      `SELECT tenant_id, type, quantity, metadata, created_at
       FROM usage_events
       WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
    );

    const buckets = new Map();
    for (const e of events.rows) {
      const key = `${e.tenant_id}|${e.type}`;
      const b = buckets.get(key) || { tenantId: e.tenant_id, type: e.type, quantity: 0, costMicro: 0 };
      b.quantity += Number(e.quantity) || 0;
      b.costMicro += costOfUsageEvent(e);
      buckets.set(key, b);
    }

    const month = new Date().toISOString().slice(0, 8) + '01';

    for (const b of buckets.values()) {
      await pool.query(
        `INSERT INTO usage_rollups (tenant_id, type, month, quantity, cost_micro_units, updated_at)
         VALUES ($1, $2, $3::date, $4, $5, NOW())
         ON CONFLICT (tenant_id, type, month)
         DO UPDATE SET quantity = EXCLUDED.quantity,
                       cost_micro_units = EXCLUDED.cost_micro_units,
                       updated_at = NOW()`,
        [b.tenantId, b.type, month, b.quantity, b.costMicro],
      );
    }

    console.log(
      `[rollup-job] ${new Date().toISOString()} → ${buckets.size} tenant/type buckets upserted for ${month}`,
    );
  } catch (err) {
    // Failure alert (kept honest: a log line; production would page):
    console.error("[rollup-job] FAILED:", err.message);
  } finally {
    running = false;
  }
};

export const startUsageRollupJob = () => {
  const raw = process.env.JOB_INTERVAL_MS;
  if (raw === '0' || raw === 'false' || raw === 'off') {
    console.log('[rollup-job] disabled via JOB_INTERVAL_MS');
    return null;
  }
  const intervalMs = Number(raw) || 60_000;
  runRollup(); // run once immediately on boot
  const timer = setInterval(runRollup, intervalMs);
  timer.unref(); // don't keep the process alive on its own
  console.log(`[rollup-job] scheduled every ${intervalMs}ms`);
  return timer;
};