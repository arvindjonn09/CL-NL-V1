import AdminNav from '../AdminNav';
import { adminFetch } from '../adminApi';
import { header, muted, page } from '../styles';
import UsersDesk from './UsersDesk';

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
  acknowledgementVersion?: string | null;
  acknowledgementAcceptedAt?: string | null;
  acknowledgementCurrentVersion?: string | null;
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

export default async function AdminUsersPage() {
  const data = await adminFetch<{
    users: AdminUser[];
    devices: DeviceOption[];
    counts: {
      total: number;
      admins: number;
      remoteAccess: number;
      disabled: number;
    };
  }>('/api/admin/users');

  return (
    <main style={page}>
      <div style={header}>
        <div>
          <h1 style={{ margin: 0 }}>Users</h1>
          <p style={muted}>Access control for admins, remote-access users, device scope, and account status.</p>
        </div>
        <AdminNav />
      </div>

      <UsersDesk initialUsers={data.users} initialDevices={data.devices} initialCounts={data.counts} />
    </main>
  );
}
