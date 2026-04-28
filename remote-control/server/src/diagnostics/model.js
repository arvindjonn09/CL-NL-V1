function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function normalizeDiagnosticsSnapshot(body = {}) {
  const source = firstDefined(body.diagnostics, body.snapshot, body);
  const recovery = source.recovery || {};
  const watchdog = source.watchdog || {};
  const startupChecks = firstDefined(source.startup_checks, source.startupChecks);
  const operatorAttentionNeeded = Boolean(firstDefined(
    source.operator_attention_needed,
    source.operatorAttentionNeeded,
    watchdog.operatorAttentionNeeded
  ));

  return {
    deviceId: firstDefined(source.device_id, source.deviceId, source.id),
    hostname: firstDefined(source.hostname, source.hostName),
    username: firstDefined(source.username, source.userName),
    runMode: firstDefined(source.run_mode, source.runMode),
    version: firstDefined(source.version, source.agentVersion, source.agent_version),
    executablePath: firstDefined(source.executable_path, source.executablePath),
    configPath: firstDefined(source.config_path, source.configPath),
    logPath: firstDefined(source.log_path, source.logPath),
    backendUrl: firstDefined(source.backend_url, source.backendUrl, source.serverUrl),
    serviceName: firstDefined(source.service_name, source.serviceName),
    startupOk: firstDefined(source.startup_ok, source.startupOK),
    startupChecks,
    recovery,
    watchdog,
    status: firstDefined(source.status),
    operatorAttentionNeeded,
    degraded: Boolean(firstDefined(source.degraded, recovery.degraded, operatorAttentionNeeded)),
    degradedReason: firstDefined(source.degraded_reason, source.degradedReason, recovery.degradedReason),
    lastSuccessfulBackendContact: firstDefined(
      source.last_successful_backend_contact,
      source.lastSuccessfulBackendContact,
      recovery.lastSuccessfulBackendContact
    ),
    heartbeatFailureCount: Number(firstDefined(
      source.heartbeat_failure_count,
      source.heartbeatFailureCount,
      recovery.consecutiveBackendFailures,
      0
    )),
    lastCommandStatus: firstDefined(source.last_command_status, source.lastCommandStatus),
    lastFileStatus: firstDefined(source.last_file_status, source.lastFileStatus),
    uptimeSeconds: Number(firstDefined(source.uptime_seconds, source.uptimeSeconds, 0)),
    raw: source,
  };
}

module.exports = {
  normalizeDiagnosticsSnapshot,
};
