'use client';

import { useEffect, useState } from 'react';
import { apiBaseUrl } from '../lib/api';

type Status = {
  required: boolean;
  currentVersion: string;
  acceptedVersion?: string | null;
};

export default function AcknowledgementPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      const res = await fetch(`${apiBaseUrl()}/api/auth/acknowledgement`, {
        credentials: 'include',
      });

      if (res.status === 401) {
        window.location.href = '/admin';
        return;
      }

      if (!res.ok) {
        setMessage('Unable to load acknowledgement status.');
        return;
      }

      const body = await res.json();
      if (!cancelled) {
        setStatus(body);
      }
    }

    loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  async function accept() {
    if (!status || !checked) return;

    setSaving(true);
    setMessage('Saving acknowledgement...');

    try {
      const res = await fetch(`${apiBaseUrl()}/api/auth/acknowledgement`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accepted: true,
          version: status.currentVersion,
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        setMessage(body.error || 'Acknowledgement failed');
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const returnTo = params.get('returnTo');
      window.location.href = returnTo && returnTo.startsWith('/') ? returnTo : '/admin/dashboard';
    } catch {
      setMessage('Request failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main style={main}>
      <h1 style={{ marginTop: 0 }}>Operator safety acknowledgement</h1>
      <p style={copy}>
        NetraLink admin access can execute commands on devices, transfer files, restart services, and apply upgrades.
      </p>
      <p style={copy}>
        Operators are responsible for using actions carefully. High-risk actions require action-time confirmation.
      </p>
      <p style={copy}>
        Review the runbook docs when unsure: <a href="/docs/runbook/README.md">docs/runbook/README.md</a>
      </p>

      <label style={checkboxRow}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
        I understand these responsibilities and will use admin actions carefully.
      </label>

      <button
        type="button"
        disabled={!checked || saving || !status}
        onClick={accept}
        style={{
          ...button,
          opacity: checked && !saving && status ? 1 : 0.55,
          cursor: checked && !saving && status ? 'pointer' : 'not-allowed',
        }}
      >
        {saving ? 'Saving...' : 'Accept and continue'}
      </button>

      {message && <p style={{ color: '#374151' }}>{message}</p>}
      {status && !status.required && (
        <p style={{ color: '#166534' }}>Current acknowledgement is already accepted.</p>
      )}
    </main>
  );
}

const main: React.CSSProperties = {
  maxWidth: '560px',
  margin: '48px auto',
  padding: '24px',
  fontFamily: 'Arial, sans-serif',
};

const copy: React.CSSProperties = {
  color: '#374151',
  lineHeight: 1.5,
};

const checkboxRow: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  alignItems: 'flex-start',
  marginTop: '18px',
  marginBottom: '18px',
  color: '#111827',
};

const button: React.CSSProperties = {
  padding: '9px 13px',
  border: '1px solid #2563eb',
  borderRadius: '6px',
  background: '#2563eb',
  color: '#fff',
};
