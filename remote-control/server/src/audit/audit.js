const { auditEntry } = require('./model');
const { insertAuditLog } = require('./store');

function requestIp(req) {
  return req.ip || req.get?.('x-forwarded-for') || req.socket?.remoteAddress || null;
}

function requestUserAgent(req) {
  return req.get?.('user-agent') || null;
}

async function audit(pool, req, fields) {
  const entry = auditEntry({
    adminIdentity: fields.adminIdentity || req.user?.email || null,
    ip: requestIp(req),
    userAgent: requestUserAgent(req),
    ...fields,
  });

  try {
    await insertAuditLog(pool, entry);
  } catch (err) {
    console.error('audit log write failed:', err);
  }
}

module.exports = {
  audit,
  requestIp,
  requestUserAgent,
};
