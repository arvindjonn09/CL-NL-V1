import Link from 'next/link';
import { nav } from './styles';

export default function AdminNav() {
  return (
    <nav style={nav}>
      <Link href="/admin/dashboard">Dashboard</Link>
      <Link href="/admin/users">Users</Link>
      <Link href="/admin/devices">Devices</Link>
      <Link href="/admin/health">Health</Link>
    </nav>
  );
}
