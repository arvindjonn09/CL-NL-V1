const PUBLIC_FRONTEND_HOST = 'netralink.shivomsangha.com';
const PUBLIC_API_BASE = 'https://netraapi.shivomsangha.com';
const BACKEND_PORT = '3000';

export const REMOTE_ACCESS_SESSION_TIMEOUT_MS = 2500;

type LocationLike = Pick<Location, 'protocol' | 'hostname'>;

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function configuredPublicApiBase() {
  return trimTrailingSlash(
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    PUBLIC_API_BASE
  );
}

export function isLanOrLocalHostname(hostname: string) {
  return hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

export function remoteAccessApiBaseUrl(location: LocationLike = window.location) {
  const hostname = location.hostname;

  if (isLanOrLocalHostname(hostname)) {
    return `${location.protocol}//${hostname}:${BACKEND_PORT}`;
  }

  if (hostname === PUBLIC_FRONTEND_HOST) {
    return PUBLIC_API_BASE;
  }

  return configuredPublicApiBase();
}

export function remoteAccessApiUrl(path: string, location?: LocationLike) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${remoteAccessApiBaseUrl(location)}${normalizedPath}`;
}

export function remoteAccessWsUrl(path: string, location: LocationLike = window.location) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = remoteAccessApiBaseUrl(location);
  return `${base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')}${normalizedPath}`;
}
