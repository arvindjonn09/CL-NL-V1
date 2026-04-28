function toTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addEvent(events, event) {
  const at = toTime(event.at);
  if (!at) return;
  events.push({
    id: event.id,
    at: at.toISOString(),
    type: event.type,
    label: event.label,
    detail: event.detail || null,
    status: event.status || null,
    source: event.source || null,
  });
}

function commandResultDetail(command) {
  const parts = [];
  if (command.command) parts.push(command.command);
  if (command.exit_code !== null && command.exit_code !== undefined) parts.push(`exit ${command.exit_code}`);
  if (command.error_message) parts.push(command.error_message);
  return parts.join(' · ');
}

function fileJobDetail(job) {
  const parts = [job.original_name || job.filename].filter(Boolean);
  if (job.bytes_transferred) parts.push(`${job.bytes_transferred} bytes`);
  if (job.destination_path) parts.push(job.destination_path);
  if (job.error_message) parts.push(job.error_message);
  return parts.join(' · ');
}

function upgradeLabel(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('rollback')) return 'Upgrade rollback recorded';
  if (value.includes('success')) return 'Upgrade completed';
  if (value.includes('applied') || value.includes('apply')) return 'Upgrade apply recorded';
  if (value.includes('stage') || value === 'manifest-served') return 'Upgrade staged/check recorded';
  return 'Upgrade event recorded';
}

function healthEventLabel(event) {
  const source = String(event.source || '').toLowerCase();
  const message = String(event.message || '').toLowerCase();
  if (source.includes('watchdog') || message.includes('operator attention')) return 'Operator attention changed';
  if (message.includes('recover')) return 'Recovery entered';
  if (message.includes('degraded')) return 'Degraded entered';
  return 'Health event recorded';
}

function buildDeviceTimeline({
  heartbeats = [],
  commands = [],
  fileJobs = [],
  healthEvents = [],
  actions = [],
  upgradeEvents = [],
  auditLogs = [],
} = {}, limit = 30) {
  const events = [];

  for (const heartbeat of heartbeats) {
    addEvent(events, {
      id: `heartbeat:${heartbeat.id}`,
      at: heartbeat.created_at,
      type: 'heartbeat',
      label: 'Heartbeat seen',
      detail: [heartbeat.run_mode, heartbeat.agent_version, heartbeat.process_id ? `pid ${heartbeat.process_id}` : null]
        .filter(Boolean)
        .join(' · '),
      status: 'online',
      source: 'agent',
    });
  }

  for (const command of commands) {
    const commandId = command.command_id || command.id;
    addEvent(events, {
      id: `command-dispatched:${commandId}`,
      at: command.command_created_at || command.created_at,
      type: 'command',
      label: 'Command dispatched',
      detail: command.command,
      status: command.status === 'pending' ? 'pending' : null,
      source: 'admin',
    });
    addEvent(events, {
      id: `command-completed:${commandId}`,
      at: command.completed_at || command.result_created_at,
      type: 'command',
      label: command.status === 'failed' ? 'Command failed' : 'Command completed',
      detail: commandResultDetail(command),
      status: command.status,
      source: 'agent',
    });
  }

  for (const job of fileJobs) {
    addEvent(events, {
      id: `file-uploaded:${job.id}`,
      at: job.created_at || job.started_at,
      type: 'file',
      label: 'File upload queued',
      detail: fileJobDetail(job),
      status: job.status === 'pending' ? 'pending' : null,
      source: 'admin',
    });
    addEvent(events, {
      id: `file-finished:${job.id}`,
      at: job.completed_at,
      type: 'file',
      label: job.status === 'failed' ? 'File transfer failed' : 'File transfer completed',
      detail: fileJobDetail(job),
      status: job.status,
      source: 'agent',
    });
  }

  for (const event of healthEvents) {
    addEvent(events, {
      id: `health:${event.id}`,
      at: event.created_at,
      type: 'health',
      label: healthEventLabel(event),
      detail: event.message,
      status: event.level,
      source: event.source,
    });
  }

  for (const action of actions) {
    addEvent(events, {
      id: `action-requested:${action.id}`,
      at: action.requested_at,
      type: 'action',
      label: 'Admin action requested',
      detail: [action.action_type, action.requested_by].filter(Boolean).join(' · '),
      status: action.status === 'pending' || action.status === 'running' ? action.status : null,
      source: action.requested_by || 'admin',
    });
    addEvent(events, {
      id: `action-completed:${action.id}`,
      at: action.completed_at,
      type: 'action',
      label: action.status === 'failed' ? 'Admin action failed' : 'Admin action completed',
      detail: [action.action_type, action.error_summary || action.result_summary].filter(Boolean).join(' · '),
      status: action.status,
      source: 'agent',
    });
  }

  for (const event of upgradeEvents) {
    addEvent(events, {
      id: `upgrade:${event.id}`,
      at: event.created_at,
      type: 'upgrade',
      label: upgradeLabel(event.status),
      detail: [event.from_version && event.to_version ? `${event.from_version} -> ${event.to_version}` : event.to_version, event.reason]
        .filter(Boolean)
        .join(' · '),
      status: event.status,
      source: 'upgrade',
    });
  }

  for (const log of auditLogs) {
    addEvent(events, {
      id: `audit:${log.id}`,
      at: log.created_at,
      type: 'audit',
      label: 'Audit event recorded',
      detail: [log.action, log.detail].filter(Boolean).join(' · '),
      status: log.result,
      source: log.admin_user || 'admin',
    });
  }

  return events
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}

module.exports = {
  buildDeviceTimeline,
};
