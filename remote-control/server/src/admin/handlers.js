const { buildAdminOverview, buildAdminUsers, fleetSummary } = require('./summary');
const { audit } = require('../audit/audit');
const {
  createAccessUser,
  getAccessUserById,
  listAccessUsers,
  recentUserAudit,
  resetAccessUserPassword,
  revokeUserSessions,
  updateAccessUser,
} = require('../access/users');
const { sendPasswordResetConfirmationEmail } = require('../email');

const BACKEND_PUBLIC = process.env.ADMIN_BACKEND_PUBLIC_URL || 'https://netraapi.shivomsangha.com/api/health';
const FRONTEND_PUBLIC = process.env.ADMIN_FRONTEND_PUBLIC_URL || 'https://netralink.shivomsangha.com';
const FRONTEND_LOCAL = process.env.ADMIN_FRONTEND_LOCAL_URL || 'http://localhost:3201';

async function checkUrl(url, expected = '', timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return {
      url,
      ok: response.ok && (!expected || text.includes(expected)),
      status: response.status,
      reason: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      url,
      ok: false,
      status: null,
      reason: err?.name === 'AbortError' ? 'timeout' : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function recentHealthEvents(pool, limit = 8) {
  const result = await pool.query(
    `
    SELECT *
    FROM device_health_events
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );
  return result.rows;
}

async function latestAdminAcknowledgements(pool) {
  const result = await pool.query(
    `
    SELECT DISTINCT ON (admin_identity)
      admin_identity,
      version,
      accepted_at
    FROM admin_operator_acknowledgements
    ORDER BY admin_identity, accepted_at DESC
    `
  );
  return result.rows;
}

async function latestAdminSessions(pool) {
  const result = await pool.query(
    `
    SELECT DISTINCT ON (admin_user)
      admin_user,
      issued_at
    FROM admin_sessions
    ORDER BY admin_user, issued_at DESC
    `
  );
  return result.rows;
}

async function latestRemoteAccessSessions(pool) {
  const result = await pool.query(
    `
    SELECT DISTINCT ON (email)
      email,
      issued_at,
      revoked_at
    FROM remote_access_sessions
    ORDER BY email, issued_at DESC
    `
  );
  return result.rows;
}

async function listDevicesForScope(pool) {
  const result = await pool.query(
    `
    SELECT id::text AS id, display_name, hostname, status
    FROM devices
    ORDER BY COALESCE(display_name, hostname, id::text)
    `
  );
  return result.rows.map((device) => ({
    id: device.id,
    label: device.display_name || device.hostname || device.id,
    status: device.status,
  }));
}

function adminChangeRequiresConfirmation(before, after) {
  return before?.userType !== after?.userType && (before?.userType === 'admin' || after?.userType === 'admin');
}

function assertTypedConfirmation(req, user) {
  if (String(req.body?.confirmation || '').trim().toLowerCase() !== String(user.email || '').toLowerCase()) {
    const err = new Error(`Type ${user.email} to confirm this admin role change`);
    err.statusCode = 400;
    throw err;
  }
}

function registerAdminRoutes(app, { pool, authMiddleware, getDeviceSummaries, userStore }) {
  app.get('/api/admin/overview', authMiddleware, async (_req, res) => {
    try {
      const [devices, healthEvents] = await Promise.all([
        getDeviceSummaries(),
        recentHealthEvents(pool, 8),
      ]);
      const remoteUsers = userStore?.listUsers ? await userStore.listUsers() : [];
      res.json(buildAdminOverview({
        devices,
        remoteUsers,
        healthEvents,
      }));
    } catch (err) {
      console.error('GET /api/admin/overview error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.get('/api/admin/users', authMiddleware, async (_req, res) => {
    try {
      const [acknowledgements, sessions, remoteSessions, accessUsers, devices] = await Promise.all([
        latestAdminAcknowledgements(pool),
        latestAdminSessions(pool),
        latestRemoteAccessSessions(pool),
        listAccessUsers(pool),
        listDevicesForScope(pool),
      ]);
      const latestRemoteByEmail = new Map(remoteSessions.map((row) => [row.email, row]));
      const users = buildAdminUsers({
        remoteUsers: accessUsers.map((user) => ({
          ...user,
          lastLoginAt: user.lastLoginAt || latestRemoteByEmail.get(user.email)?.issued_at || null,
        })),
        acknowledgements,
        sessions,
      });
      res.json({
        users,
        devices,
        counts: {
          total: users.length,
          admins: users.filter((user) => user.userType === 'admin').length,
          remoteAccess: users.filter((user) => user.remoteAccessEnabled).length,
          disabled: users.filter((user) => user.status === 'disabled').length,
        },
      });
    } catch (err) {
      console.error('GET /api/admin/users error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.post('/api/admin/users', authMiddleware, async (req, res) => {
    try {
      const user = await createAccessUser(pool, req.body || {});
      await audit(pool, req, {
        action: 'user_created',
        targetType: 'access_user',
        targetId: user.email,
        result: 'success',
        detail: `type=${user.userType}; remote_access=${user.remoteAccessEnabled}; scope=${user.deviceScopeMode}`,
      });
      res.status(201).json({ user });
    } catch (err) {
      await audit(pool, req, {
        action: 'user_created',
        targetType: 'access_user',
        targetId: req.body?.email || null,
        result: 'failure',
        detail: err.message,
      });
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      console.error('POST /api/admin/users error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.get('/api/admin/users/:id', authMiddleware, async (req, res) => {
    try {
      const user = await getAccessUserById(pool, req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      const auditEvents = await recentUserAudit(pool, user.email, 10);
      res.json({ user, auditEvents });
    } catch (err) {
      console.error('GET /api/admin/users/:id error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.patch('/api/admin/users/:id', authMiddleware, async (req, res) => {
    try {
      const before = await getAccessUserById(pool, req.params.id);
      if (!before) return res.status(404).json({ error: 'User not found' });
      const draft = {
        ...before,
        userType: req.body?.userType === undefined ? before.userType : req.body.userType,
      };
      if (adminChangeRequiresConfirmation(before, draft)) {
        assertTypedConfirmation(req, before);
      }

      const user = await updateAccessUser(pool, req.params.id, req.body || {});
      if (!user.isActive || before.userType !== user.userType || !user.remoteAccessEnabled) {
        await revokeUserSessions(pool, user);
      }

      const actions = [];
      if (before.userType !== user.userType) actions.push(user.userType === 'admin' ? 'admin_granted' : 'admin_removed');
      if (before.remoteAccessEnabled !== user.remoteAccessEnabled) actions.push(user.remoteAccessEnabled ? 'remote_access_enabled' : 'remote_access_disabled');
      if (before.deviceScopeMode !== user.deviceScopeMode || before.deviceIds.join(',') !== user.deviceIds.join(',')) actions.push('device_scope_changed');
      if (before.isActive !== user.isActive) actions.push(user.isActive ? 'user_enabled' : 'user_disabled');
      if (!actions.length) actions.push('user_updated');

      for (const action of actions) {
        await audit(pool, req, {
          action,
          targetType: 'access_user',
          targetId: user.email,
          result: 'success',
          detail: `type=${user.userType}; active=${user.isActive}; remote_access=${user.remoteAccessEnabled}; scope=${user.deviceScopeMode}; devices=${user.deviceIds.length}`,
        });
      }
      res.json({ user });
    } catch (err) {
      await audit(pool, req, {
        action: 'user_updated',
        targetType: 'access_user',
        targetId: req.params.id,
        result: 'failure',
        detail: err.message,
      });
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      console.error('PATCH /api/admin/users/:id error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.post('/api/admin/users/:id/reset-password', authMiddleware, async (req, res) => {
    try {
      const user = await getAccessUserById(pool, req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      await resetAccessUserPassword(pool, user.id, req.body?.password, req.body?.passwordChangeRequired !== false);
      const revoked = await revokeUserSessions(pool, user);
      let emailNotification = { sent: false };
      try {
        const delivery = await sendPasswordResetConfirmationEmail(pool, {
          email: user.email,
          displayName: user.displayName || user.name,
          resetBy: req.user?.email || null,
        });
        emailNotification = { sent: true, provider: delivery.provider };
      } catch (emailErr) {
        emailNotification = { sent: false, error: emailErr.message };
        console.error('password reset confirmation email failed:', emailErr);
      }
      await audit(pool, req, {
        action: 'password_reset',
        targetType: 'access_user',
        targetId: user.email,
        result: 'success',
        detail: `sessions_revoked=${revoked.adminSessions + revoked.remoteSessions}; email_notification=${emailNotification.sent ? 'sent' : 'failed'}`,
      });
      res.json({ success: true, revoked, emailNotification });
    } catch (err) {
      await audit(pool, req, {
        action: 'password_reset',
        targetType: 'access_user',
        targetId: req.params.id,
        result: 'failure',
        detail: err.message,
      });
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      console.error('POST /api/admin/users/:id/reset-password error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.post('/api/admin/users/:id/revoke-sessions', authMiddleware, async (req, res) => {
    try {
      const user = await getAccessUserById(pool, req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      const revoked = await revokeUserSessions(pool, user);
      await audit(pool, req, {
        action: 'session_revocation',
        targetType: 'access_user',
        targetId: user.email,
        result: 'success',
        detail: `admin=${revoked.adminSessions}; remote=${revoked.remoteSessions}`,
      });
      res.json({ success: true, revoked });
    } catch (err) {
      await audit(pool, req, {
        action: 'session_revocation',
        targetType: 'access_user',
        targetId: req.params.id,
        result: 'failure',
        detail: err.message,
      });
      console.error('POST /api/admin/users/:id/revoke-sessions error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.get('/api/admin/health', authMiddleware, async (_req, res) => {
    try {
      const [dbResult, devices, frontendLocal, backendPublic, frontendPublic] = await Promise.all([
        pool.query('SELECT 1 AS ok'),
        getDeviceSummaries(),
        checkUrl(FRONTEND_LOCAL, '<html'),
        checkUrl(BACKEND_PUBLIC, '"ok":true'),
        checkUrl(FRONTEND_PUBLIC, '<html'),
      ]);

      res.json({
        frontend: {
          local: frontendLocal,
          public: frontendPublic,
        },
        backend: {
          local: {
            ok: true,
            status: 200,
            url: '/api/health',
            reason: null,
          },
          public: backendPublic,
        },
        database: {
          ok: dbResult.rowCount > 0,
          reason: dbResult.rowCount > 0 ? null : 'SELECT 1 returned no rows',
        },
        cloudflare: {
          backendPublic,
          frontendPublic,
        },
        backup: {
          ok: null,
          status: 'Not yet available',
          reason: 'Backup status is not implemented in the current codebase.',
        },
        fleet: fleetSummary(devices),
      });
    } catch (err) {
      console.error('GET /api/admin/health error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });
}

module.exports = {
  checkUrl,
  registerAdminRoutes,
  recentHealthEvents,
};
