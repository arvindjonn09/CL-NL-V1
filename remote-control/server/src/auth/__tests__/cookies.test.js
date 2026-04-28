const assert = require('node:assert/strict');
const test = require('node:test');
const { clearAdminCookies, requestCookieScope, setAdminCookies } = require('../cookies');
const { remoteCookieOptions } = require('../../remoteAccess/session');

function reqForHost(host) {
  return {
    get(name) {
      if (name === 'host') return host;
      return '';
    },
  };
}

test('setAdminCookies uses secure session cookie options', () => {
  const cookies = [];
  const res = {
    cookie(name, value, options) {
      cookies.push({ name, value, options });
    },
  };

  setAdminCookies(res, {
    accessToken: 'access',
    refreshToken: 'refresh',
  }, reqForHost('netraapi.shivomsangha.com'));

  assert.equal(cookies.length, 2);
  assert.deepEqual(cookies.map((cookie) => cookie.name), ['session', 'refresh_session']);
  for (const cookie of cookies) {
    assert.equal(cookie.options.httpOnly, true);
    assert.equal(cookie.options.sameSite, 'lax');
    assert.equal(cookie.options.path, '/');
    assert.ok(cookie.options.expires instanceof Date);
    assert.ok(cookie.options.maxAge > 0);
  }
});

test('setAdminCookies uses host-only non-secure cookies for LAN access', () => {
  const cookies = [];
  const res = {
    cookie(name, value, options) {
      cookies.push({ name, value, options });
    },
  };

  setAdminCookies(res, {
    accessToken: 'access',
    refreshToken: 'refresh',
  }, reqForHost('192.168.68.100:3000'));

  assert.equal(cookies.length, 2);
  for (const cookie of cookies) {
    assert.equal(cookie.options.secure, false);
    assert.equal(cookie.options.domain, undefined);
  }
});

test('requestCookieScope detects localhost and LAN hosts', () => {
  assert.deepEqual(requestCookieScope(reqForHost('localhost:3000')), {
    domain: '',
    secure: false,
  });
  assert.deepEqual(requestCookieScope(reqForHost('192.168.68.100:3000')), {
    domain: '',
    secure: false,
  });
});

test('remote access cookies use host-only non-secure options for LAN access', () => {
  const options = remoteCookieOptions(60, reqForHost('192.168.68.100:3000'));

  assert.equal(options.secure, false);
  assert.equal(options.domain, undefined);
  assert.equal(options.sameSite, 'lax');
  assert.equal(options.path, '/');
});

test('clearAdminCookies clears both admin cookies', () => {
  const cleared = [];
  const res = {
    clearCookie(name, options) {
      cleared.push({ name, options });
    },
  };

  clearAdminCookies(res);

  assert.deepEqual(cleared.map((cookie) => cookie.name), ['session', 'refresh_session']);
});
