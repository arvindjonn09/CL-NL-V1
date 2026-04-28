const { deriveHealthStatus } = require('../health');
const { normalizeDiagnosticsSnapshot } = require('./model');

function computeDiagnosticsHealth(device = {}, diagnostics = null, now = new Date()) {
  const base = deriveHealthStatus(device, now);

  if (!diagnostics) {
    return {
      status: base.healthStatus,
      label: labelForStatus(base.healthStatus),
      reason: base.reason,
      connectionStatus: base.connectionStatus,
      heartbeatAgeSeconds: base.heartbeatAgeSeconds,
    };
  }

  if (base.healthStatus === 'offline') {
    return {
      status: 'offline',
      label: 'Offline',
      reason: base.reason,
      connectionStatus: base.connectionStatus,
      heartbeatAgeSeconds: base.heartbeatAgeSeconds,
    };
  }

  if (diagnostics.status === 'upgrade-pending') {
    return {
      status: 'upgrade-pending',
      label: 'Upgrade pending',
      reason: 'agent has an approved upgrade pending',
      connectionStatus: base.connectionStatus,
      heartbeatAgeSeconds: base.heartbeatAgeSeconds,
    };
  }

  const diagnosticsPayload = diagnostics.diagnostics_json || diagnostics;
  const watchdog = diagnostics.watchdog || diagnosticsPayload.watchdog || {};
  if (diagnostics.operatorAttentionNeeded || diagnosticsPayload.operator_attention_needed || watchdog.operatorAttentionNeeded) {
    return {
      status: 'degraded',
      label: 'Operator attention needed',
      reason: diagnostics.degraded_reason || diagnostics.degradedReason || firstWatchdogReason(watchdog) || 'agent watchdog requested operator attention',
      connectionStatus: base.connectionStatus,
      heartbeatAgeSeconds: base.heartbeatAgeSeconds,
    };
  }

  const recoveryState = String(diagnostics.recovery?.state || diagnosticsPayload.recovery?.state || '').toLowerCase();
  if (diagnostics.status === 'recovering' || recoveryState === 'recovering') {
    return {
      status: 'recovering',
      label: 'Recovery in progress',
      reason: diagnostics.degraded_reason || diagnostics.degradedReason || 'agent connectivity recently recovered',
      connectionStatus: base.connectionStatus,
      heartbeatAgeSeconds: base.heartbeatAgeSeconds,
    };
  }

  if (diagnostics.degraded) {
    return {
      status: 'degraded',
      label: 'Degraded',
      reason: diagnostics.degraded_reason || diagnostics.degradedReason || 'agent reported degraded mode',
      connectionStatus: base.connectionStatus,
      heartbeatAgeSeconds: base.heartbeatAgeSeconds,
    };
  }

  if (base.healthStatus === 'healthy') {
    return {
      status: 'healthy',
      label: 'Healthy',
      reason: 'recent heartbeat and diagnostics are normal',
      connectionStatus: base.connectionStatus,
      heartbeatAgeSeconds: base.heartbeatAgeSeconds,
    };
  }

  return {
    status: base.healthStatus,
    label: labelForStatus(base.healthStatus),
    reason: base.reason,
    connectionStatus: base.connectionStatus,
    heartbeatAgeSeconds: base.heartbeatAgeSeconds,
  };
}

function firstWatchdogReason(watchdog = {}) {
  return Array.isArray(watchdog.reasons) && watchdog.reasons.length > 0 ? watchdog.reasons[0] : null;
}

function labelForStatus(status) {
  const labels = {
    healthy: 'Healthy',
    degraded: 'Degraded',
    offline: 'Offline',
    recovering: 'Recovery in progress',
    'upgrade-pending': 'Upgrade pending',
    warning: 'Degraded',
    stale: 'Degraded',
    error: 'Degraded',
  };
  return labels[status] || 'Degraded';
}

async function saveLatestDiagnostics(pool, snapshotInput) {
  const snapshot = normalizeDiagnosticsSnapshot(snapshotInput);
  if (!snapshot.deviceId) {
    const err = new Error('device id is required');
    err.statusCode = 400;
    throw err;
  }

  const recoveryState = String(snapshot.recovery?.state || '').toLowerCase();
  const status = snapshot.status || (recoveryState === 'recovering' ? 'recovering' : (snapshot.degraded ? 'degraded' : 'healthy'));
  const result = await pool.query(
    `
    INSERT INTO device_diagnostics (
      device_id,
      reported_at,
      status,
      degraded,
      degraded_reason,
      last_successful_backend_contact,
      heartbeat_failure_count,
      version,
      run_mode,
      executable_path,
      config_path,
      log_path,
      backend_url,
      service_name,
      last_command_status,
      last_file_status,
      startup_summary_json,
      diagnostics_json
    )
    VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb)
    ON CONFLICT (device_id)
    DO UPDATE SET
      reported_at = NOW(),
      status = EXCLUDED.status,
      degraded = EXCLUDED.degraded,
      degraded_reason = EXCLUDED.degraded_reason,
      last_successful_backend_contact = EXCLUDED.last_successful_backend_contact,
      heartbeat_failure_count = EXCLUDED.heartbeat_failure_count,
      version = EXCLUDED.version,
      run_mode = EXCLUDED.run_mode,
      executable_path = EXCLUDED.executable_path,
      config_path = EXCLUDED.config_path,
      log_path = EXCLUDED.log_path,
      backend_url = EXCLUDED.backend_url,
      service_name = EXCLUDED.service_name,
      last_command_status = EXCLUDED.last_command_status,
      last_file_status = EXCLUDED.last_file_status,
      startup_summary_json = EXCLUDED.startup_summary_json,
      diagnostics_json = EXCLUDED.diagnostics_json
    RETURNING *
    `,
    [
      snapshot.deviceId,
      status,
      snapshot.degraded,
      snapshot.degradedReason || null,
      snapshot.lastSuccessfulBackendContact || null,
      snapshot.heartbeatFailureCount || 0,
      snapshot.version || null,
      snapshot.runMode || null,
      snapshot.executablePath || null,
      snapshot.configPath || null,
      snapshot.logPath || null,
      snapshot.backendUrl || null,
      snapshot.serviceName || null,
      snapshot.lastCommandStatus || null,
      snapshot.lastFileStatus || null,
      snapshot.startupChecks ? JSON.stringify(snapshot.startupChecks) : null,
      JSON.stringify(snapshot.raw),
    ]
  );

  return result.rows[0];
}

async function getLatestDiagnostics(pool, deviceId) {
  const result = await pool.query(
    `
    SELECT *
    FROM device_diagnostics
    WHERE device_id::text = $1::text
    `,
    [deviceId]
  );
  return result.rows[0] || null;
}

async function getDeviceHealth(pool, deviceId) {
  const [deviceResult, diagnostics] = await Promise.all([
    pool.query('SELECT * FROM devices WHERE id = $1', [deviceId]),
    getLatestDiagnostics(pool, deviceId),
  ]);

  if (deviceResult.rowCount === 0) {
    const err = new Error('Device not found');
    err.statusCode = 404;
    throw err;
  }

  const device = deviceResult.rows[0];
  const health = computeDiagnosticsHealth(device, diagnostics);
  return { deviceId, health, diagnostics };
}

module.exports = {
  computeDiagnosticsHealth,
  firstWatchdogReason,
  getDeviceHealth,
  getLatestDiagnostics,
  labelForStatus,
  saveLatestDiagnostics,
};
