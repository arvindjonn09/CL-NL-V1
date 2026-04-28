import React from 'react';

export function statusBadge(status: string | null | undefined): React.CSSProperties {
  const value = String(status || 'unknown').toLowerCase();
  const palette: Record<string, { bg: string; color: string; border: string }> = {
    healthy: { bg: '#dcfce7', color: '#166534', border: '#86efac' },
    success: { bg: '#dcfce7', color: '#166534', border: '#86efac' },
    completed: { bg: '#dcfce7', color: '#166534', border: '#86efac' },
    online: { bg: '#dcfce7', color: '#166534', border: '#86efac' },
    warning: { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
    degraded: { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
    stale: { bg: '#ffedd5', color: '#9a3412', border: '#fdba74' },
    recovering: { bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
    'upgrade-pending': { bg: '#ede9fe', color: '#5b21b6', border: '#c4b5fd' },
    pending: { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
    running: { bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
    offline: { bg: '#f3f4f6', color: '#374151', border: '#d1d5db' },
    failed: { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
    error: { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
    dev: { bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
    test: { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
    prod: { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
    personal: { bg: '#ede9fe', color: '#5b21b6', border: '#c4b5fd' },
    unknown: { bg: '#f3f4f6', color: '#374151', border: '#d1d5db' },
  };
  const selected = palette[value] || { bg: '#f3f4f6', color: '#374151', border: '#d1d5db' };

  return {
    display: 'inline-block',
    padding: '3px 9px',
    borderRadius: '999px',
    background: selected.bg,
    color: selected.color,
    border: `1px solid ${selected.border}`,
    fontSize: '12px',
    fontWeight: 700,
    textTransform: 'capitalize',
    whiteSpace: 'nowrap',
  };
}

export function healthLabel(status: string | null | undefined) {
  const value = String(status || 'unknown').toLowerCase();
  const labels: Record<string, string> = {
    healthy: 'Healthy',
    degraded: 'Degraded',
    offline: 'Offline',
    recovering: 'Recovery in progress',
    'upgrade-pending': 'Upgrade pending',
    warning: 'Degraded',
    stale: 'Degraded',
    error: 'Degraded',
  };
  return labels[value] || 'Degraded';
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

export function shortText(value: string | null | undefined, max = 160) {
  if (!value) return '-';
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}
