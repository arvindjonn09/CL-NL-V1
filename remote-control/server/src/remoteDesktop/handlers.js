const { audit } = require('../audit/audit');
const { remoteAccessMiddleware } = require('../remoteAccess/session');
const {
  getRemoteDesktopSessionForAgent,
  getRemoteDesktopSessionForUser,
  listPendingRemoteDesktopSessions,
  publicAgentSession,
  publicSession,
  setRemoteDesktopAnswer,
  setRemoteDesktopIce,
  setRemoteDesktopOffer,
  setRemoteDesktopStatus,
} = require('./sessions');

function candidateType(candidate) {
  const text = String(candidate?.candidate || '');
  const match = text.match(/\btyp\s+([a-z0-9-]+)/i);
  return match ? match[1] : 'unknown';
}

function logDesktop(stage, sessionId, fields = {}) {
  console.info('remote-desktop', { stage, sessionId, ...fields });
}

function auditDesktop(pool, req, {
  action,
  session = null,
  deviceId = null,
  result = 'success',
  detail = null,
  identity = null,
}) {
  return audit(pool, req, {
    adminIdentity: identity || session?.remote_user_identity || req.remoteUser?.email || null,
    action,
    targetType: 'device',
    targetId: deviceId || session?.device_id || null,
    result,
    detail: [session?.id ? `session=${session.id}` : null, detail].filter(Boolean).join('; ') || null,
  });
}

function sanitizeSignalingError(res, statusCode, message = 'Remote desktop session unavailable') {
  return res.status(statusCode).json({ error: message });
}

function registerRemoteDesktopRoutes(app, {
  pool,
  userStore,
  agentAuthMiddleware,
} = {}) {
  const remoteAuth = (req, res, next) => remoteAccessMiddleware(pool, userStore, req, res, next);

  async function loadRemoteSession(req, res) {
    const { session, expired } = await getRemoteDesktopSessionForUser(pool, req.params.id, req.remoteUser);
    if (!session) {
      sanitizeSignalingError(res, 404);
      return null;
    }
    if (expired) {
      await auditDesktop(pool, req, {
        action: 'remote_desktop_expired',
        session,
        result: 'failure',
        detail: 'session expired',
      });
    }
    return session;
  }

  app.get('/api/remoteaccess/desktop/sessions/:id', remoteAuth, async (req, res) => {
    try {
      const session = await loadRemoteSession(req, res);
      if (!session) return null;
      logDesktop('browser-session-polled', session.id, {
        status: session.status,
        signalingState: session.signaling_state,
        transportState: session.transport_state,
        agentIceCount: Array.isArray(session.agent_ice) ? session.agent_ice.length : 0,
      });
      return res.json({ session: publicSession(session) });
    } catch (err) {
      console.error('GET /api/remoteaccess/desktop/sessions/:id error:', err);
      return sanitizeSignalingError(res, 500);
    }
  });

  app.post('/api/remoteaccess/desktop/sessions/:id/offer', remoteAuth, async (req, res) => {
    try {
      const session = await loadRemoteSession(req, res);
      if (!session) return null;
      if (session.status === 'expired') {
        return sanitizeSignalingError(res, 410, 'Remote desktop session expired');
      }
      if (!req.body?.offer || typeof req.body.offer !== 'object') {
        return sanitizeSignalingError(res, 400, 'SDP offer is required');
      }

      const updated = await setRemoteDesktopOffer(pool, session.id, req.body.offer);
      if (!updated) return sanitizeSignalingError(res, 409, 'Remote desktop session is not ready for signaling');

      logDesktop('browser-offer-stored', session.id, {
        offerType: req.body.offer?.type || null,
      });
      await auditDesktop(pool, req, {
        action: 'remote_desktop_signaling_started',
        session: updated,
        detail: 'browser offer received',
      });
      return res.json({ session: publicSession(updated) });
    } catch (err) {
      console.error('POST /api/remoteaccess/desktop/sessions/:id/offer error:', err);
      return sanitizeSignalingError(res, 500);
    }
  });

  app.post('/api/remoteaccess/desktop/sessions/:id/ice', remoteAuth, async (req, res) => {
    try {
      const session = await loadRemoteSession(req, res);
      if (!session) return null;
      if (!req.body?.candidate || typeof req.body.candidate !== 'object') {
        return sanitizeSignalingError(res, 400, 'ICE candidate is required');
      }

      const updated = await setRemoteDesktopIce(pool, session.id, 'browser', req.body.candidate);
      if (!updated) return sanitizeSignalingError(res, 409, 'Remote desktop session is not accepting ICE');
      logDesktop('browser-ice-stored', session.id, {
        candidateType: candidateType(req.body.candidate),
      });
      return res.json({ success: true });
    } catch (err) {
      console.error('POST /api/remoteaccess/desktop/sessions/:id/ice error:', err);
      return sanitizeSignalingError(res, 500);
    }
  });

  app.post('/api/remoteaccess/desktop/sessions/:id/media-active', remoteAuth, async (req, res) => {
    try {
      const session = await loadRemoteSession(req, res);
      if (!session) return null;
      if (!['media_starting', 'connected'].includes(session.status)) {
        return sanitizeSignalingError(res, 409, 'Remote desktop media is not ready to activate');
      }

      const updated = await setRemoteDesktopStatus(pool, session.id, 'connected', 'browser media active');
      logDesktop('browser-media-active', session.id, {
        previousStatus: session.status,
        previousTransportState: session.transport_state,
      });
      await auditDesktop(pool, req, {
        action: 'remote_desktop_connected',
        session: updated,
        detail: 'browser media active',
      });
      return res.json({ session: publicSession(updated) });
    } catch (err) {
      console.error('POST /api/remoteaccess/desktop/sessions/:id/media-active error:', err);
      return sanitizeSignalingError(res, 500);
    }
  });

  app.post('/api/remoteaccess/desktop/sessions/:id/end', remoteAuth, async (req, res) => {
    try {
      const session = await loadRemoteSession(req, res);
      if (!session) return null;
      const ended = await setRemoteDesktopStatus(pool, session.id, 'ended');
      logDesktop('browser-session-ended', session.id, {
        previousStatus: session.status,
        previousTransportState: session.transport_state,
      });
      await auditDesktop(pool, req, {
        action: 'remote_desktop_ended',
        session: ended || session,
        detail: 'remote user ended session',
      });
      return res.json({ success: true });
    } catch (err) {
      console.error('POST /api/remoteaccess/desktop/sessions/:id/end error:', err);
      return sanitizeSignalingError(res, 500);
    }
  });

  if (agentAuthMiddleware) {
    app.get('/api/agent/remote-desktop/pending', agentAuthMiddleware, async (req, res) => {
      try {
        const deviceId = req.query?.id;
        if (!deviceId) return res.status(400).json({ error: 'id is required' });
        const sessions = await listPendingRemoteDesktopSessions(pool, deviceId);
        sessions.forEach((session) => logDesktop('agent-pending-session-listed', session.id, {
          deviceId,
          status: session.status,
          signalingState: session.signaling_state,
          transportState: session.transport_state,
        }));
        return res.json({ sessions });
      } catch (err) {
        console.error('GET /api/agent/remote-desktop/pending error:', err);
        return res.status(500).json({ error: 'Remote desktop pending lookup failed' });
      }
    });

    app.get('/api/agent/remote-desktop/sessions/:id', agentAuthMiddleware, async (req, res) => {
      try {
        const deviceId = req.query?.deviceId;
        if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });
        const { session } = await getRemoteDesktopSessionForAgent(pool, req.params.id, deviceId);
        if (!session) return res.status(404).json({ error: 'Remote desktop session not found' });
        logDesktop('agent-session-fetched', session.id, {
          status: session.status,
          signalingState: session.signaling_state,
          transportState: session.transport_state,
          browserIceCount: Array.isArray(session.browser_ice) ? session.browser_ice.length : 0,
          agentIceCount: Array.isArray(session.agent_ice) ? session.agent_ice.length : 0,
        });
        return res.json({ session: publicAgentSession(session) });
      } catch (err) {
        console.error('GET /api/agent/remote-desktop/sessions/:id error:', err);
        return res.status(500).json({ error: 'Remote desktop session lookup failed' });
      }
    });

    app.post('/api/agent/remote-desktop/sessions/:id/answer', agentAuthMiddleware, async (req, res) => {
      try {
        const deviceId = req.body?.deviceId;
        const { session } = await getRemoteDesktopSessionForAgent(pool, req.params.id, deviceId);
        if (!session) return res.status(404).json({ error: 'Remote desktop session not found' });
        if (!req.body?.answer || typeof req.body.answer !== 'object') {
          return res.status(400).json({ error: 'SDP answer is required' });
        }

        const updated = await setRemoteDesktopAnswer(pool, session.id, req.body.answer);
        if (!updated) return res.status(409).json({ error: 'Remote desktop session is not accepting an answer' });
        logDesktop('agent-answer-stored', session.id, {
          answerType: req.body.answer?.type || null,
        });
        return res.json({ session: publicSession(updated) });
      } catch (err) {
        console.error('POST /api/agent/remote-desktop/sessions/:id/answer error:', err);
        return res.status(500).json({ error: 'Remote desktop answer failed' });
      }
    });

    app.post('/api/agent/remote-desktop/sessions/:id/ice', agentAuthMiddleware, async (req, res) => {
      try {
        const deviceId = req.body?.deviceId;
        const { session } = await getRemoteDesktopSessionForAgent(pool, req.params.id, deviceId);
        if (!session) return res.status(404).json({ error: 'Remote desktop session not found' });
        if (!req.body?.candidate || typeof req.body.candidate !== 'object') {
          return res.status(400).json({ error: 'ICE candidate is required' });
        }

        const updated = await setRemoteDesktopIce(pool, session.id, 'agent', req.body.candidate);
        if (!updated) return res.status(409).json({ error: 'Remote desktop session is not accepting ICE' });
        logDesktop('agent-ice-stored', session.id, {
          candidateType: candidateType(req.body.candidate),
        });
        return res.json({ success: true });
      } catch (err) {
        console.error('POST /api/agent/remote-desktop/sessions/:id/ice error:', err);
        return res.status(500).json({ error: 'Remote desktop ICE failed' });
      }
    });

    app.post('/api/agent/remote-desktop/sessions/:id/status', agentAuthMiddleware, async (req, res) => {
      try {
        const deviceId = req.body?.deviceId;
        const { session } = await getRemoteDesktopSessionForAgent(pool, req.params.id, deviceId);
        if (!session) return res.status(404).json({ error: 'Remote desktop session not found' });

        const updated = await setRemoteDesktopStatus(pool, session.id, req.body?.status, req.body?.reason || null);
        logDesktop('agent-status-stored', session.id, {
          previousStatus: session.status,
          nextStatus: updated?.status || null,
          reason: req.body?.reason || null,
        });
        const auditAction = updated?.status === 'connected'
          ? 'remote_desktop_connected'
          : updated?.status === 'failed'
            ? 'remote_desktop_failed'
            : updated?.status === 'expired'
              ? 'remote_desktop_expired'
              : updated?.status === 'ended'
                ? 'remote_desktop_ended'
                : null;
        if (auditAction) {
          await auditDesktop(pool, req, {
            action: auditAction,
            session: updated,
            result: updated.status === 'failed' || updated.status === 'expired' ? 'failure' : 'success',
            detail: updated.failure_reason || req.body?.reason || `status=${updated.status}`,
          });
        }
        return res.json({ session: publicSession(updated) });
      } catch (err) {
        console.error('POST /api/agent/remote-desktop/sessions/:id/status error:', err);
        return res.status(500).json({ error: 'Remote desktop status update failed' });
      }
    });
  }
}

module.exports = {
  registerRemoteDesktopRoutes,
};
