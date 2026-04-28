const crypto = require('crypto');

const REMOTE_SESSION_GRANT_SECONDS = Number(process.env.REMOTE_SESSION_GRANT_SECONDS || 3 * 60);
const UNATTENDED_REMOTE_ACCESS_ENABLED = process.env.UNATTENDED_REMOTE_ACCESS_ENABLED !== 'false';
const LIVE_REMOTE_TRANSPORT_READY = process.env.LIVE_REMOTE_TRANSPORT_READY === 'true';

function generateGrantToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashGrantToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function remoteUserAllowed(user) {
  return Boolean(user) &&
    user.isActive !== false &&
    user.remoteAccessEnabled !== false;
}

function remoteConnectionReadiness(device, options = {}) {
  if (!device) {
    return {
      available: false,
      state: 'unavailable',
      reason: 'device-not-found',
      label: 'Remote control unavailable',
    };
  }

  if (!UNATTENDED_REMOTE_ACCESS_ENABLED || options.unattendedAllowed === false) {
    return {
      available: false,
      state: 'unavailable',
      reason: 'unattended-disabled',
      label: 'Remote control unavailable',
    };
  }

  if (!device.online || device.connectionStatus === 'offline' || device.status === 'offline') {
    return {
      available: false,
      state: 'offline',
      reason: 'device-offline',
      label: 'Device offline',
    };
  }

  if (options.agentReachable !== true) {
    return {
      available: false,
      state: 'unavailable',
      reason: 'agent-unreachable',
      label: 'Remote control unavailable',
    };
  }

  return {
    available: true,
    state: LIVE_REMOTE_TRANSPORT_READY ? 'available' : 'grant-ready',
    reason: LIVE_REMOTE_TRANSPORT_READY ? 'transport-ready' : 'transport-not-wired',
    label: LIVE_REMOTE_TRANSPORT_READY
      ? 'Remote control is ready.'
      : 'Unattended session grant is ready; live control transport is not wired yet.',
    transport: {
      wired: LIVE_REMOTE_TRANSPORT_READY,
      state: LIVE_REMOTE_TRANSPORT_READY ? 'ready' : 'not-wired',
    },
  };
}

async function createRemoteSessionGrant(pool, {
  remoteUserIdentity,
  deviceId,
  ttlSeconds = REMOTE_SESSION_GRANT_SECONDS,
  token = generateGrantToken(),
} = {}) {
  if (!remoteUserIdentity || !deviceId) {
    const err = new Error('remoteUserIdentity and deviceId are required');
    err.statusCode = 400;
    throw err;
  }

  const sessionId = crypto.randomUUID();
  const tokenHash = hashGrantToken(token);
  const result = await pool.query(
    `
    INSERT INTO remote_access_session_grants (
      id,
      remote_user_identity,
      device_id,
      token_hash,
      status,
      created_at,
      expires_at
    )
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + ($6::text || ' seconds')::interval)
    RETURNING id, remote_user_identity, device_id, status, created_at, expires_at, started_at, ended_at, failure_reason
    `,
    [sessionId, remoteUserIdentity, deviceId, tokenHash, 'granted', ttlSeconds]
  );

  return {
    grant: result.rows[0],
    token,
    expiresInSeconds: ttlSeconds,
  };
}

async function validateRemoteSessionGrant(pool, token, deviceId) {
  const tokenHash = hashGrantToken(token);
  const result = await pool.query(
    `
    SELECT *
    FROM remote_access_session_grants
    WHERE token_hash = $1
      AND device_id = $2
    LIMIT 1
    `,
    [tokenHash, deviceId]
  );

  const grant = result.rows[0];
  if (!grant) {
    return { ok: false, statusCode: 401, reason: 'invalid-grant' };
  }

  if (grant.status !== 'granted' && grant.status !== 'started') {
    return { ok: false, statusCode: 409, reason: `grant-${grant.status}` };
  }

  const now = new Date();
  const expiresAt = grant.expires_at instanceof Date ? grant.expires_at : new Date(grant.expires_at);
  if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    await pool.query(
      `
      UPDATE remote_access_session_grants
      SET status = 'expired',
          failure_reason = COALESCE(failure_reason, 'grant expired')
      WHERE id = $1 AND status IN ('granted', 'started')
      `,
      [grant.id]
    );
    return { ok: false, statusCode: 401, reason: 'expired-grant', grant };
  }

  return { ok: true, grant };
}

async function markRemoteSessionStarted(pool, sessionId) {
  const result = await pool.query(
    `
    UPDATE remote_access_session_grants
    SET status = 'started',
        started_at = COALESCE(started_at, NOW())
    WHERE id = $1
      AND status = 'granted'
      AND expires_at > NOW()
    RETURNING *
    `,
    [sessionId]
  );
  return result.rows[0] || null;
}

async function markRemoteSessionEnded(pool, sessionId, status = 'ended', reason = null) {
  const finalStatus = status === 'failed' ? 'failed' : 'ended';
  const result = await pool.query(
    `
    UPDATE remote_access_session_grants
    SET status = $2,
        ended_at = COALESCE(ended_at, NOW()),
        failure_reason = CASE WHEN $2 = 'failed' THEN $3 ELSE failure_reason END
    WHERE id = $1
      AND status IN ('granted', 'started')
    RETURNING *
    `,
    [sessionId, finalStatus, reason]
  );
  return result.rows[0] || null;
}

module.exports = {
  LIVE_REMOTE_TRANSPORT_READY,
  REMOTE_SESSION_GRANT_SECONDS,
  UNATTENDED_REMOTE_ACCESS_ENABLED,
  createRemoteSessionGrant,
  generateGrantToken,
  hashGrantToken,
  markRemoteSessionEnded,
  markRemoteSessionStarted,
  remoteConnectionReadiness,
  remoteUserAllowed,
  validateRemoteSessionGrant,
};
