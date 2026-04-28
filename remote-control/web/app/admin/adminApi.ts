import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiBaseUrl } from '../lib/api';

export async function adminFetch<T>(path: string): Promise<T> {
  const cookieStore = await cookies();
  const session = cookieStore.get('session');

  if (!session) {
    redirect('/admin');
  }

  const res = await fetch(`${apiBaseUrl()}${path}`, {
    cache: 'no-store',
    headers: {
      Cookie: `session=${session.value}`,
    },
  });

  if (res.status === 401) {
    redirect('/admin');
  }

  if (res.status === 403) {
    try {
      const body = await res.json();
      if (body.acknowledgementRequired) {
        redirect('/acknowledgement?returnTo=/admin/dashboard');
      }
    } catch {
      redirect('/acknowledgement?returnTo=/admin/dashboard');
    }
  }

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    throw new Error(`Admin request failed [${res.status} ${res.statusText}]: ${path}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }

  return res.json() as Promise<T>;
}
