'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatDate, healthLabel, shortText, statusBadge } from '../devices/statusStyles';
import { REMOTE_ACCESS_SESSION_TIMEOUT_MS, remoteAccessApiUrl } from './apiBase';

type Device = {
  id: string;
  displayName?: string | null;
  hostname?: string | null;
  environmentLabel?: string | null;
  username?: string | null;
  os?: string | null;
  status: string;
  healthStatus: string;
  healthLabel?: string | null;
  healthReason?: string | null;
  runMode?: string | null;
  agentVersion?: string | null;
  lastSeen?: string | null;
  heartbeatAgeSeconds?: number | null;
  detailPath?: string | null;
};

type RecentCommand = {
  command_id: string;
  device_id: string;
  command: string;
  status: string;
  command_created_at?: string | null;
  completed_at?: string | null;
  exit_code?: number | null;
};

type Dashboard = {
  user: {
    email: string;
    displayName?: string | null;
  };
  devices: Device[];
  recentCommands: RecentCommand[];
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
}

export default function RemoteAccessPage() {
  const [mode, setMode] = useState<'loading' | 'login' | 'verify' | 'dashboard'>('loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendAfter, setResendAfter] = useState(0);

  const loadDashboard = useCallback(async (options: { failFast?: boolean } = {}) => {
    const failFast = Boolean(options.failFast);
    try {
      const request = {
        credentials: 'include',
        cache: 'no-store',
      } satisfies RequestInit;
      const res = failFast
        ? await fetchWithTimeout(remoteAccessApiUrl('/api/remoteaccess/dashboard'), request, REMOTE_ACCESS_SESSION_TIMEOUT_MS)
        : await fetch(remoteAccessApiUrl('/api/remoteaccess/dashboard'), request);

      if (!res.ok) {
        setMode('login');
        return;
      }
      setDashboard(await res.json());
      setMode('dashboard');
    } catch {
      if (failFast) {
        setMessage('Session check unavailable, please sign in.');
      }
      setMode('login');
    }
  }, []);

  useEffect(() => {
    loadDashboard({ failFast: true });
  }, [loadDashboard]);

  useEffect(() => {
    if (resendAfter <= 0) return;
    const timer = window.setTimeout(() => setResendAfter((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendAfter]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(remoteAccessApiUrl('/api/remoteaccess/login'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.error || 'Login failed');
        return;
      }
      setChallengeId(body.challengeId);
      setResendAfter(body.resendAfterSeconds || 0);
      setCode('');
      setPassword('');
      setMode('verify');
      setMessage('Verification code sent. Check your email.');
    } catch {
      setMessage('Login request failed');
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(remoteAccessApiUrl('/api/remoteaccess/verify'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, code }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.error || 'Verification failed');
        return;
      }
      await loadDashboard();
    } catch {
      setMessage('Verification request failed');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(remoteAccessApiUrl('/api/remoteaccess/resend'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.error || 'Could not resend code');
        if (body.retryAfterSeconds) setResendAfter(body.retryAfterSeconds);
        return;
      }
      setChallengeId(body.challengeId);
      setResendAfter(body.resendAfterSeconds || 0);
      setCode('');
      setMessage('New verification code sent.');
    } catch {
      setMessage('Resend request failed');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch(remoteAccessApiUrl('/api/remoteaccess/logout'), {
      method: 'POST',
      credentials: 'include',
    });
    setDashboard(null);
    setCode('');
    setChallengeId('');
    setMode('login');
  }

  return (
    <main style={page}>
      <section style={shell}>
        <header style={header}>
          <div>
            <h1 style={title}>NetraLink Remote Access</h1>
            <p style={subtitle}>Read-only device status and remote-access visibility for authorized users.</p>
          </div>
          {mode === 'dashboard' && (
            <button type="button" onClick={logout} style={secondaryButton}>Logout</button>
          )}
        </header>

        {mode === 'loading' && <p style={muted}>Checking session...</p>}

        {mode === 'login' && (
          <form onSubmit={login} style={panel}>
            <h2 style={sectionTitle}>Sign in</h2>
            <label style={label}>
              Email
              <input value={email} onChange={(event) => setEmail(event.target.value)} style={input} autoComplete="email" />
            </label>
            <label style={label}>
              Password
              <input value={password} onChange={(event) => setPassword(event.target.value)} style={input} type="password" autoComplete="current-password" />
            </label>
            <button type="submit" disabled={busy} style={primaryButton}>{busy ? 'Checking...' : 'Continue'}</button>
          </form>
        )}

        {mode === 'verify' && (
          <form onSubmit={verify} style={panel}>
            <h2 style={sectionTitle}>Email verification</h2>
            <p style={muted}>Enter the 4-digit code sent to {email}.</p>
            <label style={label}>
              Verification code
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
                style={codeInput}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </label>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button type="submit" disabled={busy || code.length !== 4} style={primaryButton}>
                {busy ? 'Verifying...' : 'Verify'}
              </button>
              <button type="button" disabled={busy || resendAfter > 0} onClick={resend} style={secondaryButton}>
                {resendAfter > 0 ? `Resend in ${resendAfter}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}

        {mode === 'dashboard' && dashboard && (
          <div style={{ display: 'grid', gap: '14px' }}>
            <div style={panel}>
              <h2 style={sectionTitle}>Device Status</h2>
              {dashboard.devices.length === 0 ? (
                <p style={muted}>No devices are currently visible for this account.</p>
              ) : (
                <div style={deviceGrid}>
                  {dashboard.devices.map((device) => (
                    <Link
                      key={device.id}
                      href={device.detailPath || `/remoteaccess/devices/${encodeURIComponent(device.id)}`}
                      style={deviceCardLink}
                      aria-label={`Open details for ${device.displayName || device.hostname || device.id}`}
                    >
                      <article style={deviceCard}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                          <strong>{device.displayName || device.hostname || device.id}</strong>
                          <span style={statusBadge(device.status)}>{device.status}</span>
                        </div>
                        <div style={deviceMeta}>{device.hostname || '-'} - {device.environmentLabel || 'unknown'} - {device.username || '-'}</div>
                        <div style={facts}>
                          <span>OS: {device.os || '-'}</span>
                          <span>Health: <span style={statusBadge(device.healthStatus)}>{device.healthLabel || healthLabel(device.healthStatus)}</span></span>
                          <span>Run mode: {device.runMode || '-'}</span>
                          <span>Agent: {device.agentVersion || '-'}</span>
                          <span>Last seen: {formatDate(device.lastSeen)}</span>
                          <span>Heartbeat: {device.heartbeatAgeSeconds ?? '-'}s old</span>
                        </div>
                        {device.healthReason && <p style={reason}>{device.healthReason}</p>}
                        <div style={cardAction}>View details</div>
                      </article>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div style={panel}>
              <h2 style={sectionTitle}>Recent Commands</h2>
              {dashboard.recentCommands.length === 0 ? (
                <p style={muted}>No recent command history is visible.</p>
              ) : (
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Device</th>
                      <th style={th}>Command</th>
                      <th style={th}>Status</th>
                      <th style={th}>Queued</th>
                      <th style={th}>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.recentCommands.map((command) => (
                      <tr key={command.command_id}>
                        <td style={td}>{command.device_id}</td>
                        <td style={td}>{shortText(command.command, 120)}</td>
                        <td style={td}><span style={statusBadge(command.status)}>{command.status}</span></td>
                        <td style={td}>{formatDate(command.command_created_at)}</td>
                        <td style={td}>{formatDate(command.completed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {message && <p style={messageStyle}>{message}</p>}
      </section>
    </main>
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
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '16px',
  marginBottom: '18px',
};

const title: React.CSSProperties = {
  margin: 0,
};

const subtitle: React.CSSProperties = {
  marginTop: '6px',
  color: '#475569',
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

const label: React.CSSProperties = {
  display: 'grid',
  gap: '6px',
  marginBottom: '12px',
  fontWeight: 700,
};

const input: React.CSSProperties = {
  maxWidth: '380px',
  padding: '10px',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  fontSize: '15px',
};

const codeInput: React.CSSProperties = {
  ...input,
  width: '110px',
  fontSize: '22px',
  letterSpacing: '4px',
  textAlign: 'center',
};

const primaryButton: React.CSSProperties = {
  padding: '10px 14px',
  border: '1px solid #2563eb',
  borderRadius: '6px',
  background: '#2563eb',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 700,
};

const secondaryButton: React.CSSProperties = {
  padding: '10px 14px',
  border: '1px solid #94a3b8',
  borderRadius: '6px',
  background: '#fff',
  color: '#0f172a',
  cursor: 'pointer',
  fontWeight: 700,
};

const muted: React.CSSProperties = {
  color: '#64748b',
};

const messageStyle: React.CSSProperties = {
  marginTop: '14px',
  color: '#334155',
};

const deviceGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: '12px',
};

const deviceCard: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '12px',
  height: '100%',
};

const deviceCardLink: React.CSSProperties = {
  color: 'inherit',
  textDecoration: 'none',
  display: 'block',
  borderRadius: '8px',
  cursor: 'pointer',
};

const cardAction: React.CSSProperties = {
  marginTop: '12px',
  color: '#2563eb',
  fontWeight: 700,
  fontSize: '14px',
};

const deviceMeta: React.CSSProperties = {
  marginTop: '6px',
  color: '#64748b',
  fontSize: '13px',
};

const facts: React.CSSProperties = {
  display: 'grid',
  gap: '8px',
  marginTop: '12px',
  fontSize: '14px',
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
