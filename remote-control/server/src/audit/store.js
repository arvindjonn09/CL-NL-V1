const crypto = require('crypto');

async function insertAuditLog(pool, entry) {
  await pool.query(
    `
    INSERT INTO admin_audit_logs (
      id,
      admin_user,
      action,
      target_type,
      target_id,
      ip,
      user_agent,
      result,
      detail
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      crypto.randomUUID(),
      entry.adminIdentity || null,
      entry.action,
      entry.targetType || null,
      entry.targetId || null,
      entry.ip || null,
      entry.userAgent || null,
      entry.result || 'success',
      entry.detail || null,
    ]
  );
}

module.exports = {
  insertAuditLog,
};
