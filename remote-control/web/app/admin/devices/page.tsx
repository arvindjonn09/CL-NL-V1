import Link from 'next/link';
import AdminNav from '../AdminNav';
import { adminFetch } from '../adminApi';
import { card, header, muted, page, table, td, th } from '../styles';
import { formatDate, healthLabel, statusBadge } from '../../devices/statusStyles';

type DeviceSummary = {
  id: string;
  hostname?: string | null;
  displayName?: string | null;
  environmentLabel?: string | null;
  username?: string | null;
  os?: string | null;
  status: string;
  healthStatus: string;
  healthLabel?: string | null;
  runMode?: string | null;
  agentVersion?: string | null;
  lastSeen?: string | null;
  heartbeatAgeSeconds?: number | null;
  lastCommandActivity?: string | null;
  lastFileActivity?: string | null;
};

export default async function AdminDevicesPage() {
  const devices = await adminFetch<DeviceSummary[]>('/api/devices/summary');

  return (
    <main style={page}>
      <div style={header}>
        <div>
          <h1 style={{ margin: 0 }}>Devices</h1>
          <p style={muted}>Full admin fleet table with links into existing device detail views.</p>
        </div>
        <AdminNav />
      </div>

      <section style={card}>
        {devices.length === 0 ? (
          <p style={muted}>No devices found.</p>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Hostname</th>
                <th style={th}>Environment</th>
                <th style={th}>User</th>
                <th style={th}>OS</th>
                <th style={th}>Status</th>
                <th style={th}>Health</th>
                <th style={th}>Run mode</th>
                <th style={th}>Agent</th>
                <th style={th}>Last seen</th>
                <th style={th}>Latest activity</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id}>
                  <td style={td}>
                    <Link href={`/devices/${device.id}`}>{device.displayName || device.hostname || device.id}</Link>
                    <div style={muted}>{device.hostname || '-'}</div>
                  </td>
                  <td style={td}>{device.environmentLabel || 'unknown'}</td>
                  <td style={td}>{device.username || '-'}</td>
                  <td style={td}>{device.os || '-'}</td>
                  <td style={td}><span style={statusBadge(device.status)}>{device.status}</span></td>
                  <td style={td}><span style={statusBadge(device.healthStatus)}>{device.healthLabel || healthLabel(device.healthStatus)}</span></td>
                  <td style={td}>{device.runMode || '-'}</td>
                  <td style={td}>{device.agentVersion || '-'}</td>
                  <td style={td}>
                    <div>{formatDate(device.lastSeen)}</div>
                    <div style={muted}>{device.heartbeatAgeSeconds ?? '-'}s old</div>
                  </td>
                  <td style={td}>
                    <div>Command: {formatDate(device.lastCommandActivity)}</div>
                    <div>File: {formatDate(device.lastFileActivity)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
