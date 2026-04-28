const { agentSharedSecret } = require('./config');
const pool = require('./db/db');
const { verifyAdminCredentials: verifyAccessAdminCredentials } = require('./access/users');
const { clearAdminCookies, REFRESH_COOKIE, setAdminCookies } = require('./auth/cookies');
const { authMiddleware } = require('./auth/middleware');
const { createLoginRateLimiter } = require('./auth/rate_limit');
const {
  createAdminSession,
  requestIp,
  revokeAdminSession,
  rotateAdminSession,
} = require('./auth/sessions');
const { signAccessToken, verifyAccessToken } = require('./auth/tokens');

const loginRateLimiter = createLoginRateLimiter();

async function authenticateAdmin(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const ip = requestIp(req);
  const rateLimit = loginRateLimiter.check(ip, email);

  if (!rateLimit.allowed) {
    return {
      ok: false,
      statusCode: 429,
      email,
      error: 'Too many login attempts. Try again later.',
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    };
  }

  const valid = await verifyAccessAdminCredentials(pool, email, password);
  if (!valid.ok) {
    loginRateLimiter.recordFailure(ip, email);
    return {
      ok: false,
      statusCode: 401,
      email,
      error: 'Invalid credentials',
    };
  }

  loginRateLimiter.recordSuccess(ip, email);
  const session = await createAdminSession(pool, valid.email, req);
  setAdminCookies(res, session, req);
  return {
    ok: true,
    email: valid.email,
    session,
  };
}

async function refreshAdminSession(req, res) {
  const session = await rotateAdminSession(pool, req.cookies?.[REFRESH_COOKIE], req);
  if (!session) {
    return null;
  }
  setAdminCookies(res, session, req);
  return session;
}

async function logoutAdmin(req, res) {
  await revokeAdminSession(pool, req.rotatedRefreshToken || req.cookies?.[REFRESH_COOKIE]);
  clearAdminCookies(res, req);
}

function agentAuthMiddleware(req, res, next) {
  const token =
    req.get('x-setulink-agent-token') ||
    req.get('x-agent-token') ||
    req.body?.agentToken ||
    req.query?.agentToken;

  if (!agentSharedSecret || token !== agentSharedSecret) {
    return res.status(401).json({ error: 'Invalid agent credentials' });
  }

  next();
}

module.exports = {
  agentAuthMiddleware,
  authenticateAdmin,
  authMiddleware,
  logoutAdmin,
  refreshAdminSession,
  signToken: signAccessToken,
  verifyToken(token) {
    const result = verifyAccessToken(token);
    return result.valid ? result.payload : null;
  },
};
