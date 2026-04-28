import Link from 'next/link';

export default function Home() {
  return (
    <main style={page}>
      <section style={hero}>
        <p style={eyebrow}>SetuLink</p>
        <h1 style={title}>Remote device operations with clear health, access, and recovery paths.</h1>
        <p style={copy}>
          SetuLink helps teams monitor connected agents, understand device health, review operational history,
          and separate admin controls from restricted remote-user access.
        </p>
        <div style={actions}>
          <Link href="/admin" style={primaryLink}>Admin Login</Link>
          <Link href="/remoteaccess" style={secondaryLink}>Remote Access</Link>
        </div>
      </section>

      <section style={grid}>
        <article style={feature}>
          <h2 style={featureTitle}>Fleet Visibility</h2>
          <p style={featureCopy}>Track online/offline state, health, recent heartbeats, command history, and file activity.</p>
        </article>
        <article style={feature}>
          <h2 style={featureTitle}>Operational Guardrails</h2>
          <p style={featureCopy}>Keep high-risk actions behind admin authentication, confirmations, and acknowledgement checks.</p>
        </article>
        <article style={feature}>
          <h2 style={featureTitle}>Restricted Access</h2>
          <p style={featureCopy}>Remote users get a separate portal with email verification and read-only device visibility.</p>
        </article>
      </section>
    </main>
  );
}

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f8fafc',
  color: '#0f172a',
  fontFamily: 'Arial, sans-serif',
};

const hero: React.CSSProperties = {
  maxWidth: '920px',
  margin: '0 auto',
  padding: '72px 24px 32px',
};

const eyebrow: React.CSSProperties = {
  margin: 0,
  color: '#2563eb',
  fontWeight: 700,
};

const title: React.CSSProperties = {
  maxWidth: '780px',
  margin: '12px 0 0',
  fontSize: '42px',
  lineHeight: 1.1,
  letterSpacing: 0,
};

const copy: React.CSSProperties = {
  maxWidth: '680px',
  color: '#475569',
  lineHeight: 1.6,
  fontSize: '17px',
};

const actions: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  flexWrap: 'wrap',
  marginTop: '24px',
};

const primaryLink: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: '6px',
  background: '#2563eb',
  color: '#fff',
  textDecoration: 'none',
  fontWeight: 700,
};

const secondaryLink: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: '6px',
  border: '1px solid #94a3b8',
  background: '#fff',
  color: '#0f172a',
  textDecoration: 'none',
  fontWeight: 700,
};

const grid: React.CSSProperties = {
  maxWidth: '920px',
  margin: '0 auto',
  padding: '8px 24px 56px',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '14px',
};

const feature: React.CSSProperties = {
  border: '1px solid #dbe3ef',
  borderRadius: '8px',
  background: '#fff',
  padding: '18px',
};

const featureTitle: React.CSSProperties = {
  marginTop: 0,
  marginBottom: '8px',
};

const featureCopy: React.CSSProperties = {
  margin: 0,
  color: '#475569',
  lineHeight: 1.5,
};
