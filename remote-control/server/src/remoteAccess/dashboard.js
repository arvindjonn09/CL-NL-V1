const { shapeDeviceSummary } = require('../health');
const { remoteConnectionReadiness } = require('./grants');
const { desktopCapabilityForDevice } = require('../remoteDesktop/sessions');

function remoteDeviceScope(user) {
  const deviceIds = Array.isArray(user?.deviceIds)
    ? user.deviceIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const mode = user?.deviceScopeMode || (deviceIds.length ? 'selected' : 'all');
  return {
    mode: mode === 'selected' ? 'selected' : 'all',
    deviceIds,
  };
}

function deviceFilter(user) {
  const scope = remoteDeviceScope(user);
  if (scope.mode !== 'selected') {
    return { where: '', params: [] };
  }
  if (!scope.deviceIds.length) {
    return { where: 'WHERE FALSE', params: [] };
  }
  return {
    where: 'WHERE d.id::text = ANY($1)',
    params: [scope.deviceIds],
  };
}

function commandFilter(user) {
  const scope = remoteDeviceScope(user);
  if (scope.mode !== 'selected') {
    return { where: '', params: [] };
  }
  if (!scope.deviceIds.length) {
    return { where: 'WHERE FALSE', params: [] };
  }
  return {
    where: 'WHERE c.device_id::text = ANY($1)',
    params: [scope.deviceIds],
  };
}

function detailDeviceFilter(user, deviceId) {
  const scope = remoteDeviceScope(user);
  if (scope.mode !== 'selected') {
    return {
      where: 'WHERE d.id::text = $1',
      params: [deviceId],
    };
  }
  if (!scope.deviceIds.length) {
    return {
      where: 'WHERE FALSE',
      params: [],
    };
  }
  return {
    where: 'WHERE d.id::text = $1 AND d.id::text = ANY($2)',
    params: [deviceId, scope.deviceIds],
  };
}

function safeDeviceSummary(device) {
  const summary = shapeDeviceSummary(device);
  return {
    id: summary.id,
    hostname: summary.hostname,
    displayName: summary.displayName,
    environmentLabel: summary.environmentLabel,
    username: summary.username,
    os: summary.os,
    online: summary.online,
    status: summary.status,
    connectionStatus: summary.connectionStatus,
    healthStatus: summary.healthStatus,
    healthLabel: summary.healthLabel,
    healthReason: summary.healthReason,
    runMode: summary.runMode,
    agentVersion: summary.agentVersion,
    lastSeen: summary.lastSeen,
    heartbeatAgeSeconds: summary.heartbeatAgeSeconds,
    remoteDesktopCapability: summary.remoteDesktopCapability,
    detailPath: `/remoteaccess/devices/${encodeURIComponent(summary.id)}`,
  };
}

async function getRemoteAccessDashboard(pool, user) {
  const devicesFilter = deviceFilter(user);
  const commandParams = [];
  const commandsFilter = commandFilter(user);
  commandParams.push(...commandsFilter.params);
  commandParams.push(20);

  const [devicesResult, commandsResult] = await Promise.all([
    pool.query(
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
      ${devicesFilter.where}
      ORDER BY d.created_at DESC
      `,
      devicesFilter.params
    ),
    pool.query(
      `
      SELECT
        c.id AS command_id,
        c.device_id,
        c.command,
        c.status,
        c.created_at AS command_created_at,
        c.started_at,
        c.completed_at,
        c.exit_code
      FROM commands c
      ${commandsFilter.where}
      ORDER BY c.created_at DESC
      LIMIT $${commandParams.length}
      `,
      commandParams
    ),
  ]);

  return {
    user: {
      email: user.email,
      displayName: user.displayName,
    },
    devices: devicesResult.rows.map(safeDeviceSummary),
    recentCommands: commandsResult.rows,
  };
}

async function getRemoteAccessDeviceDetail(pool, user, deviceId, options = {}) {
  const filter = detailDeviceFilter(user, deviceId);
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
    ${filter.where}
    LIMIT 1
    `,
    filter.params
  );

  if (result.rowCount === 0) return null;

  const [commandsResult, heartbeatsResult, desktopSessionsResult] = await Promise.all([
    pool.query(
      `
      SELECT
        c.id AS command_id,
        c.device_id,
        c.command,
        c.status,
        c.created_at AS command_created_at,
        c.started_at,
        c.completed_at,
        c.exit_code
      FROM commands c
      WHERE c.device_id::text = $1
      ORDER BY c.created_at DESC
      LIMIT 10
      `,
      [deviceId]
    ),
    pool.query(
      `
      SELECT id, device_id, run_mode, agent_version, process_id, created_at
      FROM device_heartbeats
      WHERE device_id::text = $1
      ORDER BY created_at DESC
      LIMIT 5
      `,
      [deviceId]
    ),
    pool.query(
      `
      SELECT id, device_id, status, signaling_state, transport_state, created_at, expires_at, started_at, ended_at, failure_reason
      FROM remote_desktop_sessions
      WHERE device_id::text = $1
        AND remote_user_identity = $2
      ORDER BY created_at DESC
      LIMIT 5
      `,
      [deviceId, user.email]
    ),
  ]);

  const device = safeDeviceSummary(result.rows[0]);
  const agentReachable = typeof options.isAgentReachable === 'function'
    ? options.isAgentReachable(device.id)
    : options.agentReachable;

  return {
    device,
    heartbeatSummary: {
      recentCount: heartbeatsResult.rows.length,
      latest: heartbeatsResult.rows[0] || null,
    },
    recentCommands: commandsResult.rows,
    remoteConnect: remoteConnectionReadiness(device, { agentReachable }),
    remoteDesktop: desktopCapabilityForDevice(device, { agentReachable }),
    recentRemoteDesktopSessions: desktopSessionsResult.rows,
  };
}

module.exports = {
  getRemoteAccessDeviceDetail,
  getRemoteAccessDashboard,
  remoteDeviceScope,
};
