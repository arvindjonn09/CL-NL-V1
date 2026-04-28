function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function publicApiUrl() {
  return process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || '';
}

function isLocalHost(hostname: string) {
  return hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

export function apiBaseUrl() {
  if (typeof window !== 'undefined') {
    if (isLocalHost(window.location.hostname)) {
      return trimTrailingSlash(publicApiUrl()) || `${window.location.protocol}//${window.location.hostname}:3000`;
    }
    return trimTrailingSlash(publicApiUrl());
  }

  return (
    process.env.API_INTERNAL_URL ||
    process.env.API_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
}

export function websocketBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_WS_BASE_URL || publicApiUrl();

  if (configured) {
    return configured.replace(/^http/, 'ws').replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined') {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${window.location.host}`;
  }

  return 'ws://localhost:3000';
}
