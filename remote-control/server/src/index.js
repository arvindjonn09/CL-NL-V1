require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const cookieParser = require('cookie-parser');
const cors = require('cors');
const http = require('http');
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const {
  agentAuthMiddleware,
  authenticateAdmin,
  authMiddleware,
  logoutAdmin,
  refreshAdminSession,
} = require('./auth');
const { audit } = require('./audit/audit');
const {
  actionConfirmationRuleKey,
  auditConfirmationDetail,
  validateConfirmation,
} = require('./confirmation');
const {
  CURRENT_OPERATOR_ACK_VERSION,
  acceptAcknowledgement,
  getLatestAcknowledgement,
  acknowledgementRequired,
} = require('./acknowledgement');
const { createAccessUserStore } = require('./access/users');
const { registerAdminRoutes } = require('./admin/handlers');
const {
  isCorsOriginAllowed,
  publicApiUrlFromRequest,
  trustProxy,
} = require('./config');
const pool = require('./db/db');
const { ensureSchema } = require('./db/schema');
const { registerDiagnosticsRoutes } = require('./diagnostics/handlers');
const { saveLatestDiagnostics } = require('./diagnostics/service');
const { shapeDeviceSummary } = require('./health');
const { registerRemoteAccessRoutes } = require('./remoteAccess/handlers');
const { registerRemoteDesktopRoutes } = require('./remoteDesktop/handlers');
const { buildDeviceTimeline } = require('./timeline');
const { registerUpgradeRoutes } = require('./upgrades/handlers');
const {
  initWebSocket,
  getConnectedAgent,
  broadcastToBrowsers,
} = require('./wsServer');

const app = express();
const server = http.createServer(app);
const uploadsDir = path.join(__dirname, '../uploads');
const fileJobs = [];
const OUTPUT_PREVIEW_LENGTH = 800;

fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (_req, file, cb) => {
    const id = crypto.randomUUID();
    cb(null, id + '-' + file.originalname);
  },
});

const upload = multer({ storage });

const accessUserStore = createAccessUserStore(pool);
const remoteUserStore = {
  async getUser(identity) {
    return accessUserStore.getUser(identity);
  },
  async listUsers() {
    return accessUserStore.listUsers();
  },
  async verifyCredentials(identity, password) {
    return accessUserStore.verifyCredentials(identity, password);
  },
};
initWebSocket(server, { pool, userStore: remoteUserStore });

if (trustProxy) {
  app.set('trust proxy', 1);
}

app.use(
  cors({
    origin(origin, cb) {
      if (isCorsOriginAllowed(origin)) return cb(null, true);
      return cb(new Error('CORS origin not allowed'));
    },
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

function previewText(value) {
  const text = String(value || '').trim();
  if (text.length <= OUTPUT_PREVIEW_LENGTH) return text;
  return `${text.slice(0, OUTPUT_PREVIEW_LENGTH)}...`;
}

function toJson(value) {
  return value ? JSON.stringify(value) : null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function nonEmpty(value) {
  if (value === undefined || value === '') return null;
  return value;
}

function normalizeHeartbeatPayload(body) {
  const runtimePaths = firstDefined(
    body.runtimeDirectories,
    body.runtime_paths,
    body.runtimePaths
  );

  return {
    id: nonEmpty(body.id || body.deviceId || body.device_id),
    displayName: nonEmpty(firstDefined(body.displayName, body.display_name, body.name)),
    hostname: nonEmpty(firstDefined(body.hostname, body.hostName)),
    username: nonEmpty(firstDefined(body.username, body.userName, body.agentUser, body.agent_user)),
    runMode: nonEmpty(firstDefined(body.runMode, body.run_mode)),
    agentVersion: nonEmpty(firstDefined(body.agentVersion, body.agent_version, body.version)),
    serviceName: nonEmpty(firstDefined(body.serviceName, body.service_name)),
    startupAt: nonEmpty(firstDefined(body.startupAt, body.startup_at)),
    executablePath: nonEmpty(firstDefined(body.executablePath, body.executable_path)),
    configPath: nonEmpty(firstDefined(body.configPath, body.config_path)),
    processId: nonEmpty(firstDefined(body.processId, body.process_id, body.pid)),
    backendUrl: nonEmpty(firstDefined(body.backendUrl, body.backend_url, body.serverUrl, body.server_url)),
    environmentLabel: nonEmpty(firstDefined(body.environmentLabel, body.environment_label)),
    lastCommand: firstDefined(body.lastCommand, body.last_command),
    lastFile: firstDefined(body.lastFile, body.last_file),
    lastError: firstDefined(body.lastError, body.last_error),
    startupChecks: firstDefined(body.startupChecks, body.startup_checks),
    recovery: firstDefined(body.recovery),
    diagnostics: firstDefined(body.diagnostics),
    remoteDesktop: firstDefined(body.remoteDesktop, body.remote_desktop),
    runtimeDirectories: runtimePaths,
  };
}

function normalizeEnvironmentLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const allowed = new Set(['dev', 'test', 'prod', 'personal', 'unknown']);
  return allowed.has(normalized) ? normalized : 'unknown';
}

function healthLevelForAgentError(lastError) {
  const source = String(lastError?.source || '').toLowerCase();

  if (lastError?.level) {
    return lastError.level === 'error' ? 'error' : 'warning';
  }

  if (source === 'command' || source === 'file-transfer') {
    return 'warning';
  }

  return 'error';
}

function diagnosticsLooksHealthy(diagnostics, recovery) {
  const watchdog = diagnostics?.watchdog || {};
  const recoveryState = String(diagnostics?.recovery?.state || recovery?.state || '').toLowerCase();
  return Boolean(diagnostics) &&
    !diagnostics.degraded &&
    !diagnostics.operator_attention_needed &&
    !diagnostics.operatorAttentionNeeded &&
    !watchdog.operatorAttentionNeeded &&
    recoveryState !== 'recovering';
}

async function recordHealthEvent(deviceId, level, source, message) {
  if (!deviceId || !message) return;

  await pool.query(
    `
    INSERT INTO device_health_events (id, device_id, level, source, message)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [crypto.randomUUID(), deviceId, level, source, previewText(message)]
  );

  if (level === 'error') {
    await pool.query(
      `
      UPDATE devices
      SET last_error_at = NOW(),
          last_error_source = $1,
          last_error_message = $2,
          updated_at = NOW()
      WHERE id = $3
      `,
      [source, previewText(message), deviceId]
    );
  }
}

async function getDeviceSummaries() {
  const result = await pool.query(`
    SELECT
      d.*,
      diag.status AS diagnostics_status,
      diag.degraded AS diagnostics_degraded,
      diag.degraded_reason AS diagnostics_degraded_reason,
      diag.heartbeat_failure_count AS diagnostics_heartbeat_failure_count,
      diag.last_successful_backend_contact AS diagnostics_last_successful_backend_contact,
      diag.diagnostics_json AS diagnostics_json
    FROM devices d
    LEFT JOIN device_diagnostics diag ON diag.device_id::text = d.id::text
    ORDER BY d.created_at DESC
  `);
  const rank = {
    error: 0,
    degraded: 1,
    recovering: 2,
    'upgrade-pending': 3,
    online: 4,
    stale: 5,
    offline: 6,
  };
  return result.rows
    .map(shapeDeviceSummary)
    .sort((a, b) => {
      const statusRank = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
      if (statusRank !== 0) return statusRank;
      return new Date(b.lastSeen || 0).getTime() - new Date(a.lastSeen || 0).getTime();
    });
}

async function getRecentCommands(deviceId, limit = 20) {
  const params = [];
  let where = '';

  if (deviceId) {
    params.push(deviceId);
    where = 'WHERE c.device_id = $1';
  }

  params.push(limit);

  const result = await pool.query(
    `
    SELECT
      c.id AS command_id,
      c.device_id,
      c.command,
      c.status,
      c.created_at AS command_created_at,
      c.started_at,
      c.completed_at,
      c.exit_code,
      c.stdout_preview,
      c.stderr_preview,
      c.error_message,
      c.duration_ms,
      cr.id AS result_id,
      cr.output,
      cr.created_at AS result_created_at
    FROM commands c
    LEFT JOIN command_results cr ON c.id = cr.command_id
    ${where}
    ORDER BY c.created_at DESC
    LIMIT $${params.length}
    `,
    params
  );

  return result.rows;
}

async function getRecentFiles(deviceId, limit = 20) {
  const params = [];
  let where = '';

  if (deviceId) {
    params.push(deviceId);
    where = 'WHERE device_id = $1';
  }

  params.push(limit);

  const result = await pool.query(
    `
    SELECT *
    FROM file_jobs
    ${where}
    ORDER BY created_at DESC
    LIMIT $${params.length}
    `,
    params
  );

  return result.rows;
}

async function getRecentHealthEvents(deviceId, limit = 20) {
  const params = [];
  let where = '';

  if (deviceId) {
    params.push(deviceId);
    where = 'WHERE device_id = $1';
  }

  params.push(limit);

  const result = await pool.query(
    `
    SELECT *
    FROM device_health_events
    ${where}
    ORDER BY created_at DESC
    LIMIT $${params.length}
    `,
    params
  );

  return result.rows;
}

async function getRecentActions(deviceId, limit = 20) {
  const result = await pool.query(
    `
    SELECT *
    FROM device_actions
    WHERE device_id = $1
    ORDER BY requested_at DESC
    LIMIT $2
    `,
    [deviceId, limit]
  );

  return result.rows;
}

async function getRecentUpgradeEvents(deviceId, limit = 20) {
  const result = await pool.query(
    `
    SELECT *
    FROM upgrade_events
    WHERE device_id = $1 OR device_id IS NULL
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [deviceId, limit]
  );

  return result.rows;
}

async function getRecentAuditLogs(deviceId, limit = 20) {
  const result = await pool.query(
    `
    SELECT *
    FROM admin_audit_logs
    WHERE target_type = 'device' AND target_id = $1
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [deviceId, limit]
  );

  return result.rows;
}

async function createDeviceAction(deviceId, actionType, requestedBy) {
  const allowed = new Set([
    'force-heartbeat',
    'restart-service',
    'refresh-metadata',
    'runtime-log-snapshot',
    'check-upgrade',
    'apply-staged-upgrade',
  ]);

  if (!allowed.has(actionType)) {
    const err = new Error('Unsupported action type');
    err.statusCode = 400;
    throw err;
  }

  const device = await pool.query('SELECT id FROM devices WHERE id = $1', [deviceId]);
  if (device.rowCount === 0) {
    const err = new Error('Device not found');
    err.statusCode = 404;
    throw err;
  }

  const actionId = crypto.randomUUID();
  const result = await pool.query(
    `
    INSERT INTO device_actions (id, device_id, action_type, requested_by, status)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
    `,
    [actionId, deviceId, actionType, requestedBy || null, 'pending']
  );

  const agentSocket = getConnectedAgent(deviceId);
  if (agentSocket && agentSocket.readyState === 1) {
    agentSocket.send(JSON.stringify({
      type: 'action',
      actionId,
      actionType,
      deviceId,
    }));
  }

  return result.rows[0];
}

function auditActionForDeviceAction(actionType) {
  if (actionType === 'restart-service') return 'repair_trigger';
  if (actionType === 'check-upgrade' || actionType === 'apply-staged-upgrade') return 'upgrade_trigger';
  return 'admin_action_trigger';
}

async function claimNextAction(deviceId) {
  const result = await pool.query(
    `
    UPDATE device_actions
    SET status = $1,
        started_at = COALESCE(started_at, NOW())
    WHERE id = (
      SELECT id
      FROM device_actions
      WHERE device_id = $2 AND status = $3
      ORDER BY requested_at ASC
      LIMIT 1
    )
    RETURNING id, device_id, action_type, status, requested_at, started_at
    `,
    ['running', deviceId, 'pending']
  );

  return result.rows[0] || null;
}

app.get('/', (req, res) => {
  res.send('Server is running');
});

async function healthCheck(_req, res) {
  try {
    await pool.query('SELECT 1');
    res.json({
      ok: true,
      service: 'setulink-api',
      database: 'ok',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      service: 'setulink-api',
      database: 'error',
      timestamp: new Date().toISOString(),
    });
  }
}

app.get('/health', healthCheck);
app.get('/api/health', healthCheck);

app.post('/api/auth/login', async (req, res) => {
  try {
    const result = await authenticateAdmin(req, res);
    await audit(pool, req, {
      adminIdentity: result.email || req.body?.email || null,
      action: 'login',
      targetType: 'admin_session',
      result: result.ok ? 'success' : 'failure',
      detail: result.ok ? null : result.error,
    });

    if (!result.ok) {
      if (result.retryAfterSeconds) {
        res.set('Retry-After', String(result.retryAfterSeconds));
      }
      return res.status(result.statusCode).json({ error: result.error });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const session = await refreshAdminSession(req, res);
    if (!session) {
      return res.status(401).json({ error: 'Invalid session' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/auth/refresh error:', err);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  try {
    await logoutAdmin(req, res);
    await audit(pool, req, {
      action: 'logout',
      targetType: 'admin_session',
      result: 'success',
    });
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/auth/logout error:', err);
    res.status(500).json({ error: 'Logout failed' });
  }
});

app.get('/api/auth/acknowledgement', authMiddleware, async (req, res) => {
  try {
    const latest = await getLatestAcknowledgement(pool, req.user.email);
    res.json({
      required: acknowledgementRequired(latest),
      currentVersion: CURRENT_OPERATOR_ACK_VERSION,
      acceptedVersion: latest?.version || null,
      acceptedAt: latest?.accepted_at || null,
    });
  } catch (err) {
    console.error('GET /api/auth/acknowledgement error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/auth/acknowledgement', authMiddleware, async (req, res) => {
  try {
    if (req.body?.version !== CURRENT_OPERATOR_ACK_VERSION) {
      return res.status(400).json({ error: 'Current acknowledgement version is required' });
    }
    if (req.body?.accepted !== true) {
      return res.status(400).json({ error: 'Acknowledgement acceptance is required' });
    }

    const accepted = await acceptAcknowledgement(pool, req.user.email, CURRENT_OPERATOR_ACK_VERSION);
    await audit(pool, req, {
      action: 'operator_acknowledgement',
      targetType: 'admin_operator',
      targetId: req.user.email,
      result: 'success',
      detail: `version=${CURRENT_OPERATOR_ACK_VERSION}`,
    });

    res.json({
      success: true,
      version: accepted.version,
      acceptedAt: accepted.accepted_at,
    });
  } catch (err) {
    await audit(pool, req, {
      action: 'operator_acknowledgement',
      targetType: 'admin_operator',
      targetId: req.user?.email || null,
      result: 'failure',
      detail: err.message,
    });
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('POST /api/auth/acknowledgement error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/files/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const fileId = crypto.randomUUID();
    const deviceId = req.body.deviceId;
    const confirmation = validateConfirmation('file:upload', req.body);

    if (!deviceId) {
      await audit(pool, req, {
        action: 'file_access',
        targetType: 'device',
        targetId: null,
        result: 'failure',
        detail: 'deviceId is required',
      });
      return res.status(400).json({ error: 'deviceId is required' });
    }

    if (!req.file) {
      await audit(pool, req, {
        action: 'file_access',
        targetType: 'device',
        targetId: deviceId,
        result: 'failure',
        detail: 'file is required',
      });
      return res.status(400).json({ error: 'file is required' });
    }

    const job = {
      id: fileId,
      deviceId,
      filename: req.file.filename,
      originalName: req.file.originalname,
      direction: 'upload-to-device',
      status: 'pending',
      createdAt: Date.now(),
      downloadingAt: null,
      completedAt: null,
      bytesTransferred: req.file.size || null,
      destinationPath: null,
      errorMessage: null,
    };

    fileJobs.push(job);

    await pool.query(
      `
      INSERT INTO file_jobs
        (id, device_id, filename, original_name, direction, status, bytes_transferred)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        job.id,
        job.deviceId,
        job.filename,
        job.originalName,
        job.direction,
        job.status,
        job.bytesTransferred,
      ]
    );

    await pool.query(
      `
      UPDATE devices
      SET last_file_activity_at = NOW(), updated_at = NOW()
      WHERE id = $1
      `,
      [deviceId]
    );

    console.log('FILE JOB CREATED:', job);
    await audit(pool, req, {
      action: 'file_access',
      targetType: 'device',
      targetId: deviceId,
      result: 'success',
      detail: auditConfirmationDetail(`upload queued: ${req.file.originalname}`, confirmation),
    });

    res.json({ success: true, fileId });
  } catch (err) {
    await audit(pool, req, {
      action: 'file_access',
      targetType: 'device',
      targetId: req.body?.deviceId || null,
      result: 'failure',
      detail: err.message,
    });
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('POST /api/files/upload error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/devices', authMiddleware, async (_req, res) => {
  try {
    res.json(await getDeviceSummaries());
  } catch (err) {
    console.error('GET /api/devices error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/devices/summary', authMiddleware, async (_req, res) => {
  try {
    res.json(await getDeviceSummaries());
  } catch (err) {
    console.error('GET /api/devices/summary error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/devices/:id/summary', authMiddleware, async (req, res) => {
  try {
    const deviceId = req.params.id;

    const result = await pool.query(
      `
      SELECT
        d.*,
        diag.status AS diagnostics_status,
        diag.degraded AS diagnostics_degraded,
        diag.degraded_reason AS diagnostics_degraded_reason,
        diag.heartbeat_failure_count AS diagnostics_heartbeat_failure_count,
        diag.last_successful_backend_contact AS diagnostics_last_successful_backend_contact,
        diag.diagnostics_json AS diagnostics_json
      FROM devices d
      LEFT JOIN device_diagnostics diag ON diag.device_id::text = d.id::text
      WHERE d.id = $1
      `,
      [deviceId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const [commands, fileJobsForDevice, healthEvents, heartbeats, actions, upgradeEvents, auditLogs] = await Promise.all([
      getRecentCommands(deviceId, 10),
      getRecentFiles(deviceId, 10),
      getRecentHealthEvents(deviceId, 10),
      pool.query(
        `
        SELECT *
        FROM device_heartbeats
        WHERE device_id = $1
        ORDER BY created_at DESC
        LIMIT 10
        `,
        [deviceId]
      ),
      getRecentActions(deviceId, 10),
      getRecentUpgradeEvents(deviceId, 10),
      getRecentAuditLogs(deviceId, 10),
    ]);
    const timeline = buildDeviceTimeline({
      heartbeats: heartbeats.rows,
      commands,
      fileJobs: fileJobsForDevice,
      healthEvents,
      actions,
      upgradeEvents,
      auditLogs,
    });

    res.json({
      device: shapeDeviceSummary(result.rows[0]),
      timeline,
      recentHeartbeats: heartbeats.rows,
      recentCommands: commands,
      recentFileJobs: fileJobsForDevice,
      recentErrors: healthEvents,
      recentActions: actions,
      recentUpgradeEvents: upgradeEvents,
      recentAuditLogs: auditLogs,
    });
  } catch (err) {
    console.error('GET /api/devices/:id/summary error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

registerDiagnosticsRoutes(app, { pool, authMiddleware, agentAuthMiddleware });
registerUpgradeRoutes(app, { pool, authMiddleware, agentAuthMiddleware, audit });
registerAdminRoutes(app, {
  pool,
  authMiddleware,
  getDeviceSummaries,
  userStore: remoteUserStore,
});
registerRemoteAccessRoutes(app, {
  pool,
  userStore: remoteUserStore,
  agentAuthMiddleware,
  getConnectedAgent,
});
registerRemoteDesktopRoutes(app, {
  pool,
  userStore: remoteUserStore,
  agentAuthMiddleware,
});

app.get('/api/commands/recent', authMiddleware, async (req, res) => {
  try {
    res.json(await getRecentCommands(req.query.deviceId, Number(req.query.limit || 20)));
  } catch (err) {
    console.error('GET /api/commands/recent error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/files/recent', authMiddleware, async (req, res) => {
  try {
    res.json(await getRecentFiles(req.query.deviceId, Number(req.query.limit || 20)));
  } catch (err) {
    console.error('GET /api/files/recent error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/health-events/recent', authMiddleware, async (req, res) => {
  try {
    res.json(await getRecentHealthEvents(req.query.deviceId, Number(req.query.limit || 20)));
  } catch (err) {
    console.error('GET /api/health-events/recent error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.patch('/api/devices/:id/environment', authMiddleware, async (req, res) => {
  try {
    const deviceId = req.params.id;
    const environmentLabel = normalizeEnvironmentLabel(req.body.environmentLabel);
    const confirmation = validateConfirmation('device:environment', req.body);

    const result = await pool.query(
      `
      UPDATE devices
      SET environment_label = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
      `,
      [environmentLabel, deviceId]
    );

    if (result.rowCount === 0) {
      await audit(pool, req, {
        action: 'admin_config_change',
        targetType: 'device',
        targetId: deviceId,
        result: 'failure',
        detail: 'Device not found',
      });
      return res.status(404).json({ error: 'Device not found' });
    }

    await audit(pool, req, {
      action: 'admin_config_change',
      targetType: 'device',
      targetId: deviceId,
      result: 'success',
      detail: auditConfirmationDetail(`environment=${environmentLabel}`, confirmation),
    });
    res.json({ success: true, device: shapeDeviceSummary(result.rows[0]) });
  } catch (err) {
    await audit(pool, req, {
      action: 'admin_config_change',
      targetType: 'device',
      targetId: req.params.id,
      result: 'failure',
      detail: err.message,
    });
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('PATCH /api/devices/:id/environment error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/devices/:id/actions', authMiddleware, async (req, res) => {
  try {
    const confirmation = validateConfirmation(actionConfirmationRuleKey(req.body.actionType), req.body);
    const action = await createDeviceAction(
      req.params.id,
      req.body.actionType,
      req.user?.email || 'admin'
    );

    await audit(pool, req, {
      action: auditActionForDeviceAction(req.body.actionType),
      targetType: 'device',
      targetId: req.params.id,
      result: 'success',
      detail: auditConfirmationDetail(req.body.actionType, confirmation),
    });
    res.json({ success: true, action });
  } catch (err) {
    await audit(pool, req, {
      action: auditActionForDeviceAction(req.body?.actionType),
      targetType: 'device',
      targetId: req.params.id,
      result: 'failure',
      detail: err.message,
    });
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }

    console.error('POST /api/devices/:id/actions error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/devices/:id', authMiddleware, async (req, res) => {
  const deviceId = req.params.id;
  try {
    const confirmation = validateConfirmation('device:delete', req.body);
    const result = await pool.query(
      `
      DELETE FROM devices
      WHERE id = $1
      RETURNING id
      `,
      [deviceId]
    );

    if (result.rowCount === 0) {
      await audit(pool, req, {
        action: 'device_delete',
        targetType: 'device',
        targetId: deviceId,
        result: 'failure',
        detail: 'Device not found',
      });
      return res.status(404).json({ error: 'Device not found' });
    }

    await audit(pool, req, {
      action: 'device_delete',
      targetType: 'device',
      targetId: deviceId,
      result: 'success',
      detail: auditConfirmationDetail('device deleted', confirmation),
    });
    res.json({ success: true });
  } catch (err) {
    await audit(pool, req, {
      action: 'device_delete',
      targetType: 'device',
      targetId: deviceId,
      result: 'failure',
      detail: err.message,
    });
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('DELETE /api/devices/:id error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/agent/register', agentAuthMiddleware, async (req, res) => {
  try {
    const { id, os } = req.body;
    const hostname = nonEmpty(req.body.hostname) || nonEmpty(req.body.displayName);
    const displayName = nonEmpty(req.body.displayName) || hostname || id;
    const username = nonEmpty(firstDefined(req.body.username, req.body.agentUser));
    const environmentLabel =
      req.body.environmentLabel === undefined
        ? null
        : normalizeEnvironmentLabel(req.body.environmentLabel);

    if (!id || !hostname || !os) {
      return res.status(400).json({
        error: 'id, hostname, and os are required',
      });
    }

    await pool.query(
      `
      INSERT INTO devices (id, hostname, os, status, last_seen, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        hostname = EXCLUDED.hostname,
        os = EXCLUDED.os,
        status = EXCLUDED.status,
        last_seen = NOW(),
        updated_at = NOW()
      `,
      [id, hostname, os, 'online']
    );

    await pool.query(
      `
      UPDATE devices
      SET display_name = COALESCE($1, display_name, hostname),
          username = COALESCE($2, username),
          environment_label = COALESCE($3, environment_label, 'unknown'),
          backend_url = COALESCE($4, backend_url),
          updated_at = NOW()
      WHERE id = $5
      `,
      [
        displayName,
        username,
        environmentLabel,
        nonEmpty(firstDefined(req.body.backendUrl, req.body.serverUrl)),
        id,
      ]
    );

    res.json({
      success: true,
      message: 'Device registered',
    });
  } catch (err) {
    console.error('POST /api/agent/register error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/agent/heartbeat', agentAuthMiddleware, async (req, res) => {
  try {
    const {
      id,
      displayName = null,
      hostname = null,
      username = null,
      runMode = null,
      agentVersion = null,
      serviceName = null,
      startupAt = null,
      executablePath = null,
      configPath = null,
      processId = null,
      backendUrl = null,
      environmentLabel = null,
      lastCommand = null,
      lastFile = null,
      lastError = null,
      startupChecks = null,
      recovery = null,
      diagnostics = null,
      remoteDesktop = null,
      runtimeDirectories = null,
    } = normalizeHeartbeatPayload(req.body);

    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    const result = await pool.query(
      `
      UPDATE devices
      SET status = $1,
          last_seen = NOW(),
          display_name = COALESCE($3, display_name, hostname),
          hostname = COALESCE($4, hostname),
          username = COALESCE($5, username),
          run_mode = COALESCE($6, run_mode),
          agent_version = COALESCE($7, agent_version),
          service_name = COALESCE($8, service_name),
          startup_at = COALESCE($9, startup_at),
          executable_path = COALESCE($10, executable_path),
          config_path = COALESCE($11, config_path),
          process_id = COALESCE($12, process_id),
          backend_url = COALESCE($13, backend_url),
          environment_label = COALESCE($14, environment_label, 'unknown'),
          last_command_summary = COALESCE($15::jsonb, last_command_summary),
          last_file_summary = COALESCE($16::jsonb, last_file_summary),
          runtime_paths = COALESCE($17::jsonb, runtime_paths),
          remote_desktop_capability = COALESCE($19::jsonb, remote_desktop_capability),
          last_error_at = CASE
            WHEN $18::boolean AND last_error_source IN ('heartbeat', 'registration', 'command', 'command-poll', 'command-started', 'command-result', 'file-transfer', 'file-complete', 'file-failed')
              THEN NULL
            ELSE last_error_at
          END,
          last_error_source = CASE
            WHEN $18::boolean AND last_error_source IN ('heartbeat', 'registration', 'command', 'command-poll', 'command-started', 'command-result', 'file-transfer', 'file-complete', 'file-failed')
              THEN NULL
            ELSE last_error_source
          END,
          last_error_message = CASE
            WHEN $18::boolean AND last_error_source IN ('heartbeat', 'registration', 'command', 'command-poll', 'command-started', 'command-result', 'file-transfer', 'file-complete', 'file-failed')
              THEN NULL
            ELSE last_error_message
          END,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
      `,
      [
        'online',
        id,
        displayName,
        hostname,
        username,
        runMode,
        agentVersion,
        serviceName,
        startupAt,
        executablePath,
        configPath,
        processId,
        backendUrl,
        environmentLabel ? normalizeEnvironmentLabel(environmentLabel) : null,
        toJson(lastCommand),
        toJson(lastFile),
        toJson(runtimeDirectories),
        !lastError && diagnosticsLooksHealthy(diagnostics, recovery),
        toJson(remoteDesktop),
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    await pool.query(
      `
      INSERT INTO device_heartbeats (id, device_id, run_mode, agent_version, process_id)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [crypto.randomUUID(), id, runMode, agentVersion, processId]
    );

    if (lastError && lastError.message) {
      await recordHealthEvent(
        id,
        healthLevelForAgentError(lastError),
        lastError.source || 'agent',
        lastError.message
      );
    }

    if (diagnostics || startupChecks || recovery) {
      await saveLatestDiagnostics(pool, {
        diagnostics: diagnostics || {
          device_id: id,
          hostname,
          username,
          run_mode: runMode,
          version: agentVersion,
          executable_path: executablePath,
          config_path: configPath,
          log_path: runtimeDirectories?.logPath,
          backend_url: backendUrl,
          service_name: serviceName,
          startup_checks: startupChecks,
          recovery,
          degraded: recovery?.degraded,
          degraded_reason: recovery?.degradedReason,
          last_successful_backend_contact: recovery?.lastSuccessfulBackendContact,
          heartbeat_failure_count: recovery?.consecutiveBackendFailures,
          last_command_status: lastCommand?.status,
          last_file_status: lastFile?.status,
        },
      });
    }

    res.json({
      success: true,
      message: 'Heartbeat received',
      device: shapeDeviceSummary(result.rows[0]),
    });
  } catch (err) {
    console.error('POST /api/agent/heartbeat error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/devices/:id/commands', authMiddleware, async (req, res) => {
  try {
    const deviceId = req.params.id;
    const { command } = req.body;

    if (!command) {
      await audit(pool, req, {
        action: 'command_dispatch',
        targetType: 'device',
        targetId: deviceId,
        result: 'failure',
        detail: 'command is required',
      });
      return res.status(400).json({ error: 'command is required' });
    }

    const commandId = crypto.randomUUID();

    await pool.query(
      `
      INSERT INTO commands (id, device_id, command, status)
      VALUES ($1, $2, $3, $4)
      `,
      [commandId, deviceId, command, 'pending']
    );

    await pool.query(
      `
      UPDATE devices
      SET last_command_activity_at = NOW(), updated_at = NOW()
      WHERE id = $1
      `,
      [deviceId]
    );

    const agentSocket = getConnectedAgent(deviceId);

    if (agentSocket && agentSocket.readyState === 1) {
      agentSocket.send(
        JSON.stringify({
          type: 'command',
          commandId,
          command,
        })
      );

      broadcastToBrowsers(deviceId, {
        type: 'command-start',
        commandId,
        command,
        deviceId,
      });

      console.log(`Command pushed over WebSocket: ${commandId} -> ${deviceId}`);
    } else {
      console.log(`Agent not connected over WebSocket, command remains pending: ${commandId}`);
    }

    await audit(pool, req, {
      action: 'command_dispatch',
      targetType: 'device',
      targetId: deviceId,
      result: 'success',
      detail: `commandId=${commandId}`,
    });
    res.json({
      success: true,
      commandId,
    });
  } catch (err) {
    await audit(pool, req, {
      action: 'command_dispatch',
      targetType: 'device',
      targetId: req.params.id,
      result: 'failure',
      detail: err.message,
    });
    console.error('POST /api/devices/:id/commands error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/agent/next-command', agentAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    const result = await pool.query(
      `
      SELECT id, command
      FROM commands
      WHERE device_id = $1 AND status = $2
      ORDER BY created_at ASC
      LIMIT 1
      `,
      [id, 'pending']
    );

    if (result.rows.length === 0) {
      return res.json({ command: null });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/agent/next-command error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/agent/next-file', agentAuthMiddleware, async (req, res) => {
  const now = Date.now();
  const deviceId = req.query.id;

  if (!deviceId) {
    return res.status(400).json({ error: 'id is required' });
  }

  const job = fileJobs.find(
    (f) =>
      f.deviceId === deviceId &&
      (
        f.status === 'pending' ||
        (f.status === 'running' &&
          f.downloadingAt &&
          now - f.downloadingAt > 30000)
      )
  );

  if (!job) {
    return res.json({ file: null });
  }

  job.status = 'running';
  job.downloadingAt = Date.now();

  await pool.query(
    `
    UPDATE file_jobs
    SET status = $1,
        started_at = COALESCE(started_at, NOW())
    WHERE id = $2 AND device_id = $3
    `,
    ['running', job.id, deviceId]
  );

  await pool.query(
    `
    UPDATE devices
    SET last_file_activity_at = NOW(), updated_at = NOW()
    WHERE id = $1
    `,
    [deviceId]
  );

  console.log('FILE JOB SERVED:', job);

  res.json({
    file: {
      id: job.id,
      filename: job.filename,
      url: `${publicApiUrlFromRequest(req)}/uploads/${encodeURIComponent(job.filename)}`,
    },
  });
});

app.get('/api/agent/next-action', agentAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    const action = await claimNextAction(id);
    if (!action) {
      return res.json({ action: null });
    }

    res.json({
      action: {
        id: action.id,
        deviceId: action.device_id,
        actionType: action.action_type,
        status: action.status,
        requestedAt: action.requested_at,
      },
    });
  } catch (err) {
    console.error('GET /api/agent/next-action error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/agent/action-result', agentAuthMiddleware, async (req, res) => {
  try {
    const {
      actionId,
      deviceId,
      status,
      resultSummary = '',
      errorSummary = '',
      resultPayload = null,
    } = req.body;

    if (!actionId || !deviceId) {
      return res.status(400).json({ error: 'actionId and deviceId are required' });
    }

    const finalStatus = status === 'failed' ? 'failed' : 'success';
    const result = await pool.query(
      `
      UPDATE device_actions
      SET status = $1,
          completed_at = NOW(),
          result_summary = $2,
          result_payload = $3::jsonb,
          error_summary = $4
      WHERE id = $5 AND device_id = $6
      RETURNING device_id, action_type
      `,
      [
        finalStatus,
        previewText(resultSummary),
        resultPayload ? JSON.stringify(resultPayload) : null,
        previewText(errorSummary),
        actionId,
        deviceId,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Action not found for device' });
    }

    await pool.query(
      `
      UPDATE devices
      SET updated_at = NOW()
      WHERE id = $1
      `,
      [deviceId]
    );

    if (finalStatus === 'failed') {
      await recordHealthEvent(
        deviceId,
        'warning',
        `action:${result.rows[0].action_type}`,
        errorSummary || resultSummary || 'admin action failed'
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/agent/action-result error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/agent/command-started', agentAuthMiddleware, async (req, res) => {
  try {
    const { commandId, deviceId } = req.body;

    if (!commandId || !deviceId) {
      return res.status(400).json({ error: 'commandId and deviceId are required' });
    }

    const result = await pool.query(
      `
      UPDATE commands
      SET status = $1,
          started_at = COALESCE(started_at, NOW())
      WHERE id = $2 AND device_id = $3
      RETURNING device_id
      `,
      ['running', commandId, deviceId]
    );

    if (result.rowCount > 0) {
      await pool.query(
        `
        UPDATE devices
        SET last_command_activity_at = NOW(), updated_at = NOW()
        WHERE id = $1
        `,
        [result.rows[0].device_id]
      );
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Command not found for device' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('command-started error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/agent/file-complete', agentAuthMiddleware, async (req, res) => {
  try {
    const { id, deviceId, bytesTransferred = null, destinationPath = null } = req.body;

    if (!id || !deviceId) {
      return res.status(400).json({ error: 'id and deviceId are required' });
    }

    const job = fileJobs.find((f) => f.id === id && f.deviceId === deviceId);

    if (job) {
      job.status = 'completed';
      job.completedAt = Date.now();
      job.bytesTransferred = bytesTransferred || job.bytesTransferred;
      job.destinationPath = destinationPath;
      console.log('FILE JOB COMPLETED:', job);
    }

    const result = await pool.query(
      `
      UPDATE file_jobs
      SET status = $1,
          completed_at = NOW(),
          bytes_transferred = COALESCE($2, bytes_transferred),
          destination_path = COALESCE($3, destination_path),
          error_message = NULL
      WHERE id = $4 AND device_id = $5
      RETURNING device_id, filename
      `,
      ['completed', bytesTransferred, destinationPath, id, deviceId]
    );

    if (result.rowCount > 0) {
      const summary = {
        id,
        status: 'completed',
        filename: result.rows[0].filename,
        bytesTransferred,
        destinationPath,
        at: new Date().toISOString(),
      };

      await pool.query(
        `
        UPDATE devices
        SET last_file_activity_at = NOW(),
            last_file_summary = $1::jsonb,
            last_error_at = CASE
              WHEN last_error_source IN ('file-transfer', 'file-complete', 'file-failed') THEN NULL
              ELSE last_error_at
            END,
            last_error_source = CASE
              WHEN last_error_source IN ('file-transfer', 'file-complete', 'file-failed') THEN NULL
              ELSE last_error_source
            END,
            last_error_message = CASE
              WHEN last_error_source IN ('file-transfer', 'file-complete', 'file-failed') THEN NULL
              ELSE last_error_message
            END,
            updated_at = NOW()
        WHERE id = $2
        `,
        [JSON.stringify(summary), result.rows[0].device_id]
      );
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'File job not found for device' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/agent/file-complete error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/agent/file-failed', agentAuthMiddleware, async (req, res) => {
  try {
    const { id, deviceId, errorMessage = 'file transfer failed', destinationPath = null } = req.body;

    if (!id || !deviceId) {
      return res.status(400).json({ error: 'id and deviceId are required' });
    }

    const job = fileJobs.find((f) => f.id === id && f.deviceId === deviceId);
    if (job) {
      job.status = 'failed';
      job.completedAt = Date.now();
      job.errorMessage = errorMessage;
      job.destinationPath = destinationPath;
    }

    const result = await pool.query(
      `
      UPDATE file_jobs
      SET status = $1,
          completed_at = NOW(),
          destination_path = COALESCE($2, destination_path),
          error_message = $3
      WHERE id = $4 AND device_id = $5
      RETURNING device_id, filename
      `,
      ['failed', destinationPath, previewText(errorMessage), id, deviceId]
    );

    if (result.rowCount > 0) {
      const summary = {
        id,
        status: 'failed',
        filename: result.rows[0].filename,
        errorMessage: previewText(errorMessage),
        destinationPath,
        at: new Date().toISOString(),
      };

      await pool.query(
        `
        UPDATE devices
        SET last_file_activity_at = NOW(),
            last_file_summary = $1::jsonb,
            updated_at = NOW()
        WHERE id = $2
        `,
        [JSON.stringify(summary), result.rows[0].device_id]
      );

      await recordHealthEvent(result.rows[0].device_id, 'warning', 'file-transfer', errorMessage);
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'File job not found for device' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/agent/file-failed error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/agent/command-result', agentAuthMiddleware, async (req, res) => {
  try {
    const {
      commandId,
      deviceId,
      output,
      status,
      exitCode = null,
      stdout = '',
      stderr = '',
      errorMessage = '',
      durationMs = null,
    } = req.body;

    if (!commandId || !deviceId) {
      return res.status(400).json({ error: 'commandId and deviceId are required' });
    }

    const resultId = crypto.randomUUID();
    const finalStatus = status === 'failed' ? 'failed' : 'completed';
    const fullOutput = output || [stdout, stderr, errorMessage].filter(Boolean).join('\n');

    const result = await pool.query(
      `
      UPDATE commands
      SET status = $1,
          completed_at = NOW(),
          exit_code = $2,
          stdout_preview = $3,
          stderr_preview = $4,
          error_message = $5,
          duration_ms = $6
      WHERE id = $7 AND device_id = $8
      RETURNING device_id, command
      `,
      [
        finalStatus,
        exitCode,
        previewText(stdout || fullOutput),
        previewText(stderr),
        previewText(errorMessage),
        durationMs,
        commandId,
        deviceId,
      ]
    );

    if (result.rowCount > 0) {
      await pool.query(
        `
        INSERT INTO command_results (id, command_id, output)
        VALUES ($1, $2, $3)
        `,
        [resultId, commandId, fullOutput || '']
      );

      const summary = {
        id: commandId,
        command: result.rows[0].command,
        status: finalStatus,
        exitCode,
        errorMessage: previewText(errorMessage),
        durationMs,
        at: new Date().toISOString(),
      };

      await pool.query(
        `
        UPDATE devices
        SET last_command_activity_at = NOW(),
            last_command_summary = $1::jsonb,
            last_error_at = CASE
              WHEN $3::boolean AND last_error_source IN ('command', 'command-poll', 'command-started', 'command-result') THEN NULL
              ELSE last_error_at
            END,
            last_error_source = CASE
              WHEN $3::boolean AND last_error_source IN ('command', 'command-poll', 'command-started', 'command-result') THEN NULL
              ELSE last_error_source
            END,
            last_error_message = CASE
              WHEN $3::boolean AND last_error_source IN ('command', 'command-poll', 'command-started', 'command-result') THEN NULL
              ELSE last_error_message
            END,
            updated_at = NOW()
        WHERE id = $2
        `,
        [JSON.stringify(summary), result.rows[0].device_id, finalStatus === 'completed']
      );

      if (finalStatus === 'failed') {
        await recordHealthEvent(
          result.rows[0].device_id,
          'warning',
          'command',
          errorMessage || fullOutput || `Command failed: ${commandId}`
        );
      }
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Command not found for device' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/agent/command-result error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/devices/:id/command-results', authMiddleware, async (req, res) => {
  try {
    res.json(await getRecentCommands(req.params.id, 100));
  } catch (err) {
    console.error('GET /api/devices/:id/command-results error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/devices/:id/pending-commands', authMiddleware, async (req, res) => {
  try {
    const deviceId = req.params.id;

    const result = await pool.query(
      `
      SELECT id, command, status, created_at, started_at
      FROM commands
      WHERE device_id = $1 AND status IN ($2, $3)
      ORDER BY created_at DESC
      `,
      [deviceId, 'pending', 'running']
    );

    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/devices/:id/pending-commands error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

const PORT = process.env.PORT || 3000;

async function start() {
  await ensureSchema(pool);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
