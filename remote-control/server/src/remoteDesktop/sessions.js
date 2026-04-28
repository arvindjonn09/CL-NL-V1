const crypto = require('crypto');
const { publicIceConfig } = require('./config');

const REMOTE_DESKTOP_SESSION_SECONDS = Number(process.env.REMOTE_DESKTOP_SESSION_SECONDS || 10 * 60);
const REMOTE_DESKTOP_SIGNALING_ENABLED = process.env.REMOTE_DESKTOP_SIGNALING_ENABLED !== 'false';

function safeSignalPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return JSON.stringify(payload);
}

function desktopCapabilityForDevice(device, options = {}) {
  if (!device) {
    return {
      supported: false,
      available: false,
      state: 'unavailable',
      reason: 'device-not-found',
      label: 'Remote desktop unavailable',
    };
  }

  if (!REMOTE_DESKTOP_SIGNALING_ENABLED) {
    return {
      supported: false,
      available: false,
      state: 'unavailable',
      reason: 'remote-desktop-disabled',
      label: 'Remote desktop unavailable',
    };
  }

  if (!device.online || device.connectionStatus === 'offline' || device.status === 'offline') {
    return {
      supported: true,
      available: false,
      state: 'offline',
      reason: 'device-offline',
      label: 'Device offline',
    };
  }

  if (options.agentReachable !== true) {
    return {
      supported: true,
      available: false,
      state: 'unavailable',
      reason: 'agent-unreachable',
      label: 'Remote desktop unavailable',
    };
  }

  const ice = publicIceConfig();
  if (!ice.usable) {
    return {
      supported: true,
      available: false,
      state: 'not_ready',
      reason: 'ice-config-missing',
      label: 'Remote desktop not ready',
      ice,
    };
  }

  const reportedCapability = device.remoteDesktopCapability || device.remote_desktop_capability || {};
  const runtimeState = reportedCapability.state || 'not_ready';
  const captureState = reportedCapability.screenCapture || 'not_ready';
  const inputState = reportedCapability.input || 'not_ready';
  const runtimeReady = runtimeState === 'ready' && captureState === 'ready' && inputState === 'ready';

  return {
    supported: true,
    available: runtimeReady,
    state: runtimeReady ? 'available' : 'not_ready',
    reason: runtimeReady ? 'runtime-ready' : 'signaling-ready-runtime-not-ready',
    label: runtimeReady
      ? 'Remote desktop is ready.'
      : 'Remote desktop signaling is ready; desktop capture/input runtime is not ready yet.',
    ice,
    runtime: {
      webrtcSignaling: 'available',
      screenCapture: captureState,
      input: inputState,
      mediaTransport: runtimeReady ? 'available' : 'not_ready',
      agentState: runtimeState,
      reason: reportedCapability.reason || null,
      captureEnvironment: reportedCapability.captureEnvironment || null,
    },
  };
}

async function createRemoteDesktopSession(pool, {
  grant,
  remoteUserIdentity,
  deviceId,
  ttlSeconds = REMOTE_DESKTOP_SESSION_SECONDS,
} = {}) {
  if (!grant?.id || !remoteUserIdentity || !deviceId) {
    const err = new Error('grant, remoteUserIdentity, and deviceId are required');
    err.statusCode = 400;
    throw err;
  }

  const result = await pool.query(
    `
    INSERT INTO remote_desktop_sessions (
      id,
      grant_id,
      remote_user_identity,
      device_id,
      session_type,
      status,
      signaling_state,
      transport_state,
      created_at,
      expires_at
    )
    VALUES ($1, $2, $3, $4, 'remote_desktop', 'waiting_for_agent', 'waiting_for_agent', 'waiting_for_agent', NOW(), NOW() + ($5::text || ' seconds')::interval)
    RETURNING *
    `,
    [crypto.randomUUID(), grant.id, remoteUserIdentity, deviceId, ttlSeconds]
  );
  return result.rows[0];
}

function sessionExpired(session, now = new Date()) {
  const expiresAt = session?.expires_at instanceof Date ? session.expires_at : new Date(session?.expires_at || 0);
  return !expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= now;
}

async function expireRemoteDesktopSession(pool, sessionId, reason = 'session expired') {
  const result = await pool.query(
    `
    UPDATE remote_desktop_sessions
    SET status = 'expired',
        ended_at = COALESCE(ended_at, NOW()),
        failure_reason = COALESCE(failure_reason, $2),
        signaling_state = 'expired',
        transport_state = 'expired',
        updated_at = NOW()
    WHERE id = $1 AND status NOT IN ('ended', 'failed', 'expired', 'denied')
    RETURNING *
    `,
    [sessionId, reason]
  );
  return result.rows[0] || null;
}

async function getRemoteDesktopSessionForUser(pool, sessionId, user) {
  const result = await pool.query(
    `
    SELECT *
    FROM remote_desktop_sessions
    WHERE id = $1
      AND remote_user_identity = $2
    LIMIT 1
    `,
    [sessionId, user?.email]
  );
  const session = result.rows[0] || null;
  if (session && sessionExpired(session)) {
    await expireRemoteDesktopSession(pool, session.id);
    return { session: { ...session, status: 'expired', signaling_state: 'expired', transport_state: 'expired' }, expired: true };
  }
  return { session, expired: false };
}

async function getRemoteDesktopSessionForAgent(pool, sessionId, deviceId) {
  const result = await pool.query(
    `
    SELECT *
    FROM remote_desktop_sessions
    WHERE id = $1
      AND device_id = $2
    LIMIT 1
    `,
    [sessionId, deviceId]
  );
  const session = result.rows[0] || null;
  if (session && sessionExpired(session)) {
    await expireRemoteDesktopSession(pool, session.id);
    return { session: { ...session, status: 'expired', signaling_state: 'expired', transport_state: 'expired' }, expired: true };
  }
  return { session, expired: false };
}

async function listPendingRemoteDesktopSessions(pool, deviceId, limit = 5) {
  const result = await pool.query(
    `
    SELECT id, device_id, status, signaling_state, transport_state, created_at, expires_at
    FROM remote_desktop_sessions
    WHERE device_id = $1
      AND status IN ('waiting_for_agent', 'signaling', 'media_starting')
      AND expires_at > NOW()
    ORDER BY created_at ASC
    LIMIT $2
    `,
    [deviceId, limit]
  );
  return result.rows;
}

async function setRemoteDesktopOffer(pool, sessionId, offer) {
  const result = await pool.query(
    `
    UPDATE remote_desktop_sessions
    SET browser_offer = $2::jsonb,
        status = 'waiting_for_agent',
        signaling_state = 'offer-received',
        transport_state = 'waiting_for_agent',
        updated_at = NOW()
    WHERE id = $1
      AND status IN ('waiting_for_agent', 'signaling', 'media_starting')
      AND expires_at > NOW()
    RETURNING *
    `,
    [sessionId, safeSignalPayload(offer)]
  );
  return result.rows[0] || null;
}

async function setRemoteDesktopAnswer(pool, sessionId, answer) {
  const result = await pool.query(
    `
    UPDATE remote_desktop_sessions
    SET agent_answer = $2::jsonb,
        status = 'media_starting',
        signaling_state = 'answer-received',
        transport_state = 'media_starting',
        updated_at = NOW()
    WHERE id = $1
      AND status IN ('waiting_for_agent', 'signaling', 'media_starting')
      AND expires_at > NOW()
    RETURNING *
    `,
    [sessionId, safeSignalPayload(answer)]
  );
  return result.rows[0] || null;
}

async function appendRemoteDesktopIce(pool, sessionId, side, candidate) {
  const column = side === 'agent' ? 'agent_ice' : 'browser_ice';
  const result = await pool.query(
    `
    UPDATE remote_desktop_sessions
    SET ${column} = COALESCE(${column}, '[]'::jsonb) || $2::jsonb,
        signaling_state = CASE
          WHEN signaling_state IN ('requested', 'expired') THEN signaling_state
          ELSE 'ice-exchange'
        END,
        updated_at = NOW()
    WHERE id = $1
      AND status IN ('waiting_for_agent', 'signaling', 'media_starting', 'connected')
      AND expires_at > NOW()
    RETURNING *
    `,
    [sessionId, JSON.stringify([candidate])]
  );
  return result.rows[0] || null;
}

async function setRemoteDesktopStatus(pool, sessionId, status, reason = null) {
  const allowed = new Set(['signaling', 'waiting_for_agent', 'media_starting', 'connected', 'ended', 'expired', 'failed', 'denied']);
  const nextStatus = allowed.has(status) ? status : 'failed';
  const result = await pool.query(
    `
    UPDATE remote_desktop_sessions
    SET status = $2,
        started_at = CASE WHEN $2 = 'connected' THEN COALESCE(started_at, NOW()) ELSE started_at END,
        ended_at = CASE WHEN $2 IN ('ended', 'expired', 'failed', 'denied') THEN COALESCE(ended_at, NOW()) ELSE ended_at END,
        failure_reason = CASE WHEN $2 IN ('failed', 'denied') THEN $3 ELSE failure_reason END,
        signaling_state = CASE
          WHEN $2 IN ('ended', 'expired', 'failed', 'denied') THEN $2
          WHEN $2 IN ('signaling', 'waiting_for_agent', 'media_starting', 'connected') THEN $2
          ELSE signaling_state
        END,
        transport_state = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [sessionId, nextStatus, reason]
  );
  return result.rows[0] || null;
}

function publicSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    deviceId: session.device_id,
    status: session.status,
    sessionType: session.session_type,
    signalingState: session.signaling_state,
    transportState: session.transport_state,
    createdAt: session.created_at,
    expiresAt: session.expires_at,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    failureReason: session.failure_reason,
    agentAnswer: session.agent_answer || null,
    agentIce: session.agent_ice || [],
    ice: publicIceConfig(),
  };
}

function publicAgentSession(session) {
  const base = publicSession(session);
  if (!base) return null;
  return {
    ...base,
    browserOffer: session.browser_offer || null,
    browserIce: session.browser_ice || [],
  };
}

module.exports = {
  REMOTE_DESKTOP_SESSION_SECONDS,
  desktopCapabilityForDevice,
  createRemoteDesktopSession,
  expireRemoteDesktopSession,
  getRemoteDesktopSessionForAgent,
  getRemoteDesktopSessionForUser,
  listPendingRemoteDesktopSessions,
  publicAgentSession,
  publicSession,
  setRemoteDesktopAnswer,
  setRemoteDesktopIce: appendRemoteDesktopIce,
  setRemoteDesktopOffer,
  setRemoteDesktopStatus,
  sessionExpired,
};
