import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import CommandForm from './CommandForm';
import CommandResults from './CommandResults';
import LiveTerminal from './LiveTerminal';
import PagePoller from './PagePoller';
import UploadForm from './UploadForm';
import DeviceControls from './DeviceControls';
import DeviceDangerZone from './DeviceDangerZone';
import EnvironmentEditor from './EnvironmentEditor';
import { apiBaseUrl } from '../../lib/api';
import { formatDate, healthLabel, shortText, statusBadge } from '../statusStyles';

type RecentCommand = {
  command_id: string;
  id?: string;
  command: string;
  status: string;
  command_created_at?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  result_created_at?: string | null;
};

type FileJob = {
  id: string;
  filename: string;
  original_name?: string | null;
  direction: string;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  bytes_transferred?: number | string | null;
  error_message?: string | null;
};

type HealthEvent = {
  id: string;
  level: string;
  source: string;
  message: string;
  created_at?: string | null;
};

type Heartbeat = {
  id: string;
  run_mode?: string | null;
  agent_version?: string | null;
  process_id?: number | null;
  created_at?: string | null;
};

type DeviceAction = {
  id: string;
  action_type: string;
  status: string;
  requested_by?: string | null;
  requested_at?: string | null;
  completed_at?: string | null;
  result_summary?: string | null;
  error_summary?: string | null;
  result_payload?: Record<string, unknown> | null;
};

type TimelineEntry = {
  id: string;
  at: string;
  type: string;
  label: string;
  detail?: string | null;
  status?: string | null;
  source?: string | null;
};

type DeviceSummary = {
  id: string;
  displayName?: string | null;
  hostname?: string | null;
  username?: string | null;
  os?: string | null;
  status: string;
  healthStatus: string;
  healthLabel?: string | null;
  healthReason?: string | null;
  operatorAttentionNeeded?: boolean;
  environmentLabel?: string | null;
  heartbeatAgeSeconds?: number | null;
  lastSeen?: string | null;
  diagnosticsStatus?: string | null;
  diagnosticsHeartbeatFailureCount?: number | null;
  diagnosticsLastSuccessfulBackendContact?: string | null;
  lastCommandActivity?: string | null;
  lastFileActivity?: string | null;
  lastErrorAt?: string | null;
  runMode?: string | null;
  agentVersion?: string | null;
  serviceName?: string | null;
  processId?: number | null;
  startupAt?: string | null;
  backendUrl?: string | null;
  configPath?: string | null;
  executablePath?: string | null;
  runtimePaths?: Record<string, string>;
  upgradeStatus?: string | null;
  upgradeSummary?: {
    status?: string | null;
    version?: string | null;
    reason?: string | null;
  } | null;
};

function operationalHint(device: DeviceSummary) {
  if (device.operatorAttentionNeeded) {
    return 'Operator attention is requested. Check watchdog reasons, recent health events, and recovery runbook before retrying risky actions.';
  }

  const status = String(device.healthStatus || '').toLowerCase();
  if (status === 'healthy') return 'Recent heartbeat and diagnostics are normal. Routine commands and file transfers are appropriate.';
  if (status === 'degraded' || status === 'warning' || status === 'stale') return 'Device may still be reachable, but diagnostics or recent operations need review before high-risk actions.';
  if (status === 'recovering') return 'Recovery is in progress. Prefer observation or a heartbeat refresh before starting disruptive work.';
  if (status === 'upgrade-pending') return 'An approved upgrade is pending. Stage and apply only during an acceptable maintenance window.';
  if (status === 'offline') return 'Device has not checked in recently. Confirm service state and backend connectivity before queuing work.';
  return 'Review current diagnostics and recent activity before taking action.';
}

function hasStagedUpgrade(device: DeviceSummary, actions: DeviceAction[]) {
  if (device.upgradeStatus === 'staged') return true;
  const latestUpgradeAction = actions.find((action) =>
    action.action_type === 'check-upgrade' || action.action_type === 'apply-staged-upgrade'
  );
  if (!latestUpgradeAction) return false;
  if (latestUpgradeAction.action_type === 'apply-staged-upgrade' && latestUpgradeAction.status !== 'failed') return false;
  return latestUpgradeAction.action_type === 'check-upgrade' &&
    latestUpgradeAction.status === 'success' &&
    (
      Boolean(latestUpgradeAction.result_payload?.stagedPath) ||
      String(latestUpgradeAction.result_summary || '').toLowerCase().includes('staged')
    );
}

async function getDeviceSummary(deviceId: string, session: string) {
  const res = await fetch(
    `${apiBaseUrl()}/api/devices/${deviceId}/summary`,
    {
      cache: 'no-store',
      headers: {
        Cookie: `session=${session}`,
      },
    }
  );

  if (res.status === 401) {
    redirect('/admin');
  }

  if (res.status === 403) {
    try {
      const body = await res.json();
      if (body.acknowledgementRequired) {
        redirect(`/acknowledgement?returnTo=/devices/${deviceId}`);
      }
    } catch {
      redirect(`/acknowledgement?returnTo=/devices/${deviceId}`);
    }
  }

  if (!res.ok) {
    throw new Error('Failed to fetch device summary');
  }

  return res.json();
}

export default async function DevicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const cookieStore = await cookies();
  const session = cookieStore.get('session');

  if (!session) {
    redirect('/admin');
  }

  const { id } = await params;

  const summary = await getDeviceSummary(id, session.value);
  const device = summary.device as DeviceSummary;

  if (!device) {
    return (
      <main style={{ padding: '24px' }}>
        <h1>Device not found</h1>
      </main>
    );
  }

  const pending = summary.recentCommands.filter((item: RecentCommand) =>
    item.status === 'pending' || item.status === 'running'
  );
  const stagedUpgrade = hasStagedUpgrade(device, summary.recentActions || []);

  return (
    <main style={{ padding: '24px', fontFamily: 'Arial, sans-serif' }}>
      <PagePoller />

      <Link href="/" style={{ color: '#2563eb' }}>
        {'<-'} Back to devices
      </Link>

      <div style={{ marginTop: '16px', marginBottom: '16px' }}>
        <h1 style={{ margin: 0 }}>{device.displayName || device.hostname || device.id}</h1>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
          <span style={statusBadge(device.status)}>{device.status}</span>
          <span style={statusBadge(device.healthStatus)}>{device.healthLabel || healthLabel(device.healthStatus)}</span>
          <span style={statusBadge(device.environmentLabel)}>{device.environmentLabel || 'unknown'}</span>
          <span style={mutedBadge}>{device.runMode || 'mode unknown'}</span>
          <span style={mutedBadge}>{device.agentVersion || 'version unknown'}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gap: '12px', maxWidth: '900px' }}>
        <div style={card}>
          <h2 style={sectionTitle}>Health Summary</h2>
          <p style={hintText}>{operationalHint(device)}</p>
          <div style={runbookRow}>
            <a href="/docs/runbook/troubleshooting.md" target="_blank" rel="noreferrer">Troubleshooting</a>
            <a href="/docs/runbook/recovery.md" target="_blank" rel="noreferrer">Recovery</a>
            <a href="/docs/runbook/upgrade.md" target="_blank" rel="noreferrer">Upgrade</a>
          </div>
          <div style={detailsGrid}>
            <div><strong>ID:</strong> {device.id}</div>
            <div><strong>Name:</strong> {device.displayName || '-'}</div>
            <div><strong>Hostname:</strong> {device.hostname || '-'}</div>
            <div><strong>User:</strong> {device.username || '-'}</div>
            <div><strong>Environment:</strong> {device.environmentLabel || 'unknown'}</div>
            <div><strong>OS:</strong> {device.os}</div>
            <div><strong>Last heartbeat:</strong> {formatDate(device.lastSeen)}</div>
            <div><strong>Heartbeat age:</strong> {device.heartbeatAgeSeconds ?? '-'}s</div>
            <div><strong>Health reason:</strong> {device.healthReason}</div>
            <div><strong>Recovery state:</strong> {device.diagnosticsStatus || device.healthStatus || '-'}</div>
            <div><strong>Backend failures:</strong> {device.diagnosticsHeartbeatFailureCount ?? 0}</div>
            <div><strong>Last backend recovery:</strong> {formatDate(device.diagnosticsLastSuccessfulBackendContact)}</div>
            <div><strong>Last command:</strong> {formatDate(device.lastCommandActivity)}</div>
            <div><strong>Last file:</strong> {formatDate(device.lastFileActivity)}</div>
            <div><strong>Last error:</strong> {formatDate(device.lastErrorAt)}</div>
          </div>
        </div>

        <div style={card}>
          <h2 style={sectionTitle}>Runtime</h2>
          <div style={detailsGrid}>
            <div><strong>Run mode:</strong> {device.runMode || '-'}</div>
            <div><strong>Service:</strong> {device.serviceName || '-'}</div>
            <div><strong>PID:</strong> {device.processId || '-'}</div>
            <div><strong>Startup:</strong> {formatDate(device.startupAt)}</div>
            <div><strong>Backend:</strong> {device.backendUrl || '-'}</div>
            <div><strong>Config:</strong> {device.configPath || '-'}</div>
            <div><strong>Executable:</strong> {device.executablePath || '-'}</div>
            <div><strong>Logs:</strong> {device.runtimePaths?.logPath || '-'}</div>
            <div><strong>Data:</strong> {device.runtimePaths?.dataPath || '-'}</div>
            <div><strong>Files:</strong> {device.runtimePaths?.filesPath || '-'}</div>
            <div><strong>Device state:</strong> {device.runtimePaths?.deviceStatePath || '-'}</div>
          </div>
        </div>

        <div style={card}>
          <h2 style={sectionTitle}>Activity Timeline</h2>
          {summary.timeline?.length === 0 ? (
            <p style={empty}>No timeline activity yet.</p>
          ) : (
            <div style={timelineList}>
              {summary.timeline?.map((event: TimelineEntry) => (
                <div key={event.id} style={timelineRow}>
                  <div style={timelineTime}>{formatDate(event.at)}</div>
                  <div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong>{event.label}</strong>
                      {event.status && <span style={statusBadge(event.status)}>{event.status}</span>}
                      {event.source && <span style={mutedBadge}>{event.source}</span>}
                    </div>
                    {event.detail && <div style={timelineDetail}>{shortText(event.detail, 220)}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={card}>
          <h2 style={sectionTitle}>Controls</h2>
          <EnvironmentEditor
            deviceId={device.id}
            initialEnvironment={device.environmentLabel || 'unknown'}
          />
          <DeviceControls
            deviceId={device.id}
            recentActions={summary.recentActions || []}
            hasStagedUpgrade={stagedUpgrade}
          />
        </div>

        <section style={card}>
          <h2 style={sectionTitle}>Remote Operations</h2>
          <div style={operationGrid}>
            <div style={operationPanel}>
              <CommandForm deviceId={device.id} />
            </div>

            <div style={operationPanel}>
              <UploadForm deviceId={device.id} />
            </div>

            <div style={operationPanel}>
              <LiveTerminal deviceId={device.id} />
            </div>

            <div style={operationPanel}>
              <h3 style={subsectionTitle}>Recent Admin Actions</h3>
              {summary.recentActions?.length === 0 ? (
                <p style={empty}>No admin actions yet.</p>
              ) : (
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Action</th>
                      <th style={th}>Operator</th>
                      <th style={th}>Status</th>
                      <th style={th}>Requested</th>
                      <th style={th}>Completed</th>
                      <th style={th}>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recentActions?.map((action: DeviceAction) => (
                      <tr key={action.id}>
                        <td style={td}>{action.action_type}</td>
                        <td style={td}>{action.requested_by || '-'}</td>
                        <td style={td}><span style={statusBadge(action.status)}>{action.status}</span></td>
                        <td style={td}>{formatDate(action.requested_at)}</td>
                        <td style={td}>{formatDate(action.completed_at)}</td>
                        <td style={td}>
                          <div>{shortText(action.error_summary || action.result_summary, 200)}</div>
                          {typeof action.result_payload?.recentLog === 'string' && (
                            <pre style={logPreview}>{shortText(action.result_payload.recentLog, 2000)}</pre>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>

        <div style={card}>
          <h2 style={sectionTitle}>Danger Zone</h2>
          <DeviceDangerZone deviceId={device.id} />
        </div>

        <div style={card}>
          <h2 style={{ marginTop: 0 }}>Running / Pending Commands</h2>

          {pending.length === 0 ? (
            <p>No running or pending commands.</p>
          ) : (
            <div style={{ display: 'grid', gap: '12px' }}>
              {pending.map((item: RecentCommand) => (
                <div key={item.command_id || item.id} style={pendingCard}>
                  <div><strong>$ {item.command}</strong></div>
                  <div style={{ marginTop: '8px' }}>
                    <span style={item.status === 'running' ? runningBadge : pendingBadge}>
                      {item.status}
                    </span>
                  </div>
                  <div style={{ marginTop: '6px', color: '#6b7280', fontSize: '14px' }}>
                    Created: {formatDate(item.command_created_at || item.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <CommandResults results={summary.recentCommands} />

        <div style={card}>
          <h2 style={sectionTitle}>Recent Heartbeats</h2>
          {summary.recentHeartbeats.length === 0 ? (
            <p style={empty}>No heartbeat history yet.</p>
          ) : (
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Received</th>
                  <th style={th}>Run Mode</th>
                  <th style={th}>Agent</th>
                  <th style={th}>PID</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentHeartbeats.map((heartbeat: Heartbeat) => (
                  <tr key={heartbeat.id}>
                    <td style={td}>{formatDate(heartbeat.created_at)}</td>
                    <td style={td}>{heartbeat.run_mode || '-'}</td>
                    <td style={td}>{heartbeat.agent_version || '-'}</td>
                    <td style={td}>{heartbeat.process_id || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={card}>
          <h2 style={sectionTitle}>Recent File Jobs</h2>
          {summary.recentFileJobs.length === 0 ? (
            <p style={empty}>No file jobs yet.</p>
          ) : (
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>File</th>
                  <th style={th}>Direction</th>
                  <th style={th}>Status</th>
                  <th style={th}>Started</th>
                  <th style={th}>Completed</th>
                  <th style={th}>Bytes</th>
                  <th style={th}>Error</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentFileJobs.map((job: FileJob) => (
                  <tr key={job.id}>
                    <td style={td}>{job.original_name || job.filename}</td>
                    <td style={td}>{job.direction}</td>
                    <td style={td}><span style={statusBadge(job.status)}>{job.status}</span></td>
                    <td style={td}>{formatDate(job.started_at)}</td>
                    <td style={td}>{formatDate(job.completed_at)}</td>
                    <td style={td}>{job.bytes_transferred || '-'}</td>
                    <td style={td}>{shortText(job.error_message, 120)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={card}>
          <h2 style={sectionTitle}>Recent Health Events</h2>
          {summary.recentErrors.length === 0 ? (
            <p style={empty}>No recent errors.</p>
          ) : (
            <div style={{ display: 'grid', gap: '8px' }}>
              {summary.recentErrors.map((event: HealthEvent) => (
                <div key={event.id} style={eventRow}>
                  <span style={statusBadge(event.level)}>{event.level}</span>
                  <strong>{event.source}</strong>
                  <span>{shortText(event.message, 180)}</span>
                  <span style={{ color: '#6b7280' }}>{formatDate(event.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

const card: React.CSSProperties = {
  border: '1px solid #d1d5db',
  padding: '12px',
  borderRadius: '8px',
  background: '#fff',
};

const sectionTitle: React.CSSProperties = {
  marginTop: 0,
  marginBottom: '10px',
};

const subsectionTitle: React.CSSProperties = {
  marginTop: 0,
  marginBottom: '10px',
  fontSize: '18px',
};

const operationGrid: React.CSSProperties = {
  display: 'grid',
  gap: '12px',
};

const operationPanel: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '12px',
  background: '#f9fafb',
  overflowX: 'auto',
};

const detailsGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '10px',
  color: '#111827',
  fontSize: '14px',
};

const hintText: React.CSSProperties = {
  marginTop: 0,
  color: '#374151',
  fontSize: '14px',
  lineHeight: 1.45,
};

const runbookRow: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  flexWrap: 'wrap',
  marginBottom: '12px',
  fontSize: '14px',
};

const timelineList: React.CSSProperties = {
  display: 'grid',
  gap: '10px',
};

const timelineRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '170px 1fr',
  gap: '12px',
  borderBottom: '1px solid #e5e7eb',
  paddingBottom: '10px',
  fontSize: '14px',
};

const timelineTime: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '13px',
};

const timelineDetail: React.CSSProperties = {
  marginTop: '4px',
  color: '#374151',
};

const pendingCard: React.CSSProperties = {
  border: '1px solid #f59e0b',
  padding: '12px',
  borderRadius: '8px',
  background: '#fffbeb',
};

const pendingBadge: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: '999px',
  background: '#fef3c7',
  color: '#92400e',
  fontSize: '12px',
  fontWeight: 700,
  textTransform: 'capitalize',
};

const runningBadge: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: '999px',
  background: '#dbeafe',
  color: '#1d4ed8',
  fontSize: '12px',
  fontWeight: 700,
  textTransform: 'capitalize',
};

const mutedBadge: React.CSSProperties = {
  display: 'inline-block',
  padding: '3px 9px',
  borderRadius: '999px',
  background: '#f3f4f6',
  color: '#374151',
  border: '1px solid #d1d5db',
  fontSize: '12px',
  fontWeight: 700,
};

const table: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
};

const th: React.CSSProperties = {
  border: '1px solid #d1d5db',
  padding: '8px',
  background: '#f9fafb',
  textAlign: 'left',
  fontSize: '13px',
};

const td: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  padding: '8px',
  verticalAlign: 'top',
  fontSize: '13px',
};

const empty: React.CSSProperties = {
  color: '#6b7280',
};

const eventRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(80px, 120px) 1fr auto',
  gap: '10px',
  alignItems: 'center',
  borderBottom: '1px solid #e5e7eb',
  paddingBottom: '8px',
  fontSize: '14px',
};

const logPreview: React.CSSProperties = {
  marginTop: '8px',
  maxHeight: '220px',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  background: '#111827',
  color: '#f9fafb',
  padding: '10px',
  borderRadius: '6px',
  fontSize: '12px',
};
