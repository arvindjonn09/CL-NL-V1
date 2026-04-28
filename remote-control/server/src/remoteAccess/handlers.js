const { audit } = require('../audit/audit');
const { createLoginRateLimiter } = require('../auth/rate_limit');
const {
  getRemoteAccessDashboard,
  getRemoteAccessDeviceDetail,
} = require('./dashboard');
const {
  clearRemoteAccessCookie,
  createRemoteAccessSession,
  remoteAccessMiddleware,
  revokeRemoteAccessSession,
  setRemoteAccessCookie,
} = require('./session');
const {
  createRemoteSessionGrant,
  markRemoteSessionEnded,
  markRemoteSessionStarted,
  remoteUserAllowed,
  validateRemoteSessionGrant,
} = require('./grants');
const {
  createRemoteDesktopSession,
  publicSession,
} = require('../remoteDesktop/sessions');
const {
  canResend,
  issueVerificationCode,
  verifyCode,
} = require('./verification');

const loginRateLimiter = createLoginRateLimiter({
  maxAttempts: Number(process.env.REMOTE_ACCESS_LOGIN_ATTEMPTS || 5),
});

function safeEmail(req) {
  return String(req.body?.email || '').trim().toLowerCase();
}

function auditRemoteSession(pool, req, {
  action,
  deviceId,
  result,
  detail,
  sessionId = null,
  identity = null,
}) {
  return audit(pool, req, {
    adminIdentity: identity || req.remoteUser?.email || null,
    action,
    targetType: 'device',
    targetId: deviceId || null,
    result,
    detail: [sessionId ? `session=${sessionId}` : null, detail].filter(Boolean).join('; ') || null,
  });
}

function registerRemoteAccessRoutes(app, {
  pool,
  userStore,
  agentAuthMiddleware = null,
  getConnectedAgent = null,
} = {}) {
  const remoteAuth = (req, res, next) => remoteAccessMiddleware(pool, userStore, req, res, next);
  const isAgentReachable = (deviceId) => {
    if (typeof getConnectedAgent !== 'function') return false;
    const agent = getConnectedAgent(deviceId);
    return Boolean(agent && agent.readyState === 1);
  };

  app.post('/api/remoteaccess/login', async (req, res) => {
    const email = safeEmail(req);
    const ip = req.ip || req.get?.('x-forwarded-for') || req.socket?.remoteAddress || null;
    try {
      const rateLimit = loginRateLimiter.check(ip, email);
      if (!rateLimit.allowed) {
        await audit(pool, req, {
          adminIdentity: email || null,
          action: 'remoteaccess_login',
          targetType: 'remote_access_session',
          result: 'failure',
          detail: 'rate limited',
        });
        res.set('Retry-After', String(rateLimit.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
      }

      const user = await userStore.verifyCredentials(email, String(req.body?.password || ''));
      if (!user) {
        loginRateLimiter.recordFailure(ip, email);
        await audit(pool, req, {
          adminIdentity: email || null,
          action: 'remoteaccess_login',
          targetType: 'remote_access_session',
          result: 'failure',
          detail: 'invalid credentials',
        });
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      loginRateLimiter.recordSuccess(ip, email);
      const challenge = await issueVerificationCode(pool, user, req);
      await audit(pool, req, {
        adminIdentity: email,
        action: 'remoteaccess_code_sent',
        targetType: 'remote_access_verification',
        targetId: challenge.challengeId,
        result: 'success',
        detail: 'verification code sent',
      });

      return res.json({
        success: true,
        verificationRequired: true,
        challengeId: challenge.challengeId,
        expiresInSeconds: challenge.expiresInSeconds,
        resendAfterSeconds: challenge.resendAfterSeconds,
      });
    } catch (err) {
      console.error('POST /api/remoteaccess/login error:', err);
      return res.status(500).json({ error: 'Login failed' });
    }
  });

  app.post('/api/remoteaccess/resend', async (req, res) => {
    try {
      const check = await canResend(pool, req.body?.challengeId);
      if (!check.ok) {
        await audit(pool, req, {
          adminIdentity: check.email || null,
          action: 'remoteaccess_resend',
          targetType: 'remote_access_verification',
          targetId: req.body?.challengeId || null,
          result: 'failure',
          detail: check.error,
        });
        if (check.retryAfterSeconds) res.set('Retry-After', String(check.retryAfterSeconds));
        return res.status(check.statusCode).json({ error: check.error, retryAfterSeconds: check.retryAfterSeconds });
      }

      const user = await userStore.getUser(check.email);
      if (!user) {
        return res.status(401).json({ error: 'Verification challenge expired' });
      }
      const challenge = await issueVerificationCode(pool, user, req);
      await audit(pool, req, {
        adminIdentity: user.email,
        action: 'remoteaccess_resend',
        targetType: 'remote_access_verification',
        targetId: challenge.challengeId,
        result: 'success',
        detail: 'verification code resent',
      });
      return res.json({
        success: true,
        challengeId: challenge.challengeId,
        expiresInSeconds: challenge.expiresInSeconds,
        resendAfterSeconds: challenge.resendAfterSeconds,
      });
    } catch (err) {
      console.error('POST /api/remoteaccess/resend error:', err);
      return res.status(500).json({ error: 'Resend failed' });
    }
  });

  app.post('/api/remoteaccess/verify', async (req, res) => {
    try {
      const result = await verifyCode(pool, req.body?.challengeId, req.body?.code);
      if (!result.ok) {
        await audit(pool, req, {
          adminIdentity: result.email || null,
          action: 'remoteaccess_verify',
          targetType: 'remote_access_verification',
          targetId: req.body?.challengeId || null,
          result: 'failure',
          detail: result.error,
        });
        return res.status(result.statusCode).json({ error: result.error });
      }

      const user = await userStore.getUser(result.email);
      if (!user) {
        return res.status(401).json({ error: 'Invalid remote access user' });
      }
      const session = await createRemoteAccessSession(pool, user.email, req);
      setRemoteAccessCookie(res, session, req);
      await audit(pool, req, {
        adminIdentity: user.email,
        action: 'remoteaccess_verify',
        targetType: 'remote_access_session',
        targetId: session.sessionId,
        result: 'success',
        detail: 'verification success',
      });
      return res.json({ success: true });
    } catch (err) {
      console.error('POST /api/remoteaccess/verify error:', err);
      return res.status(500).json({ error: 'Verification failed' });
    }
  });

  app.post('/api/remoteaccess/logout', remoteAuth, async (req, res) => {
    try {
      await revokeRemoteAccessSession(pool, req.remoteUser.sid);
      clearRemoteAccessCookie(res, req);
      await audit(pool, req, {
        adminIdentity: req.remoteUser.email,
        action: 'remoteaccess_logout',
        targetType: 'remote_access_session',
        targetId: req.remoteUser.sid,
        result: 'success',
      });
      return res.json({ success: true });
    } catch (err) {
      console.error('POST /api/remoteaccess/logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
  });

  app.get('/api/remoteaccess/dashboard', remoteAuth, async (req, res) => {
    try {
      return res.json(await getRemoteAccessDashboard(pool, req.remoteUser));
    } catch (err) {
      console.error('GET /api/remoteaccess/dashboard error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
  });

  app.get('/api/remoteaccess/devices/:id', remoteAuth, async (req, res) => {
    try {
      const detail = await getRemoteAccessDeviceDetail(pool, req.remoteUser, req.params.id, {
        isAgentReachable,
      });
      if (!detail) {
        return res.status(404).json({ error: 'Device not found' });
      }
      return res.json(detail);
    } catch (err) {
      console.error('GET /api/remoteaccess/devices/:id error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
  });

  app.post('/api/remoteaccess/devices/:id/connect', remoteAuth, async (req, res) => {
    const deviceId = req.params.id;
    try {
      await auditRemoteSession(pool, req, {
        action: 'remote_session_connect_requested',
        deviceId,
        result: 'success',
        detail: 'connect requested',
      });
      await auditRemoteSession(pool, req, {
        action: 'remote_desktop_requested',
        deviceId,
        result: 'success',
        detail: 'desktop connect requested',
      });

      if (!remoteUserAllowed(req.remoteUser)) {
        await auditRemoteSession(pool, req, {
          action: 'remote_session_denied',
          deviceId,
          result: 'failure',
          detail: 'remote user inactive or disabled',
        });
        await auditRemoteSession(pool, req, {
          action: 'remote_desktop_denied',
          deviceId,
          result: 'failure',
          detail: 'remote user inactive or disabled',
        });
        return res.status(403).json({ error: 'Remote access is not enabled for this user' });
      }

      const detail = await getRemoteAccessDeviceDetail(pool, req.remoteUser, deviceId, {
        isAgentReachable,
      });
      if (!detail) {
        await auditRemoteSession(pool, req, {
          action: 'remote_session_denied',
          deviceId,
          result: 'failure',
          detail: 'device out of scope',
        });
        await auditRemoteSession(pool, req, {
          action: 'remote_desktop_denied',
          deviceId,
          result: 'failure',
          detail: 'device out of scope',
        });
        return res.status(404).json({ error: 'Device not found' });
      }

      if (!detail.remoteConnect?.available || !detail.remoteDesktop?.available) {
        const reason = detail.remoteDesktop?.reason || detail.remoteConnect?.reason || 'not ready';
        const state = detail.remoteDesktop?.state || detail.remoteConnect?.state || 'unavailable';
        const label = detail.remoteDesktop?.label || detail.remoteConnect?.label || 'Remote desktop unavailable';
        await auditRemoteSession(pool, req, {
          action: 'remote_session_denied',
          deviceId,
          result: 'failure',
          detail: reason,
        });
        await auditRemoteSession(pool, req, {
          action: 'remote_desktop_denied',
          deviceId,
          result: 'failure',
          detail: reason,
        });
        const statusCode = state === 'offline' ? 409 : 503;
        return res.status(statusCode).json({
          error: label,
          state,
          reason,
        });
      }

      const created = await createRemoteSessionGrant(pool, {
        remoteUserIdentity: req.remoteUser.email,
        deviceId,
      });

      await auditRemoteSession(pool, req, {
        action: 'remote_session_granted',
        deviceId,
        result: 'success',
        sessionId: created.grant.id,
        detail: detail.remoteConnect?.reason || 'grant issued',
      });

      const desktopSession = await createRemoteDesktopSession(pool, {
        grant: created.grant,
        remoteUserIdentity: req.remoteUser.email,
        deviceId,
      });

      await auditRemoteSession(pool, req, {
        action: 'remote_desktop_granted',
        deviceId,
        result: 'success',
        sessionId: desktopSession.id,
        detail: detail.remoteDesktop?.reason || 'desktop session requested',
      });

      return res.json({
        success: true,
        session: {
          id: created.grant.id,
          deviceId,
          status: created.grant.status,
          expiresAt: created.grant.expires_at,
          expiresInSeconds: created.expiresInSeconds,
          token: created.token,
        },
        connection: {
          state: detail.remoteConnect.state,
          transport: detail.remoteConnect.transport,
        },
        desktopSession: publicSession(desktopSession),
        remoteDesktop: detail.remoteDesktop,
      });
    } catch (err) {
      await auditRemoteSession(pool, req, {
        action: 'remote_session_failed',
        deviceId,
        result: 'failure',
        detail: err.message,
      });
      await auditRemoteSession(pool, req, {
        action: 'remote_desktop_failed',
        deviceId,
        result: 'failure',
        detail: err.message,
      });
      console.error('POST /api/remoteaccess/devices/:id/connect error:', err);
      return res.status(500).json({ error: 'Remote session could not be created' });
    }
  });

  if (agentAuthMiddleware) {
    app.post('/api/agent/remote-sessions/start', agentAuthMiddleware, async (req, res) => {
      try {
        const deviceId = req.body?.deviceId;
        const token = req.body?.sessionToken;
        if (!deviceId || !token) {
          return res.status(400).json({ error: 'deviceId and sessionToken are required' });
        }

        const validation = await validateRemoteSessionGrant(pool, token, deviceId);
        if (!validation.ok) {
          await auditRemoteSession(pool, req, {
            action: validation.reason === 'expired-grant' ? 'remote_session_expired' : 'remote_session_denied',
            deviceId,
            result: 'failure',
            detail: validation.reason,
            sessionId: validation.grant?.id || null,
            identity: validation.grant?.remote_user_identity || null,
          });
          return res.status(validation.statusCode).json({ error: 'Invalid remote session grant' });
        }

        const started = await markRemoteSessionStarted(pool, validation.grant.id);
        if (!started) {
          return res.status(409).json({ error: 'Remote session grant is not startable' });
        }

        await auditRemoteSession(pool, req, {
          action: 'remote_session_started',
          deviceId,
          result: 'success',
          sessionId: started.id,
          identity: started.remote_user_identity,
          detail: 'agent accepted unattended grant',
        });
        return res.json({
          success: true,
          session: {
            id: started.id,
            deviceId: started.device_id,
            status: started.status,
            startedAt: started.started_at,
          },
        });
      } catch (err) {
        console.error('POST /api/agent/remote-sessions/start error:', err);
        return res.status(500).json({ error: 'Remote session start failed' });
      }
    });

    app.post('/api/agent/remote-sessions/end', agentAuthMiddleware, async (req, res) => {
      try {
        const sessionId = req.body?.sessionId;
        const status = req.body?.status;
        if (!sessionId) {
          return res.status(400).json({ error: 'sessionId is required' });
        }

        const ended = await markRemoteSessionEnded(pool, sessionId, status, req.body?.reason || null);
        if (!ended) {
          return res.status(404).json({ error: 'Remote session grant not found' });
        }

        await auditRemoteSession(pool, req, {
          action: ended.status === 'failed' ? 'remote_session_failed' : 'remote_session_ended',
          deviceId: ended.device_id,
          result: ended.status === 'failed' ? 'failure' : 'success',
          sessionId: ended.id,
          identity: ended.remote_user_identity,
          detail: ended.failure_reason || 'agent ended unattended session',
        });
        return res.json({ success: true });
      } catch (err) {
        console.error('POST /api/agent/remote-sessions/end error:', err);
        return res.status(500).json({ error: 'Remote session end failed' });
      }
    });
  }
}

module.exports = {
  registerRemoteAccessRoutes,
};
