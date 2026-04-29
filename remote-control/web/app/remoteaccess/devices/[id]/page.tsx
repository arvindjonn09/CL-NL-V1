'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatDate, healthLabel, shortText, statusBadge } from '../../../devices/statusStyles';
import { remoteAccessApiUrl } from '../../apiBase';

type DeviceDetail = {
  device: {
    id: string;
    hostname?: string | null;
    displayName?: string | null;
    environmentLabel?: string | null;
    username?: string | null;
    os?: string | null;
    online?: boolean;
    status: string;
    connectionStatus?: string | null;
    healthStatus: string;
    healthLabel?: string | null;
    healthReason?: string | null;
    runMode?: string | null;
    agentVersion?: string | null;
    lastSeen?: string | null;
    heartbeatAgeSeconds?: number | null;
  };
  heartbeatSummary?: {
    recentCount: number;
    latest?: {
      run_mode?: string | null;
      agent_version?: string | null;
      process_id?: number | null;
      created_at?: string | null;
    } | null;
  };
  recentCommands: Array<{
    command_id: string;
    command: string;
    status: string;
    command_created_at?: string | null;
    completed_at?: string | null;
    exit_code?: number | null;
  }>;
  remoteConnect?: {
    available: boolean;
    state?: string | null;
    reason?: string | null;
    label?: string | null;
  };
  remoteDesktop?: {
    supported: boolean;
    available: boolean;
    state?: string | null;
    reason?: string | null;
    label?: string | null;
    runtime?: {
      relay?: string;
      screenCapture?: string;
      input?: string;
    };
  };
  recentRemoteDesktopSessions?: Array<{
    id: string;
    status: string;
    created_at?: string | null;
    failure_reason?: string | null;
  }>;
};

export default function RemoteAccessDevicePage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id || '');
  const [detail, setDetail] = useState<DeviceDetail | null>(null);
  const [mode, setMode] = useState<'loading' | 'ready' | 'denied' | 'login' | 'error'>('loading');

  useEffect(() => {
    let active = true;

    async function loadDevice() {
      try {
        const res = await fetch(remoteAccessApiUrl(`/api/remoteaccess/devices/${encodeURIComponent(id)}`), {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!active) return;
        if (res.status === 401) { setMode('login'); return; }
        if (res.status === 404 || res.status === 403) { setMode('denied'); return; }
        if (!res.ok) { setMode('error'); return; }
        setDetail(await res.json());
        setMode('ready');
      } catch {
        if (active) setMode('error');
      }
    }

    if (id) loadDevice();
    return () => { active = false; };
  }, [id]);

  function connect() {
    window.open(`/remoteaccess/devices/${encodeURIComponent(id)}/desktop`, '_blank', 'noopener');
  }

  return (
    <main style={page}>
      <section style={shell}>
        <header style={header}>
          <div>
            <Link href="/remoteaccess" style={backLink}>Back to remote access</Link>
            <h1 style={title}>{detail?.device.displayName || detail?.device.hostname || 'Device Detail'}</h1>
            <p style={subtitle}>Read-only status for this assigned device.</p>
          </div>
        </header>

        {mode === 'loading' && <p style={muted}>Loading device...</p>}

        {mode === 'login' && (
          <div style={panel}>
            <h2 style={sectionTitle}>Session required</h2>
            <p style={muted}>Sign in again to view remote-access devices.</p>
            <Link href="/remoteaccess" style={buttonLink}>Sign in</Link>
          </div>
        )}

        {mode === 'denied' && (
          <div style={panel}>
            <h2 style={sectionTitle}>Device unavailable</h2>
            <p style={muted}>This device is not available for this remote-access account.</p>
          </div>
        )}

        {mode === 'error' && (
          <div style={panel}>
            <h2 style={sectionTitle}>Could not load device</h2>
            <p style={muted}>The device status endpoint is unavailable right now.</p>
          </div>
        )}

        {mode === 'ready' && detail && (
          <div style={contentGrid}>
            <section style={panel}>
              <div style={statusRow}>
                <span style={statusBadge(detail.device.status)}>{detail.device.status}</span>
                <span style={statusBadge(detail.device.healthStatus)}>
                  {detail.device.healthLabel || healthLabel(detail.device.healthStatus)}
                </span>
              </div>
              <div style={detailGrid}>
                <DetailItem label="Hostname" value={detail.device.hostname || '-'} />
                <DetailItem label="Environment" value={detail.device.environmentLabel || 'unknown'} />
                <DetailItem label="User" value={detail.device.username || '-'} />
                <DetailItem label="OS" value={detail.device.os || '-'} />
                <DetailItem label="Run mode" value={detail.device.runMode || '-'} />
                <DetailItem label="Agent version" value={detail.device.agentVersion || '-'} />
                <DetailItem label="Last seen" value={formatDate(detail.device.lastSeen)} />
                <DetailItem label="Heartbeat age" value={detail.device.heartbeatAgeSeconds == null ? '-' : `${detail.device.heartbeatAgeSeconds}s`} />
              </div>
              {detail.device.healthReason && <p style={reason}>{detail.device.healthReason}</p>}
            </section>

            <section style={panel}>
              <h2 style={sectionTitle}>Heartbeat Summary</h2>
              <div style={detailGrid}>
                <DetailItem label="Recent heartbeats" value={String(detail.heartbeatSummary?.recentCount ?? 0)} />
                <DetailItem label="Latest heartbeat" value={formatDate(detail.heartbeatSummary?.latest?.created_at)} />
                <DetailItem label="Latest run mode" value={detail.heartbeatSummary?.latest?.run_mode || detail.device.runMode || '-'} />
                <DetailItem label="Latest agent" value={detail.heartbeatSummary?.latest?.agent_version || detail.device.agentVersion || '-'} />
              </div>
            </section>

            <section style={panel}>
              <h2 style={sectionTitle}>Remote Desktop</h2>
              <p style={muted}>{detail.remoteDesktop?.label || detail.remoteConnect?.label || 'Remote desktop is not available.'}</p>
              <div style={capabilityGrid}>
                <DetailItem label="Relay" value={detail.remoteDesktop?.runtime?.relay || 'unavailable'} />
                <DetailItem label="Screen capture" value={detail.remoteDesktop?.runtime?.screenCapture || 'not_ready'} />
                <DetailItem label="Input" value={detail.remoteDesktop?.runtime?.input || 'not_ready'} />
              </div>
              {detail.remoteDesktop?.available ? (
                <button type="button" onClick={connect} style={button}>
                  Connect
                </button>
              ) : (
                <div style={statePill}>
                  {detail.remoteDesktop?.state === 'offline'
                    ? 'Device offline'
                    : detail.remoteDesktop?.state === 'not_ready'
                      ? 'Connect not ready yet'
                      : 'Remote desktop unavailable'}
                </div>
              )}
              {detail.recentRemoteDesktopSessions?.length ? (
                <div style={sessionList}>
                  {detail.recentRemoteDesktopSessions.map((session) => (
                    <div key={session.id} style={sessionRow}>
                      <span>{session.status}</span>
                      <span>{formatDate(session.created_at)}</span>
                      {session.failure_reason && <span>{shortText(session.failure_reason, 80)}</span>}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <section style={panel}>
              <h2 style={sectionTitle}>Recent Commands</h2>
              {detail.recentCommands.length === 0 ? (
                <p style={muted}>No recent command history is visible.</p>
              ) : (
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Command</th>
                      <th style={th}>Status</th>
                      <th style={th}>Queued</th>
                      <th style={th}>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.recentCommands.map((command) => (
                      <tr key={command.command_id}>
                        <td style={td}>{shortText(command.command, 120)}</td>
                        <td style={td}><span style={statusBadge(command.status)}>{command.status}</span></td>
                        <td style={td}>{formatDate(command.command_created_at)}</td>
                        <td style={td}>{formatDate(command.completed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={detailLabel}>{label}</div>
      <div style={detailValue}>{value}</div>
    </div>
  );
}

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f8fafc',
  padding: '32px 18px',
  fontFamily: 'Arial, sans-serif',
};

const shell: React.CSSProperties = {
  maxWidth: '980px',
  margin: '0 auto',
};

const header: React.CSSProperties = {
  marginBottom: '18px',
};

const backLink: React.CSSProperties = {
  color: '#2563eb',
  fontWeight: 700,
  textDecoration: 'none',
};

const title: React.CSSProperties = {
  margin: '10px 0 0',
};

const subtitle: React.CSSProperties = {
  marginTop: '6px',
  color: '#475569',
};

const contentGrid: React.CSSProperties = {
  display: 'grid',
  gap: '14px',
};

const panel: React.CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  background: '#fff',
  padding: '16px',
};

const sectionTitle: React.CSSProperties = {
  marginTop: 0,
  marginBottom: '12px',
};

const muted: React.CSSProperties = {
  color: '#64748b',
};

const buttonLink: React.CSSProperties = {
  display: 'inline-block',
  padding: '10px 14px',
  border: '1px solid #2563eb',
  borderRadius: '6px',
  background: '#2563eb',
  color: '#fff',
  textDecoration: 'none',
  fontWeight: 700,
};

const button: React.CSSProperties = {
  display: 'inline-block',
  padding: '10px 22px',
  border: '1px solid #2563eb',
  borderRadius: '6px',
  background: '#2563eb',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: '15px',
};

const statePill: React.CSSProperties = {
  display: 'inline-block',
  padding: '8px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  color: '#334155',
  background: '#f8fafc',
  fontSize: '13px',
  fontWeight: 700,
};

const capabilityGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: '10px',
  marginBottom: '14px',
};

const sessionList: React.CSSProperties = {
  marginTop: '12px',
  display: 'grid',
  gap: '6px',
};

const sessionRow: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
  color: '#475569',
  fontSize: '13px',
};

const statusRow: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
  marginBottom: '16px',
};

const detailGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '14px',
};

const detailLabel: React.CSSProperties = {
  color: '#64748b',
  fontSize: '12px',
  fontWeight: 700,
  textTransform: 'uppercase',
};

const detailValue: React.CSSProperties = {
  marginTop: '4px',
  color: '#0f172a',
  overflowWrap: 'anywhere',
};

const reason: React.CSSProperties = {
  marginBottom: 0,
  color: '#334155',
  fontSize: '14px',
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
