'use client';

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { apiBaseUrl } from '../../lib/api';
import { formatDate } from '../../devices/statusStyles';
import { card, label, table, td, th, value } from '../styles';

type AdminUser = {
  id: string;
  email: string;
  displayName?: string | null;
  username?: string | null;
  userType: string;
  status?: string | null;
  remoteAccessEnabled?: boolean;
  deviceScopeMode?: string | null;
  deviceIds?: string[];
  deviceAccessScope?: string | null;
  lastLoginAt?: string | null;
  createdAt?: string | null;
  notes?: string | null;
};

type DeviceOption = {
  id: string;
  label: string;
  status?: string | null;
};

type Counts = {
  total: number;
  admins: number;
  remoteAccess: number;
  disabled: number;
};

type AuditEvent = {
  action: string;
  admin_user?: string | null;
  result: string;
  detail?: string | null;
  created_at?: string | null;
};

type DetailState = {
  user: AdminUser;
  auditEvents: AuditEvent[];
};

const inputStyle = {
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 14,
} satisfies CSSProperties;

const buttonStyle = {
  border: '1px solid #0f172a',
  borderRadius: 6,
  background: '#0f172a',
  color: '#fff',
  padding: '8px 11px',
  fontWeight: 700,
  cursor: 'pointer',
} satisfies CSSProperties;

const secondaryButton = {
  ...buttonStyle,
  background: '#fff',
  color: '#0f172a',
  borderColor: '#cbd5e1',
} satisfies CSSProperties;

const dangerButton = {
  ...buttonStyle,
  background: '#991b1b',
  borderColor: '#991b1b',
} satisfies CSSProperties;

function emptyCreateForm() {
  return {
    name: '',
    email: '',
    username: '',
    password: '',
    userType: 'remote',
    remoteAccessEnabled: true,
    deviceScopeMode: 'all',
    deviceIds: [] as string[],
    notes: '',
  };
}

function typeLabel(user: AdminUser) {
  return user.userType === 'admin' ? 'Admin' : 'Remote Access User';
}

function scopeSummary(user: AdminUser) {
  if (user.deviceScopeMode === 'selected') return `${user.deviceIds?.length || 0} selected`;
  return 'All devices';
}

function badge(text: string, tone: 'good' | 'bad' | 'neutral' = 'neutral') {
  const colors = {
    good: ['#dcfce7', '#166534'],
    bad: ['#fee2e2', '#991b1b'],
    neutral: ['#e2e8f0', '#334155'],
  }[tone];
  return (
    <span style={{
      display: 'inline-block',
      borderRadius: 999,
      background: colors[0],
      color: colors[1],
      padding: '3px 8px',
      fontSize: 12,
      fontWeight: 700,
      whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  );
}

export default function UsersDesk({
  initialUsers,
  initialDevices,
  initialCounts,
}: {
  initialUsers: AdminUser[];
  initialDevices: DeviceOption[];
  initialCounts: Counts;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [devices] = useState(initialDevices);
  const [counts, setCounts] = useState(initialCounts);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [remoteFilter, setRemoteFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm());
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [message, setMessage] = useState('');

  async function refreshUsers() {
    const res = await fetch(`${apiBaseUrl()}/api/admin/users`, { credentials: 'include' });
    if (!res.ok) throw new Error('Could not refresh users');
    const data = await res.json();
    setUsers(data.users);
    setCounts(data.counts);
  }

  async function api(path: string, options: RequestInit = {}) {
    setMessage('');
    const res = await fetch(`${apiBaseUrl()}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Request failed');
    return body;
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(createForm),
      });
      setCreateForm(emptyCreateForm());
      setCreateOpen(false);
      setMessage('User created.');
      await refreshUsers();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function patchUser(user: AdminUser, patch: Record<string, unknown>) {
    try {
      await api(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setMessage('User updated.');
      await refreshUsers();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function adminRoleChange(user: AdminUser, nextType: 'admin' | 'remote') {
    const confirmation = window.prompt(`Type ${user.email} to confirm this admin role change.`);
    if (!confirmation) return;
    await patchUser(user, { userType: nextType, confirmation });
  }

  async function resetPassword(user: AdminUser) {
    const password = window.prompt(`New temporary password for ${user.email}`);
    if (!password) return;
    try {
      await api(`/api/admin/users/${user.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password, passwordChangeRequired: true }),
      });
      setMessage('Password reset and sessions revoked.');
      await refreshUsers();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Password reset failed');
    }
  }

  async function revokeSessions(user: AdminUser) {
    try {
      await api(`/api/admin/users/${user.id}/revoke-sessions`, { method: 'POST', body: '{}' });
      setMessage('Sessions revoked.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Session revocation failed');
    }
  }

  async function viewDetails(user: AdminUser) {
    if (user.id === 'env-admin') {
      setDetail({ user, auditEvents: [] });
      return;
    }
    try {
      const data = await api(`/api/admin/users/${user.id}`);
      setDetail(data);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load details');
    }
  }

  const filtered = useMemo(() => users.filter((user) => {
    const haystack = `${user.displayName || ''} ${user.email} ${user.username || ''}`.toLowerCase();
    if (query && !haystack.includes(query.toLowerCase())) return false;
    if (typeFilter !== 'all' && user.userType !== typeFilter) return false;
    if (statusFilter !== 'all' && (user.status || 'active') !== statusFilter) return false;
    if (remoteFilter !== 'all' && String(Boolean(user.remoteAccessEnabled)) !== remoteFilter) return false;
    return true;
  }), [query, remoteFilter, statusFilter, typeFilter, users]);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[
          ['Users', counts.total],
          ['Admins', counts.admins],
          ['Remote access', counts.remoteAccess],
          ['Disabled', counts.disabled],
        ].map(([name, count]) => (
          <div key={name} style={card}>
            <div style={label}>{name}</div>
            <div style={value}>{count}</div>
          </div>
        ))}
      </section>

      <section style={card}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or email" style={inputStyle} />
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} style={inputStyle}>
              <option value="all">All types</option>
              <option value="admin">Admins</option>
              <option value="remote access">Remote users</option>
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={inputStyle}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
            <select value={remoteFilter} onChange={(event) => setRemoteFilter(event.target.value)} style={inputStyle}>
              <option value="all">Remote access</option>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </div>
          <button type="button" onClick={() => setCreateOpen((open) => !open)} style={buttonStyle}>Create User</button>
        </div>
        {message ? <p style={{ color: message.includes('failed') || message.includes('required') ? '#991b1b' : '#166534', marginBottom: 0 }}>{message}</p> : null}
      </section>

      {createOpen ? (
        <section style={card}>
          <form onSubmit={createUser} style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
              <input required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} placeholder="Full name" style={inputStyle} />
              <input required type="email" value={createForm.email} onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })} placeholder="Email" style={inputStyle} />
              <input value={createForm.username} onChange={(event) => setCreateForm({ ...createForm, username: event.target.value })} placeholder="Username" style={inputStyle} />
              <input required type="password" minLength={8} value={createForm.password} onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} placeholder="Temporary password" style={inputStyle} />
              <select value={createForm.userType} onChange={(event) => setCreateForm({ ...createForm, userType: event.target.value })} style={inputStyle}>
                <option value="remote">Remote Access User</option>
                <option value="admin">Admin</option>
              </select>
              <select value={String(createForm.remoteAccessEnabled)} onChange={(event) => setCreateForm({ ...createForm, remoteAccessEnabled: event.target.value === 'true' })} style={inputStyle}>
                <option value="true">Remote access enabled</option>
                <option value="false">Remote access disabled</option>
              </select>
              <select value={createForm.deviceScopeMode} onChange={(event) => setCreateForm({ ...createForm, deviceScopeMode: event.target.value })} style={inputStyle}>
                <option value="all">All devices</option>
                <option value="selected">Selected devices</option>
              </select>
              <input value={createForm.notes} onChange={(event) => setCreateForm({ ...createForm, notes: event.target.value })} placeholder="Admin note" style={inputStyle} />
            </div>
            {createForm.deviceScopeMode === 'selected' ? (
              <DeviceChecklist devices={devices} selected={createForm.deviceIds} onChange={(deviceIds) => setCreateForm({ ...createForm, deviceIds })} />
            ) : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" style={buttonStyle}>Create</button>
              <button type="button" onClick={() => setCreateOpen(false)} style={secondaryButton}>Cancel</button>
            </div>
          </form>
        </section>
      ) : null}

      <section style={{ ...card, overflowX: 'auto' }}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Email / username</th>
              <th style={th}>Type</th>
              <th style={th}>Remote Access</th>
              <th style={th}>Device Scope</th>
              <th style={th}>Last Login</th>
              <th style={th}>Created</th>
              <th style={th}>Status</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((user) => (
              <tr key={`${user.userType}:${user.id}:${user.email}`}>
                <td style={td}>
                  <strong>{user.displayName || '-'}</strong>
                  {user.notes ? <div style={{ color: '#64748b', marginTop: 4 }}>{user.notes}</div> : null}
                </td>
                <td style={td}>
                  <div>{user.email}</div>
                  <div style={{ color: '#64748b' }}>{user.username || '-'}</div>
                </td>
                <td style={td}>{typeLabel(user)}</td>
                <td style={td}>{user.remoteAccessEnabled ? badge('Enabled', 'good') : badge('Off', 'neutral')}</td>
                <td style={td}>{scopeSummary(user)}</td>
                <td style={td}>{formatDate(user.lastLoginAt)}</td>
                <td style={td}>{formatDate(user.createdAt)}</td>
                <td style={td}>{(user.status || 'active') === 'active' ? badge('Active', 'good') : badge('Disabled', 'bad')}</td>
                <td style={td}>
                  <UserActions
                    user={user}
                    devices={devices}
                    onDetails={() => viewDetails(user)}
                    onPatch={(patch) => patchUser(user, patch)}
                    onReset={() => resetPassword(user)}
                    onRevoke={() => revokeSessions(user)}
                    onAdminChange={adminRoleChange}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {detail ? (
        <section style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h2 style={{ margin: 0 }}>{detail.user.displayName || detail.user.email}</h2>
              <p style={{ color: '#64748b', marginTop: 6 }}>{detail.user.email}</p>
            </div>
            <button type="button" onClick={() => setDetail(null)} style={secondaryButton}>Close</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
            <DetailItem labelText="Type" valueText={typeLabel(detail.user)} />
            <DetailItem labelText="Status" valueText={detail.user.status || 'active'} />
            <DetailItem labelText="Remote access" valueText={detail.user.remoteAccessEnabled ? 'enabled' : 'disabled'} />
            <DetailItem labelText="Device scope" valueText={scopeSummary(detail.user)} />
            <DetailItem labelText="Last login" valueText={formatDate(detail.user.lastLoginAt)} />
            <DetailItem labelText="Created" valueText={formatDate(detail.user.createdAt)} />
          </div>
          <h3>Recent audit</h3>
          {detail.auditEvents.length ? detail.auditEvents.map((event) => (
            <div key={`${event.action}:${event.created_at}`} style={{ borderTop: '1px solid #e2e8f0', padding: '8px 0' }}>
              <strong>{event.action}</strong> by {event.admin_user || '-'} at {formatDate(event.created_at)}
              <div style={{ color: '#64748b' }}>{event.result}{event.detail ? `: ${event.detail}` : ''}</div>
            </div>
          )) : <p style={{ color: '#64748b' }}>No recent audit entries for this account.</p>}
        </section>
      ) : null}
    </div>
  );
}

function DeviceChecklist({
  devices,
  selected,
  onChange,
}: {
  devices: DeviceOption[];
  selected: string[];
  onChange: (deviceIds: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  }
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 10, display: 'grid', gap: 6 }}>
      {devices.length ? devices.map((device) => (
        <label key={device.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={selected.includes(device.id)} onChange={() => toggle(device.id)} />
          <span>{device.label}</span>
          <span style={{ color: '#64748b' }}>{device.id}</span>
        </label>
      )) : <span style={{ color: '#64748b' }}>No devices are registered yet.</span>}
    </div>
  );
}

function UserActions({
  user,
  devices,
  onDetails,
  onPatch,
  onReset,
  onRevoke,
  onAdminChange,
}: {
  user: AdminUser;
  devices: DeviceOption[];
  onDetails: () => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onReset: () => void;
  onRevoke: () => void;
  onAdminChange: (user: AdminUser, nextType: 'admin' | 'remote') => void;
}) {
  const editable = user.id !== 'env-admin';
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeMode, setScopeMode] = useState(user.deviceScopeMode || 'all');
  const [deviceIds, setDeviceIds] = useState(user.deviceIds || []);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 320 }}>
      <button type="button" onClick={onDetails} style={secondaryButton}>Details</button>
      <button type="button" disabled={!editable} onClick={onReset} style={secondaryButton}>Reset password</button>
      <button type="button" disabled={!editable} onClick={onRevoke} style={secondaryButton}>Revoke sessions</button>
      <button
        type="button"
        disabled={!editable}
        onClick={() => onPatch({ remoteAccessEnabled: !user.remoteAccessEnabled })}
        style={secondaryButton}
      >
        {user.remoteAccessEnabled ? 'Disable remote' : 'Enable remote'}
      </button>
      <button
        type="button"
        disabled={!editable}
        onClick={() => onPatch({ isActive: (user.status || 'active') !== 'active' })}
        style={(user.status || 'active') === 'active' ? dangerButton : secondaryButton}
      >
        {(user.status || 'active') === 'active' ? 'Disable user' : 'Enable user'}
      </button>
      <button
        type="button"
        disabled={!editable}
        onClick={() => onAdminChange(user, user.userType === 'admin' ? 'remote' : 'admin')}
        style={secondaryButton}
      >
        {user.userType === 'admin' ? 'Remove admin' : 'Make admin'}
      </button>
      <button type="button" disabled={!editable} onClick={() => setScopeOpen((open) => !open)} style={secondaryButton}>Device scope</button>
      {scopeOpen ? (
        <div style={{ flexBasis: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: 10, display: 'grid', gap: 8 }}>
          <select value={scopeMode} onChange={(event) => setScopeMode(event.target.value)} style={inputStyle}>
            <option value="all">All devices</option>
            <option value="selected">Selected devices</option>
          </select>
          {scopeMode === 'selected' ? <DeviceChecklist devices={devices} selected={deviceIds} onChange={setDeviceIds} /> : null}
          <button type="button" onClick={() => onPatch({ deviceScopeMode: scopeMode, deviceIds })} style={buttonStyle}>Save scope</button>
        </div>
      ) : null}
    </div>
  );
}

function DetailItem({ labelText, valueText }: { labelText: string; valueText: string }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 10 }}>
      <div style={{ color: '#64748b', fontSize: 12 }}>{labelText}</div>
      <strong>{valueText}</strong>
    </div>
  );
}
