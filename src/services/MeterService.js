import pool from "../db/db.js";

export const recordUsage = async (
  tenantId,
  type,
  quantity,
  metadata,
  idempotencyKey,
) => {
  const query = `INSERT INTO usage_events (tenant_id, type, quantity, metadata, idempotency_key)
               VALUES ($1, $2, $3, $4, $5) RETURNING *`;
  const values = [tenantId, type, quantity, metadata, idempotencyKey];

  try {
    const result = await pool.query(query, values);
    console.log("✅ Inserted row ID:", result.rows[0].id);
    return { isDuplicate: false, event: result.rows[0] };
  } catch (error) {
    if (error.code === '23505') {
      const text = `SELECT * FROM usage_events WHERE idempotency_key = $1`;
      const res = await pool.query(text, [idempotencyKey]);
      return { isDuplicate: true, event: res.rows[0] };
    } else {
      throw error; 
    }
  }
};
