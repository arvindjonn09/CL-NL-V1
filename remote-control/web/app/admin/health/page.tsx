import AdminNav from '../AdminNav';
import { adminFetch } from '../adminApi';
import { card, cardGrid, header, label, muted, page, value } from '../styles';
import { statusBadge } from '../../devices/statusStyles';

type Check = {
  ok: boolean;
  url?: string;
  status?: number | null;
  reason?: string | null;
};

type AdminHealth = {
  frontend: {
    local: Check;
    public: Check;
  };
  backend: {
    local: Check;
    public: Check;
  };
  database: {
    ok: boolean;
    reason?: string | null;
  };
  cloudflare: {
    backendPublic: Check;
    frontendPublic: Check;
  };
  backup: {
    ok: boolean | null;
    status: string;
    reason: string;
  };
  fleet: Record<string, number>;
};

function CheckCard({ title, check }: { title: string; check: Check }) {
  return (
    <div style={card}>
      <div style={label}>{title}</div>
      <div style={{ marginTop: '8px' }}>
        <span style={statusBadge(check.ok ? 'healthy' : 'failed')}>{check.ok ? 'OK' : 'FAIL'}</span>
      </div>
      <p style={muted}>{check.url || '-'}</p>
      <p style={muted}>{check.status ? `HTTP ${check.status}` : check.reason || 'No detail'}</p>
    </div>
  );
}

export default async function AdminHealthPage() {
  const health = await adminFetch<AdminHealth>('/api/admin/health');

  return (
    <main style={page}>
      <div style={header}>
        <div>
          <h1 style={{ margin: 0 }}>System Health</h1>
          <p style={muted}>Application, public reachability, and fleet health checks.</p>
        </div>
        <AdminNav />
      </div>

      <section style={cardGrid}>
        <CheckCard title="Frontend local" check={health.frontend.local} />
        <CheckCard title="Backend/API local" check={health.backend.local} />
        <CheckCard title="Frontend public" check={health.frontend.public} />
        <CheckCard title="Backend public" check={health.backend.public} />
      </section>

      <section style={cardGrid}>
        <div style={card}>
          <div style={label}>Database</div>
          <div style={{ marginTop: '8px' }}>
            <span style={statusBadge(health.database.ok ? 'healthy' : 'failed')}>{health.database.ok ? 'OK' : 'FAIL'}</span>
          </div>
          <p style={muted}>{health.database.reason || 'SELECT 1 succeeded'}</p>
        </div>

        <div style={card}>
          <div style={label}>Backup status</div>
          <div style={value}>{health.backup.status}</div>
          <p style={muted}>{health.backup.reason}</p>
        </div>
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Device Fleet Summary</h2>
        <div style={cardGrid}>
          {Object.entries(health.fleet).map(([key, count]) => (
            <div key={key} style={card}>
              <div style={label}>{key}</div>
              <div style={value}>{count}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
