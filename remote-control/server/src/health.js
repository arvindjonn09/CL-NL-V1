const {
  HEARTBEAT_THRESHOLDS_SECONDS,
  RECENT_ERROR_SECONDS,
  RECENT_WARNING_SECONDS,
} = require('./healthConstants');

const OPERATION_ERROR_SOURCES = new Set([
  'command',
  'command-poll',
  'command-started',
  'command-result',
  'file-transfer',
  'file-complete',
  'file-failed',
]);

function secondsSince(value, now = new Date()) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();

  if (Number.isNaN(time)) return null;

  return Math.max(0, Math.floor((now.getTime() - time) / 1000));
}

function deriveHealthStatus(device, now = new Date()) {
  const heartbeatAgeSeconds = secondsSince(device.last_seen, now);
  const lastErrorAgeSeconds = secondsSince(device.last_error_at, now);
  const lastErrorSource = String(device.last_error_source || '').toLowerCase();
  const lastCommandAgeSeconds = secondsSince(device.last_command_activity_at, now);
  const lastFileAgeSeconds = secondsSince(device.last_file_activity_at, now);
  const lastCommandFailed = device.last_command_summary?.status === 'failed';
  const lastFileFailed = device.last_file_summary?.status === 'failed';
  const diagnosticsStatus = String(device.diagnostics_status || '').toLowerCase();
  const diagnosticsPayload = device.diagnostics_json || {};
  const recoveryState = String(diagnosticsPayload.recovery?.state || '').toLowerCase();
  const watchdog = diagnosticsPayload.watchdog || {};
  const operatorAttentionNeeded = Boolean(diagnosticsPayload.operator_attention_needed || watchdog.operatorAttentionNeeded);
  const diagnosticsDegraded = Boolean(device.diagnostics_degraded || diagnosticsPayload.degraded);
  const unknownSourceLooksLikeUserOperation = lastErrorSource === '' && (lastCommandFailed || lastFileFailed);
  const deviceLevelErrorSource =
    !unknownSourceLooksLikeUserOperation && !OPERATION_ERROR_SOURCES.has(lastErrorSource);

  if (heartbeatAgeSeconds === null || heartbeatAgeSeconds > HEARTBEAT_THRESHOLDS_SECONDS.offline) {
    return {
      connectionStatus: 'offline',
      healthStatus: 'offline',
      heartbeatAgeSeconds,
      reason: 'device has not checked in recently',
    };
  }

  if (diagnosticsStatus === 'upgrade-pending') {
    return {
      connectionStatus: 'online',
      healthStatus: 'upgrade-pending',
      heartbeatAgeSeconds,
      reason: 'agent has an approved upgrade pending',
    };
  }

  if (operatorAttentionNeeded) {
    return {
      connectionStatus: 'online',
      healthStatus: 'degraded',
      heartbeatAgeSeconds,
      reason: device.diagnostics_degraded_reason || firstWatchdogReason(watchdog) || 'agent watchdog requested operator attention',
    };
  }

  if (recoveryState === 'recovering') {
    return {
      connectionStatus: 'online',
      healthStatus: 'recovering',
      heartbeatAgeSeconds,
      reason: device.diagnostics_degraded_reason || 'agent connectivity recently recovered',
    };
  }

  if (diagnosticsDegraded) {
    return {
      connectionStatus: 'online',
      healthStatus: 'degraded',
      heartbeatAgeSeconds,
      reason: device.diagnostics_degraded_reason || 'agent reported degraded mode',
    };
  }

  if (
    deviceLevelErrorSource &&
    lastErrorAgeSeconds !== null &&
    lastErrorAgeSeconds <= RECENT_ERROR_SECONDS
  ) {
    return {
      connectionStatus: 'online',
      healthStatus: 'degraded',
      heartbeatAgeSeconds,
      reason: 'recent operational error',
    };
  }

  if (heartbeatAgeSeconds > HEARTBEAT_THRESHOLDS_SECONDS.warning) {
    return {
      connectionStatus: 'stale',
      healthStatus: 'stale',
      heartbeatAgeSeconds,
      reason: 'heartbeat is stale',
    };
  }

  if (
    (lastCommandFailed &&
      lastCommandAgeSeconds !== null &&
      lastCommandAgeSeconds <= RECENT_WARNING_SECONDS) ||
    (lastFileFailed &&
      lastFileAgeSeconds !== null &&
      lastFileAgeSeconds <= RECENT_WARNING_SECONDS)
  ) {
    return {
      healthStatus: 'warning',
      connectionStatus: 'online',
      heartbeatAgeSeconds,
      reason: 'recent command or file failure',
    };
  }

  if (heartbeatAgeSeconds > HEARTBEAT_THRESHOLDS_SECONDS.healthy) {
    return {
      healthStatus: 'warning',
      connectionStatus: 'online',
      heartbeatAgeSeconds,
      reason: 'heartbeat is older than expected',
    };
  }

  return {
    connectionStatus: 'online',
    healthStatus: 'healthy',
    heartbeatAgeSeconds,
    reason: 'recent heartbeat and no recent errors',
  };
}

function shapeDeviceSummary(device) {
  const derived = deriveHealthStatus(device);
  const online = derived.connectionStatus === 'online';
  const diagnosticsPayload = device.diagnostics_json || {};
  const watchdog = diagnosticsPayload.watchdog || {};
  const operatorAttentionNeeded = Boolean(diagnosticsPayload.operator_attention_needed || watchdog.operatorAttentionNeeded);

  return {
    deviceId: device.id,
    id: device.id,
    displayName: device.display_name || device.hostname || device.id,
    hostname: device.hostname,
    username: device.username,
    os: device.os,
    online,
    status: derived.connectionStatus,
    connectionStatus: derived.connectionStatus,
    healthStatus: derived.healthStatus,
    healthLabel: healthLabel(derived.healthStatus),
    healthReason: derived.reason,
    heartbeatAgeSeconds: derived.heartbeatAgeSeconds,
    lastSeen: device.last_seen,
    last_seen: device.last_seen,
    runMode: device.run_mode,
    agentVersion: device.agent_version,
    serviceName: device.service_name,
    backendUrl: device.backend_url,
    environmentLabel: device.environment_label || 'unknown',
    startupAt: device.startup_at,
    executablePath: device.executable_path,
    configPath: device.config_path,
    runtimePaths: device.runtime_paths,
    remoteDesktopCapability: device.remote_desktop_capability || null,
    processId: device.process_id,
    lastCommandActivity: device.last_command_activity_at,
    lastFileActivity: device.last_file_activity_at,
    lastErrorAt: device.last_error_at,
    lastErrorSource: device.last_error_source,
    lastErrorMessage: device.last_error_message,
    lastCommandSummary: device.last_command_summary,
    lastFileSummary: device.last_file_summary,
    diagnosticsStatus: device.diagnostics_status,
    diagnosticsDegraded: device.diagnostics_degraded,
    diagnosticsDegradedReason: device.diagnostics_degraded_reason,
    operatorAttentionNeeded,
    upgradeSummary: diagnosticsPayload.upgrade || null,
    upgradeStatus: diagnosticsPayload.upgrade?.status || null,
    diagnosticsHeartbeatFailureCount: device.diagnostics_heartbeat_failure_count,
    diagnosticsLastSuccessfulBackendContact: device.diagnostics_last_successful_backend_contact,
  };
}

function firstWatchdogReason(watchdog = {}) {
  return Array.isArray(watchdog.reasons) && watchdog.reasons.length > 0 ? watchdog.reasons[0] : null;
}

function healthLabel(status) {
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

module.exports = {
  deriveHealthStatus,
  firstWatchdogReason,
  healthLabel,
  secondsSince,
  shapeDeviceSummary,
};
