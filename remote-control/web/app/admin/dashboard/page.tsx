import AdminNav from '../AdminNav';
import { adminFetch } from '../adminApi';
import { card, cardGrid, header, label, muted, page, table, td, th, value } from '../styles';
import { formatDate, shortText, statusBadge } from '../../devices/statusStyles';

type Overview = {
  cards: Record<string, number>;
  recentWarnings: Array<{
    id: string;
    level: string;
    source: string;
    message: string;
    createdAt?: string | null;
    deviceId?: string | null;
  }>;
};

const cardLabels: Record<string, string> = {
  totalUsers: 'Total users',
  totalRemoteAccessUsers: 'Remote-access users',
  totalDevices: 'Total devices',
  onlineDevices: 'Online devices',
  offlineDevices: 'Offline devices',
  degradedDevices: 'Degraded devices',
  operatorAttentionDevices: 'Operator attention',
};

export default async function AdminDashboardPage() {
  const overview = await adminFetch<Overview>('/api/admin/overview');

  return (
    <main style={page}>
      <div style={header}>
        <div>
          <h1 style={{ margin: 0 }}>Admin Dashboard</h1>
          <p style={muted}>Operational overview for NetraLink administrators.</p>
        </div>
        <AdminNav />
      </div>

      <section style={cardGrid}>
        {Object.entries(cardLabels).map(([key, title]) => (
          <div key={key} style={card}>
            <div style={label}>{title}</div>
            <div style={value}>{overview.cards[key] ?? 0}</div>
          </div>
        ))}
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Recent Important Events</h2>
        {overview.recentWarnings.length === 0 ? (
          <p style={muted}>No recent health events.</p>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Level</th>
                <th style={th}>Source</th>
                <th style={th}>Device</th>
                <th style={th}>Message</th>
                <th style={th}>Time</th>
              </tr>
            </thead>
            <tbody>
              {overview.recentWarnings.map((event) => (
                <tr key={event.id}>
                  <td style={td}><span style={statusBadge(event.level)}>{event.level}</span></td>
                  <td style={td}>{event.source}</td>
                  <td style={td}>{event.deviceId || '-'}</td>
                  <td style={td}>{shortText(event.message, 180)}</td>
                  <td style={td}>{formatDate(event.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
