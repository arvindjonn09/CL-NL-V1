const crypto = require('crypto');
const { cookieDomain, secureCookies } = require('../config');
const { requestCookieScope } = require('../auth/cookies');
const { signAccessToken, verifyAccessToken } = require('../auth/tokens');
const { requestIp, requestUserAgent } = require('../auth/sessions');

const REMOTE_ACCESS_COOKIE = 'remote_access_session';
const REMOTE_ACCESS_SESSION_SECONDS = Number(process.env.REMOTE_ACCESS_SESSION_SECONDS || 8 * 60 * 60);

function remoteCookieOptions(maxAgeSeconds = REMOTE_ACCESS_SESSION_SECONDS, req = null) {
  const scope = requestCookieScope(req);
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: req ? scope.secure : secureCookies,
    path: '/',
    maxAge: maxAgeSeconds * 1000,
    expires: new Date(Date.now() + maxAgeSeconds * 1000),
    ...((req ? scope.domain : cookieDomain) ? { domain: req ? scope.domain : cookieDomain } : {}),
  };
}

function clearRemoteAccessCookie(res, req = null) {
  const scope = requestCookieScope(req);
  res.clearCookie(REMOTE_ACCESS_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req ? scope.secure : secureCookies,
    path: '/',
    ...((req ? scope.domain : cookieDomain) ? { domain: req ? scope.domain : cookieDomain } : {}),
  });
}

async function createRemoteAccessSession(pool, email, req) {
  const sessionId = crypto.randomUUID();
  await pool.query(
    `
    INSERT INTO remote_access_sessions (id, email, issued_at, expires_at, ip, user_agent)
    VALUES ($1, $2, NOW(), NOW() + ($3::text || ' seconds')::interval, $4, $5)
    `,
    [
      sessionId,
      email,
      REMOTE_ACCESS_SESSION_SECONDS,
      requestIp(req),
      requestUserAgent(req),
    ]
  );

  return {
    sessionId,
    email,
    accessToken: signAccessToken({
      purpose: 'remote-access',
      email,
      sid: sessionId,
    }, { expiresIn: REMOTE_ACCESS_SESSION_SECONDS }),
  };
}

async function revokeRemoteAccessSession(pool, sessionId) {
  if (!sessionId) return false;
  const result = await pool.query(
    `
    UPDATE remote_access_sessions
    SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE id = $1 AND revoked_at IS NULL
    `,
    [sessionId]
  );
  return result.rowCount > 0;
}

async function isRemoteAccessSessionActive(pool, sessionId) {
  if (!sessionId) return false;
  const result = await pool.query(
    `
    SELECT id
    FROM remote_access_sessions
    WHERE id = $1
      AND revoked_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
    `,
    [sessionId]
  );
  return result.rowCount > 0;
}

function setRemoteAccessCookie(res, session, req = null) {
  res.cookie(REMOTE_ACCESS_COOKIE, session.accessToken, remoteCookieOptions(REMOTE_ACCESS_SESSION_SECONDS, req));
}

async function remoteAccessMiddleware(pool, userStore, req, res, next) {
  const token = req.cookies?.[REMOTE_ACCESS_COOKIE];
  if (!token) return res.status(401).json({ error: 'Remote access session required' });

  const verification = verifyAccessToken(token);
  if (!verification.valid || verification.payload.purpose !== 'remote-access') {
    return res.status(401).json({ error: 'Invalid remote access session' });
  }

  const active = await isRemoteAccessSessionActive(pool, verification.payload.sid);
  const user = await userStore.getUser(verification.payload.email);
  if (!active || !user) {
    return res.status(401).json({ error: 'Invalid remote access session' });
  }

  req.remoteUser = {
    email: user.email,
    displayName: user.displayName,
    isActive: user.isActive,
    remoteAccessEnabled: user.remoteAccessEnabled,
    deviceScopeMode: user.deviceScopeMode,
    deviceIds: user.deviceIds || [],
    sid: verification.payload.sid,
  };
  return next();
}

module.exports = {
  REMOTE_ACCESS_COOKIE,
  REMOTE_ACCESS_SESSION_SECONDS,
  clearRemoteAccessCookie,
  createRemoteAccessSession,
  isRemoteAccessSessionActive,
  remoteAccessMiddleware,
  remoteCookieOptions,
  revokeRemoteAccessSession,
  setRemoteAccessCookie,
};
