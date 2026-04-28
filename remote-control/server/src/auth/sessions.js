const crypto = require('crypto');
const { createRefreshToken, hashToken, REFRESH_TOKEN_SECONDS, signAccessToken } = require('./tokens');

function requestIp(req) {
  return req.ip || req.get?.('x-forwarded-for') || req.socket?.remoteAddress || null;
}

function requestUserAgent(req) {
  return req.get?.('user-agent') || null;
}

async function createAdminSession(pool, adminUser, req) {
  const sessionId = crypto.randomUUID();
  const refreshToken = createRefreshToken();
  await pool.query(
    `
    INSERT INTO admin_sessions (id, admin_user, token_hash, issued_at, expires_at, ip, user_agent)
    VALUES ($1, $2, $3, NOW(), NOW() + ($4::text || ' seconds')::interval, $5, $6)
    `,
    [
      sessionId,
      adminUser,
      hashToken(refreshToken),
      REFRESH_TOKEN_SECONDS,
      requestIp(req),
      requestUserAgent(req),
    ]
  );

  return {
    adminUser,
    sessionId,
    accessToken: signAccessToken({ email: adminUser, sid: sessionId }),
    refreshToken,
  };
}

async function rotateAdminSession(pool, refreshToken, req) {
  if (!refreshToken) return null;

  const tokenHash = hashToken(refreshToken);
  const existing = await pool.query(
    `
    SELECT *
    FROM admin_sessions
    WHERE token_hash = $1
      AND revoked_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
    `,
    [tokenHash]
  );

  if (existing.rowCount === 0) return null;

  const previous = existing.rows[0];
  const nextSessionId = crypto.randomUUID();
  const nextRefreshToken = createRefreshToken();

  await pool.query(
    `
    UPDATE admin_sessions
    SET revoked_at = NOW()
    WHERE id = $1
    `,
    [previous.id]
  );

  await pool.query(
    `
    INSERT INTO admin_sessions (
      id,
      admin_user,
      token_hash,
      issued_at,
      expires_at,
      rotated_from,
      ip,
      user_agent
    )
    VALUES ($1, $2, $3, NOW(), NOW() + ($4::text || ' seconds')::interval, $5, $6, $7)
    `,
    [
      nextSessionId,
      previous.admin_user,
      hashToken(nextRefreshToken),
      REFRESH_TOKEN_SECONDS,
      previous.id,
      requestIp(req),
      requestUserAgent(req),
    ]
  );

  return {
    adminUser: previous.admin_user,
    sessionId: nextSessionId,
    accessToken: signAccessToken({ email: previous.admin_user, sid: nextSessionId }),
    refreshToken: nextRefreshToken,
  };
}

async function revokeAdminSession(pool, refreshToken) {
  if (!refreshToken) return false;

  const result = await pool.query(
    `
    UPDATE admin_sessions
    SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE token_hash = $1
      AND revoked_at IS NULL
    `,
    [hashToken(refreshToken)]
  );

  return result.rowCount > 0;
}

async function isSessionActive(pool, sessionId) {
  if (!sessionId) return false;

  const result = await pool.query(
    `
    SELECT id
    FROM admin_sessions
    WHERE id = $1
      AND revoked_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
    `,
    [sessionId]
  );

  return result.rowCount > 0;
}

module.exports = {
  createAdminSession,
  isSessionActive,
  requestIp,
  requestUserAgent,
  revokeAdminSession,
  rotateAdminSession,
};
