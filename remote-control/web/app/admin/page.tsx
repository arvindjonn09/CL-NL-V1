'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiBaseUrl } from '../lib/api';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('admin@local');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const res = await fetch(`${apiBaseUrl()}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        let message = 'Login failed';

        try {
          const body = await res.json();
          message = body.error || message;
        } catch {
          message = `Login failed (${res.status})`;
        }

        setError(message);
        return;
      }

      const acknowledgement = await fetch(`${apiBaseUrl()}/api/auth/acknowledgement`, {
        credentials: 'include',
      });

      if (acknowledgement.ok) {
        const body = await acknowledgement.json();
        if (body.required) {
          window.location.href = '/acknowledgement?returnTo=/admin/dashboard';
          return;
        }
      }

      window.location.href = '/admin/dashboard';
    } catch {
      setError('Login request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={page}>
      <section style={panel}>
        <p style={eyebrow}>SetuLink Admin</p>
        <h1 style={title}>Admin Login</h1>
        <p style={copy}>Sign in to manage devices, users, health, and operational controls.</p>

        <form onSubmit={handleLogin} style={form}>
          <label style={label}>
            Email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
              autoComplete="email"
              style={input}
            />
          </label>

          <label style={label}>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              style={input}
            />
          </label>

          <button type="submit" disabled={busy} style={primaryButton}>
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {error && <p style={errorText}>{error}</p>}

        <div style={links}>
          <Link href="/">Public site</Link>
          <Link href="/remoteaccess">Remote access</Link>
        </div>
      </section>
    </main>
  );
}

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f8fafc',
  display: 'grid',
  placeItems: 'center',
  padding: '28px',
  fontFamily: 'Arial, sans-serif',
};

const panel: React.CSSProperties = {
  width: '100%',
  maxWidth: '420px',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  background: '#fff',
  padding: '24px',
};

const eyebrow: React.CSSProperties = {
  margin: 0,
  color: '#2563eb',
  fontWeight: 700,
  fontSize: '13px',
};

const title: React.CSSProperties = {
  margin: '8px 0 0',
};

const copy: React.CSSProperties = {
  color: '#475569',
  lineHeight: 1.5,
};

const form: React.CSSProperties = {
  display: 'grid',
  gap: '12px',
  marginTop: '18px',
};

const label: React.CSSProperties = {
  display: 'grid',
  gap: '6px',
  fontWeight: 700,
};

const input: React.CSSProperties = {
  padding: '10px',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  fontSize: '15px',
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

const errorText: React.CSSProperties = {
  color: '#b91c1c',
  marginBottom: 0,
};

const links: React.CSSProperties = {
  display: 'flex',
  gap: '14px',
  marginTop: '18px',
  fontSize: '14px',
};
