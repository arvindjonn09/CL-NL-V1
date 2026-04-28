const pool = require('../db/db');
const { CURRENT_OPERATOR_ACK_VERSION, hasCurrentAcknowledgement } = require('../acknowledgement');
const { REFRESH_COOKIE, setAdminCookies } = require('./cookies');
const { isSessionActive, rotateAdminSession } = require('./sessions');
const { verifyAccessToken } = require('./tokens');

function isAcknowledgementExemptPath(path = '') {
  return path === '/api/auth/acknowledgement' ||
    path === '/api/auth/login' ||
    path === '/api/auth/logout' ||
    path === '/api/auth/refresh';
}

async function attachUserAndContinue(poolInstance, req, res, next, user) {
  req.user = user;

  if (isAcknowledgementExemptPath(req.path)) {
    return next();
  }

  if (await hasCurrentAcknowledgement(poolInstance, user.email)) {
    return next();
  }

  return res.status(403).json({
    error: 'Operator acknowledgement required',
    acknowledgementRequired: true,
    version: CURRENT_OPERATOR_ACK_VERSION,
  });
}

function createAuthMiddleware(poolInstance) {
  return async function authMiddleware(req, res, next) {
  const token = req.cookies?.session;

  if (token) {
    const verification = verifyAccessToken(token);
    if (verification.valid) {
      const active = await isSessionActive(poolInstance, verification.payload.sid);
      if (active) {
        return attachUserAndContinue(poolInstance, req, res, next, {
          email: verification.payload.email,
          sid: verification.payload.sid,
        });
      }
    }
  }

  const rotated = await rotateAdminSession(poolInstance, req.cookies?.[REFRESH_COOKIE], req);
  if (rotated) {
    setAdminCookies(res, rotated, req);
    req.rotatedRefreshToken = rotated.refreshToken;
    return attachUserAndContinue(poolInstance, req, res, next, {
      email: rotated.adminUser,
      sid: rotated.sessionId,
    });
  }

  return res.status(401).json({ error: 'Invalid session' });
  };
}

const authMiddleware = createAuthMiddleware(pool);

module.exports = {
  authMiddleware,
  createAuthMiddleware,
  isAcknowledgementExemptPath,
};
