import React from 'react';

export const page: React.CSSProperties = {
  padding: '24px',
  fontFamily: 'Arial, sans-serif',
};

export const header: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '16px',
  alignItems: 'flex-start',
  marginBottom: '18px',
};

export const nav: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
};

export const cardGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '12px',
  marginBottom: '14px',
};

export const card: React.CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  background: '#fff',
  padding: '14px',
};

export const label: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '13px',
};

export const value: React.CSSProperties = {
  fontSize: '28px',
  fontWeight: 700,
  marginTop: '6px',
};

export const table: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
};

export const th: React.CSSProperties = {
  border: '1px solid #d1d5db',
  padding: '8px',
  background: '#f9fafb',
  textAlign: 'left',
  fontSize: '13px',
};

export const td: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  padding: '8px',
  verticalAlign: 'top',
  fontSize: '13px',
};

export const muted: React.CSSProperties = {
  color: '#6b7280',
};
