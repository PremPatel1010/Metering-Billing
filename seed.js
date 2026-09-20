import 'dotenv/config';
import pool from './src/db/db.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const run = async () => {
  // Reset in dependency order, then recreate everything fresh.
  await pool.query(`
    DROP TABLE IF EXISTS usage_rollups, webhook_events, subscriptions, usage_events, tenants CASCADE;
    DROP TYPE IF EXISTS plan CASCADE;
  `);
  console.log('🧹 Dropped existing tables');

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('✅ Schema created');

  await pool.query(`
    INSERT INTO tenants (name, email, current_plan)
    VALUES
      ('Acme Corp',      'acme@example.com',      'free'),
      ('StartupXYZ',     'startup@example.com',   'pro')
  `);
  console.log('✅ Demo tenants seeded (Acme=free id=1, StartupXYZ=pro id=2)');

  await pool.query(`
    INSERT INTO usage_events (tenant_id, type, quantity, metadata, idempotency_key)
    VALUES
      (1, 'api_call',   100, '{}',            'seed-api-call-1'),
      (1, 'ai_tokens',  5000, '{"input": 2000, "cached_input": 500, "output": 2000, "reasoning": 500}', 'seed-ai-tokens-1')
  `);
  console.log('✅ Demo usage events seeded for Acme Corp');

  await pool.end();
  console.log('Done.');
};

run().catch((err) => { console.error(err); process.exit(1); });