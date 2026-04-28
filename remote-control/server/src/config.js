function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const apiPublicUrl = trimTrailingSlash(process.env.API_PUBLIC_URL || process.env.PUBLIC_API_URL || '');
const appPublicUrl = trimTrailingSlash(process.env.APP_PUBLIC_URL || process.env.PUBLIC_APP_URL || '');
const corsOrigins = splitCsv(process.env.CORS_ORIGINS || appPublicUrl || 'http://localhost:3001');
const frontendPort = String(process.env.FRONTEND_PORT || '3001');
const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
const secureCookies =
  process.env.COOKIE_SECURE === '1' ||
  process.env.COOKIE_SECURE === 'true' ||
  appPublicUrl.startsWith('https://');
const cookieDomain = process.env.COOKIE_DOMAIN || '';

const agentSharedSecret =
  process.env.AGENT_SHARED_SECRET ||
  process.env.ENROLLMENT_TOKEN ||
  'setulink-dev-agent-secret';

function publicApiUrlFromRequest(req) {
  if (apiPublicUrl) return apiPublicUrl;

  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');

  if (!host) return '';

  return `${proto}://${host}`;
}

function isLocalOrLanHostname(hostname) {
  return hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function isCorsOriginAllowed(origin) {
  if (!origin || corsOrigins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    const isFrontendPort = parsed.port === frontendPort;
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    return isHttp && isFrontendPort && isLocalOrLanHostname(parsed.hostname);
  } catch {
    return false;
  }
}

module.exports = {
  agentSharedSecret,
  apiPublicUrl,
  appPublicUrl,
  cookieDomain,
  corsOrigins,
  isCorsOriginAllowed,
  publicApiUrlFromRequest,
  secureCookies,
  trustProxy,
};
