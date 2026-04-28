const { cookieDomain, secureCookies } = require('../config');
const { ACCESS_TOKEN_SECONDS, REFRESH_TOKEN_SECONDS } = require('./tokens');

const ACCESS_COOKIE = 'session';
const REFRESH_COOKIE = 'refresh_session';

function requestHostname(req) {
  const host = req?.get?.('x-forwarded-host') || req?.get?.('host') || '';
  return String(host).split(':')[0].toLowerCase();
}

function isLocalOrLanHost(hostname) {
  return hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function requestCookieScope(req) {
  const hostname = requestHostname(req);
  const localOrLan = isLocalOrLanHost(hostname);
  return {
    domain: localOrLan ? '' : cookieDomain,
    secure: localOrLan ? false : secureCookies,
  };
}

function cookieOptions(maxAgeSeconds, req) {
  const scope = requestCookieScope(req);
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: scope.secure,
    path: '/',
    maxAge: maxAgeSeconds * 1000,
    expires: new Date(Date.now() + maxAgeSeconds * 1000),
    ...(scope.domain ? { domain: scope.domain } : {}),
  };
}

function setAdminCookies(res, { accessToken, refreshToken }, req) {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_TOKEN_SECONDS, req));
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(REFRESH_TOKEN_SECONDS, req));
}

function clearAdminCookies(res, req) {
  const scope = requestCookieScope(req);
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure: scope.secure,
    path: '/',
    ...(scope.domain ? { domain: scope.domain } : {}),
  };
  res.clearCookie(ACCESS_COOKIE, options);
  res.clearCookie(REFRESH_COOKIE, options);
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearAdminCookies,
  cookieOptions,
  isLocalOrLanHost,
  requestCookieScope,
  setAdminCookies,
};
