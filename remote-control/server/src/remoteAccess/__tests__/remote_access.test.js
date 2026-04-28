const assert = require('node:assert/strict');
const test = require('node:test');
const { createAuthMiddleware } = require('../../auth/middleware');
const { createRemoteUserStore } = require('../config');
const {
  getRemoteAccessDashboard,
  getRemoteAccessDeviceDetail,
} = require('../dashboard');
const {
  createRemoteSessionGrant,
  remoteUserAllowed,
  validateRemoteSessionGrant,
} = require('../grants');
const { registerRemoteAccessRoutes } = require('../handlers');
const {
  createRemoteAccessSession,
  remoteAccessMiddleware,
  setRemoteAccessCookie,
} = require('../session');
const {
  canResend,
  issueVerificationCode,
  verifyCode,
} = require('../verification');
const { registerRemoteDesktopRoutes } = require('../../remoteDesktop/handlers');
const {
  createRemoteDesktopSession,
  setRemoteDesktopStatus,
  getRemoteDesktopSessionForUser,
} = require('../../remoteDesktop/sessions');

function createPool() {
  const codes = [];
  const sessions = [];
  return {
    codes,
    sessions,
    async query(sql, params) {
      if (sql.includes('UPDATE remote_access_verification_codes') && sql.includes('WHERE email = $1')) {
        for (const code of codes) {
          if (code.email === params[0] && code.id !== params[1] && !code.consumed_at) code.consumed_at = new Date();
        }
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('INSERT INTO remote_access_verification_codes')) {
        codes.push({
          id: params[0],
          email: params[1],
          code_hash: params[2],
          issued_at: new Date(),
          expires_at: new Date(Date.now() + Number(params[3]) * 1000),
          consumed_at: null,
          attempts: 0,
          resend_available_at: new Date(Date.now() + Number(params[4]) * 1000),
        });
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('DELETE FROM remote_access_verification_codes')) {
        const index = codes.findIndex((code) => code.id === params[0] && !code.consumed_at);
        if (index >= 0) {
          codes.splice(index, 1);
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      }

      if (sql.includes('FROM remote_access_verification_codes') && sql.includes('WHERE id = $1')) {
        const found = codes.find((code) => code.id === params[0]);
        return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
      }

      if (sql.includes('SET attempts = attempts + 1')) {
        const found = codes.find((code) => code.id === params[0]);
        if (found) found.attempts += 1;
        return { rowCount: found ? 1 : 0, rows: [] };
      }

      if (sql.includes('SET consumed_at = NOW()') && sql.includes('WHERE id = $1')) {
        const found = codes.find((code) => code.id === params[0]);
        if (found) found.consumed_at = new Date();
        return { rowCount: found ? 1 : 0, rows: [] };
      }

      if (sql.includes('INSERT INTO remote_access_sessions')) {
        sessions.push({
          id: params[0],
          email: params[1],
          expires_at: new Date(Date.now() + Number(params[2]) * 1000),
          revoked_at: null,
        });
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('FROM remote_access_sessions') && sql.includes('WHERE id = $1')) {
        const found = sessions.find((session) =>
          session.id === params[0] &&
          !session.revoked_at &&
          session.expires_at > new Date()
        );
        return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
      }

      if (sql.includes('UPDATE remote_access_sessions')) {
        const found = sessions.find((session) => session.id === params[0]);
        if (found) found.revoked_at = new Date();
        return { rowCount: found ? 1 : 0, rows: [] };
      }

      if (sql.includes('FROM admin_sessions')) {
        return { rowCount: 0, rows: [] };
      }

      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

function createRemoteDataPool() {
  const now = new Date();
  const devices = [
    {
      id: 'device-1',
      hostname: 'allowed-host',
      os: 'Windows',
      status: 'online',
      last_seen: now,
      created_at: now,
      display_name: 'Allowed Device',
      username: 'remote-user',
      run_mode: 'service',
      agent_version: '1.2.3',
      environment_label: 'prod',
      remote_desktop_capability: {
        state: 'ready',
        screenCapture: 'ready',
        input: 'ready',
        reason: 'Windows ffmpeg gdigrab capture and WebRTC runtime ready',
      },
    },
    {
      id: 'device-2',
      hostname: 'blocked-host',
      os: 'Linux',
      status: 'online',
      last_seen: now,
      created_at: now,
      display_name: 'Blocked Device',
      username: 'other-user',
      run_mode: 'service',
      agent_version: '1.2.4',
      environment_label: 'test',
    },
  ];
  const commands = [
    {
      command_id: 'command-1',
      id: 'command-1',
      device_id: 'device-1',
      command: 'whoami',
      status: 'completed',
      command_created_at: now,
      created_at: now,
      completed_at: now,
      exit_code: 0,
    },
    {
      command_id: 'command-2',
      id: 'command-2',
      device_id: 'device-2',
      command: 'hostname',
      status: 'completed',
      command_created_at: now,
      created_at: now,
      completed_at: now,
      exit_code: 0,
    },
  ];
  const heartbeats = [
    {
      id: 'heartbeat-1',
      device_id: 'device-1',
      run_mode: 'service',
      agent_version: '1.2.3',
      process_id: 123,
      created_at: now,
    },
  ];
  const sessions = [];
  const grants = [];
  const desktopSessions = [];
  const audits = [];

  return {
    devices,
    sessions,
    grants,
    desktopSessions,
    audits,
    async query(sql, params = []) {
      if (sql.includes('INSERT INTO admin_audit_logs')) {
        audits.push({
          id: params[0],
          admin_user: params[1],
          action: params[2],
          target_type: params[3],
          target_id: params[4],
          result: params[7],
          detail: params[8],
          created_at: now,
        });
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('INSERT INTO remote_access_sessions')) {
        sessions.push({
          id: params[0],
          email: params[1],
          expires_at: new Date(Date.now() + Number(params[2]) * 1000),
          revoked_at: null,
        });
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('FROM remote_access_sessions') && sql.includes('WHERE id = $1')) {
        const found = sessions.find((session) =>
          session.id === params[0] &&
          !session.revoked_at &&
          session.expires_at > new Date()
        );
        return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
      }

      if (sql.includes('INSERT INTO remote_access_session_grants')) {
        const grant = {
          id: params[0],
          remote_user_identity: params[1],
          device_id: params[2],
          token_hash: params[3],
          status: params[4],
          created_at: now,
          expires_at: new Date(Date.now() + Number(params[5]) * 1000),
          started_at: null,
          ended_at: null,
          failure_reason: null,
        };
        grants.push(grant);
        return { rowCount: 1, rows: [grant] };
      }

      if (sql.includes('FROM remote_access_session_grants') && sql.includes('WHERE token_hash = $1')) {
        const found = grants.find((grant) => grant.token_hash === params[0] && grant.device_id === params[1]);
        return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
      }

      if (sql.includes("SET status = 'expired'") && sql.includes('remote_access_session_grants')) {
        const found = grants.find((grant) => grant.id === params[0]);
        if (found) {
          found.status = 'expired';
          found.failure_reason = found.failure_reason || 'grant expired';
        }
        return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
      }

      if (sql.includes("SET status = 'started'")) {
        const found = grants.find((grant) => grant.id === params[0] && grant.status === 'granted' && grant.expires_at > new Date());
        if (found) {
          found.status = 'started';
          found.started_at = found.started_at || now;
        }
        return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
      }

      if (sql.includes('INSERT INTO remote_desktop_sessions')) {
        const session = {
          id: params[0],
          grant_id: params[1],
          remote_user_identity: params[2],
          device_id: params[3],
          session_type: 'remote_desktop',
          status: 'waiting_for_agent',
          signaling_state: 'waiting_for_agent',
          transport_state: 'waiting_for_agent',
          browser_offer: null,
          agent_answer: null,
          browser_ice: [],
          agent_ice: [],
          created_at: now,
          expires_at: new Date(Date.now() + Number(params[4]) * 1000),
          started_at: null,
          ended_at: null,
          failure_reason: null,
          updated_at: now,
        };
        desktopSessions.push(session);
        return { rowCount: 1, rows: [session] };
      }

      if (sql.includes('FROM remote_desktop_sessions') && sql.includes('WHERE id = $1') && sql.includes('remote_user_identity = $2')) {
        const rows = desktopSessions.filter((session) =>
          session.id === params[0] &&
          session.remote_user_identity === params[1]
        );
        return { rowCount: rows.length, rows };
      }

      if (sql.includes('FROM remote_desktop_sessions') && sql.includes('WHERE id = $1') && sql.includes('device_id = $2')) {
        const rows = desktopSessions.filter((session) =>
          session.id === params[0] &&
          session.device_id === params[1]
        );
        return { rowCount: rows.length, rows };
      }

      if (sql.includes('FROM remote_desktop_sessions') && sql.includes('remote_user_identity = $2') && sql.includes('ORDER BY created_at DESC')) {
        const rows = desktopSessions
          .filter((session) => session.device_id === params[0] && session.remote_user_identity === params[1])
          .slice(0, 5);
        return { rowCount: rows.length, rows };
      }

      if (sql.includes('FROM remote_desktop_sessions') && sql.includes("status IN ('waiting_for_agent', 'signaling', 'media_starting')")) {
        const rows = desktopSessions
          .filter((session) => session.device_id === params[0] && ['waiting_for_agent', 'signaling', 'media_starting'].includes(session.status) && session.expires_at > new Date())
          .slice(0, params[1] || 5);
        return { rowCount: rows.length, rows };
      }

      if (sql.includes('UPDATE remote_desktop_sessions') && sql.includes('browser_offer')) {
        const found = desktopSessions.find((session) => session.id === params[0] && ['waiting_for_agent', 'signaling', 'media_starting'].includes(session.status) && session.expires_at > new Date());
        if (found) {
          found.browser_offer = JSON.parse(params[1]);
          found.status = 'waiting_for_agent';
          found.signaling_state = 'offer-received';
          found.transport_state = 'waiting_for_agent';
          found.updated_at = now;
        }
        return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
      }

      if (sql.includes('UPDATE remote_desktop_sessions') && sql.includes('agent_answer')) {
        const found = desktopSessions.find((session) => session.id === params[0] && ['waiting_for_agent', 'signaling', 'media_starting'].includes(session.status) && session.expires_at > new Date());
        if (found) {
          found.agent_answer = JSON.parse(params[1]);
          found.status = 'media_starting';
          found.signaling_state = 'answer-received';
          found.transport_state = 'media_starting';
          found.updated_at = now;
        }
        return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
      }

      if (sql.includes('UPDATE remote_desktop_sessions') && (sql.includes('browser_ice') || sql.includes('agent_ice'))) {
        const found = desktopSessions.find((session) => session.id === params[0] && ['waiting_for_agent', 'signaling', 'media_starting', 'connected'].includes(session.status) && session.expires_at > new Date());
        if (found) {
          const column = sql.includes('agent_ice') ? 'agent_ice' : 'browser_ice';
          found[column] = [...(found[column] || []), ...JSON.parse(params[1])];
          found.signaling_state = found.signaling_state === 'requested' ? found.signaling_state : 'ice-exchange';
          found.updated_at = now;
        }
        return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
      }

      if (sql.includes('UPDATE remote_desktop_sessions') && sql.includes('transport_state = $2')) {
        const found = desktopSessions.find((session) => session.id === params[0]);
        if (found) {
          found.status = params[1];
          found.transport_state = params[1];
          if (params[1] === 'connected') found.started_at = found.started_at || now;
          if (['ended', 'expired', 'failed', 'denied'].includes(params[1])) found.ended_at = found.ended_at || now;
          if (['failed', 'denied'].includes(params[1])) found.failure_reason = params[2];
          found.updated_at = now;
        }
        return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
      }

      if (sql.includes('UPDATE remote_desktop_sessions') && sql.includes("SET status = 'expired'")) {
        const found = desktopSessions.find((session) => session.id === params[0]);
        if (found) {
          found.status = 'expired';
          found.transport_state = 'expired';
          found.signaling_state = 'expired';
          found.failure_reason = found.failure_reason || params[1];
        }
        return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
      }

      if (sql.includes('FROM devices d')) {
        if (sql.includes('WHERE FALSE')) return { rowCount: 0, rows: [] };
        let rows = devices;
        if (Array.isArray(params[0])) {
          rows = rows.filter((device) => params[0].includes(device.id));
        } else if (typeof params[0] === 'string') {
          rows = rows.filter((device) => device.id === params[0]);
          if (Array.isArray(params[1])) {
            rows = rows.filter((device) => params[1].includes(device.id));
          }
        }
        return { rowCount: rows.length, rows };
      }

      if (sql.includes('FROM commands c')) {
        if (sql.includes('WHERE FALSE')) return { rowCount: 0, rows: [] };
        let rows = commands;
        if (Array.isArray(params[0])) {
          rows = rows.filter((command) => params[0].includes(command.device_id));
        } else if (typeof params[0] === 'string') {
          rows = rows.filter((command) => command.device_id === params[0]);
        }
        const requestedLimit = Number(params[params.length - 1]);
        const limit = Number.isFinite(requestedLimit) ? requestedLimit : rows.length;
        rows = rows.slice(0, limit).map((command) => ({
          command_id: command.id,
          device_id: command.device_id,
          command: command.command,
          status: command.status,
          command_created_at: command.created_at,
          completed_at: command.completed_at,
          exit_code: command.exit_code,
        }));
        return { rowCount: rows.length, rows };
      }

      if (sql.includes('FROM device_heartbeats')) {
        const rows = heartbeats.filter((heartbeat) => heartbeat.device_id === params[0]);
        return { rowCount: rows.length, rows };
      }

      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

function createReq(body = {}) {
  return {
    body,
    cookies: {},
    path: '/api/remoteaccess/dashboard',
    ip: '127.0.0.1',
    get() {
      return 'test-agent';
    },
  };
}

function createRes() {
  return {
    statusCode: 200,
    body: null,
    cookies: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    cookie(name, value, options) {
      this.cookies.push({ name, value, options });
    },
    clearCookie() {},
  };
}

function createApp() {
  const routes = {};
  return {
    routes,
    post(path, ...handlers) {
      routes[`POST ${path}`] = handlers;
    },
    get(path, ...handlers) {
      routes[`GET ${path}`] = handlers;
    },
  };
}

async function runHandlers(handlers, req, res) {
  let index = 0;
  async function next() {
    const handler = handlers[index++];
    if (handler) await handler(req, res, next);
  }
  await next();
}

test('correct remote password triggers verification code send', async () => {
  const pool = createPool();
  const userStore = createRemoteUserStore([{ email: 'user@example.com', password: 'secret' }]);
  const user = await userStore.verifyCredentials('user@example.com', 'secret');
  const sent = [];

  const challenge = await issueVerificationCode(pool, user, createReq(), {
    codeGenerator: () => '1234',
    emailSender: async (_pool, message) => sent.push(message),
  });

  assert.equal(challenge.email, 'user@example.com');
  assert.equal(pool.codes.length, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].code, '1234');
});

test('wrong remote password is denied', async () => {
  const userStore = createRemoteUserStore([{ email: 'user@example.com', password: 'secret' }]);
  assert.equal(await userStore.verifyCredentials('user@example.com', 'wrong'), null);
});

test('wrong and expired verification codes are denied', async () => {
  const pool = createPool();
  const user = { email: 'user@example.com' };
  const challenge = await issueVerificationCode(pool, user, createReq(), {
    codeGenerator: () => '1234',
    emailSender: async () => {},
  });

  const wrong = await verifyCode(pool, challenge.challengeId, '9999');
  assert.equal(wrong.ok, false);
  assert.equal(pool.codes[0].attempts, 1);

  pool.codes[0].expires_at = new Date(Date.now() - 1_000);
  const expired = await verifyCode(pool, challenge.challengeId, '1234');
  assert.equal(expired.ok, false);
});

test('correct verification code grants a remote access session', async () => {
  const pool = createPool();
  const userStore = createRemoteUserStore([{ email: 'user@example.com', password: 'secret' }]);
  const user = userStore.getUser('user@example.com');
  const challenge = await issueVerificationCode(pool, user, createReq(), {
    codeGenerator: () => '1234',
    emailSender: async () => {},
  });

  const verified = await verifyCode(pool, challenge.challengeId, '1234');
  assert.equal(verified.ok, true);

  const req = createReq();
  const res = createRes();
  const session = await createRemoteAccessSession(pool, verified.email, req);
  setRemoteAccessCookie(res, session);
  req.cookies.remote_access_session = res.cookies[0].value;

  let nextCalled = false;
  await remoteAccessMiddleware(pool, userStore, req, createRes(), () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test('resend flow respects cooldown and invalidates older codes after resend', async () => {
  const pool = createPool();
  const user = { email: 'user@example.com' };
  const first = await issueVerificationCode(pool, user, createReq(), {
    codeGenerator: () => '1234',
    emailSender: async () => {},
  });

  const tooSoon = await canResend(pool, first.challengeId);
  assert.equal(tooSoon.ok, false);
  assert.equal(tooSoon.statusCode, 429);

  pool.codes[0].resend_available_at = new Date(Date.now() - 1_000);
  const allowed = await canResend(pool, first.challengeId);
  assert.equal(allowed.ok, true);

  await issueVerificationCode(pool, user, createReq(), {
    codeGenerator: () => '5678',
    emailSender: async () => {},
  });
  assert.ok(pool.codes[0].consumed_at);
  assert.equal(pool.codes.length, 2);
});

test('failed verification email delivery does not invalidate existing code', async () => {
  const pool = createPool();
  const user = { email: 'user@example.com' };
  const first = await issueVerificationCode(pool, user, createReq(), {
    codeGenerator: () => '1234',
    emailSender: async () => {},
  });

  pool.codes[0].resend_available_at = new Date(Date.now() - 1_000);
  await assert.rejects(
    issueVerificationCode(pool, user, createReq(), {
      codeGenerator: () => '5678',
      emailSender: async () => {
        throw new Error('smtp unavailable');
      },
    }),
    /smtp unavailable/
  );

  assert.equal(pool.codes.length, 1);
  assert.equal(pool.codes[0].id, first.challengeId);
  assert.equal(pool.codes[0].consumed_at, null);
  assert.equal((await verifyCode(pool, first.challengeId, '1234')).ok, true);
});

test('remote access users are denied from admin-only middleware', async () => {
  const pool = createPool();
  const userStore = createRemoteUserStore([{ email: 'user@example.com', password: 'secret' }]);
  const session = await createRemoteAccessSession(pool, 'user@example.com', createReq());
  const adminMiddleware = createAuthMiddleware(pool);
  const req = createReq();
  const res = createRes();
  req.path = '/api/devices/device-1/actions';
  req.cookies.remote_access_session = session.accessToken;

  let nextCalled = false;
  await adminMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);

  const remoteReq = createReq();
  remoteReq.cookies.remote_access_session = session.accessToken;
  let remoteNext = false;
  await remoteAccessMiddleware(pool, userStore, remoteReq, createRes(), () => {
    remoteNext = true;
  });
  assert.equal(remoteNext, true);
});

test('allowed remote user can open allowed device detail', async () => {
  const detail = await getRemoteAccessDeviceDetail(
    createRemoteDataPool(),
    { email: 'user@example.com', deviceScopeMode: 'selected', deviceIds: ['device-1'] },
    'device-1'
  );

  assert.equal(detail.device.id, 'device-1');
  assert.equal(detail.device.hostname, 'allowed-host');
  assert.equal(detail.recentCommands.length, 1);
  assert.equal(detail.remoteConnect.available, false);
});

test('allowed remote user can request unattended session for allowed online device', async () => {
  const pool = createRemoteDataPool();
  const userStore = createRemoteUserStore([{
    email: 'user@example.com',
    password: 'secret',
    deviceScopeMode: 'selected',
    deviceIds: ['device-1'],
  }]);
  const session = await createRemoteAccessSession(pool, 'user@example.com', createReq());
  const app = createApp();
  registerRemoteAccessRoutes(app, {
    pool,
    userStore,
    getConnectedAgent: () => ({ readyState: 1 }),
  });

  const req = createReq();
  req.params = { id: 'device-1' };
  req.cookies.remote_access_session = session.accessToken;
  const res = createRes();
  await runHandlers(app.routes['POST /api/remoteaccess/devices/:id/connect'], req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.session.deviceId, 'device-1');
  assert.equal(res.body.desktopSession.deviceId, 'device-1');
  assert.equal(res.body.desktopSession.status, 'waiting_for_agent');
  assert.equal(res.body.remoteDesktop.available, true);
  assert.equal(typeof res.body.session.token, 'string');
  assert.equal(pool.grants.length, 1);
  assert.equal(pool.desktopSessions.length, 1);
  assert.equal(pool.grants[0].remote_user_identity, 'user@example.com');
  assert.equal(pool.grants[0].device_id, 'device-1');
  assert.ok(!pool.audits.some((entry) => String(entry.detail || '').includes(res.body.session.token)));
});

test('remote desktop connect is blocked when agent capture runtime is not ready', async () => {
  const pool = createRemoteDataPool();
  pool.devices[0].remote_desktop_capability = {
    state: 'not_ready',
    screenCapture: 'not_ready',
    input: 'ready',
    reason: 'active console user token lookup failed: access denied',
  };
  const userStore = createRemoteUserStore([{
    email: 'user@example.com',
    password: 'secret',
    deviceScopeMode: 'selected',
    deviceIds: ['device-1'],
  }]);
  const session = await createRemoteAccessSession(pool, 'user@example.com', createReq());
  const app = createApp();
  registerRemoteAccessRoutes(app, {
    pool,
    userStore,
    getConnectedAgent: () => ({ readyState: 1 }),
  });

  const req = createReq();
  req.params = { id: 'device-1' };
  req.cookies.remote_access_session = session.accessToken;
  const res = createRes();
  await runHandlers(app.routes['POST /api/remoteaccess/devices/:id/connect'], req, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.state, 'not_ready');
  assert.equal(res.body.reason, 'signaling-ready-runtime-not-ready');
  assert.equal(pool.grants.length, 0);
  assert.equal(pool.desktopSessions.length, 0);
});

test('remote desktop signaling accepts browser offer and agent answer for authorized session', async () => {
  const pool = createRemoteDataPool();
  const userStore = createRemoteUserStore([{
    email: 'user@example.com',
    password: 'secret',
    deviceScopeMode: 'selected',
    deviceIds: ['device-1'],
  }]);
  const session = await createRemoteAccessSession(pool, 'user@example.com', createReq());
  const app = createApp();
  registerRemoteAccessRoutes(app, {
    pool,
    userStore,
    getConnectedAgent: () => ({ readyState: 1 }),
  });
  registerRemoteDesktopRoutes(app, {
    pool,
    userStore,
    agentAuthMiddleware: (_req, _res, next) => next(),
  });

  const connectReq = createReq();
  connectReq.params = { id: 'device-1' };
  connectReq.cookies.remote_access_session = session.accessToken;
  const connectRes = createRes();
  await runHandlers(app.routes['POST /api/remoteaccess/devices/:id/connect'], connectReq, connectRes);
  const desktopSessionId = connectRes.body.desktopSession.id;

  const offerReq = createReq({ offer: { type: 'offer', sdp: 'v=0' } });
  offerReq.params = { id: desktopSessionId };
  offerReq.cookies.remote_access_session = session.accessToken;
  const offerRes = createRes();
  await runHandlers(app.routes['POST /api/remoteaccess/desktop/sessions/:id/offer'], offerReq, offerRes);

  assert.equal(offerRes.statusCode, 200);
  assert.equal(offerRes.body.session.status, 'waiting_for_agent');
  assert.equal(pool.desktopSessions[0].browser_offer.type, 'offer');

  const answerReq = createReq({ deviceId: 'device-1', answer: { type: 'answer', sdp: 'v=0' } });
  answerReq.params = { id: desktopSessionId };
  const answerRes = createRes();
  await runHandlers(app.routes['POST /api/agent/remote-desktop/sessions/:id/answer'], answerReq, answerRes);

  assert.equal(answerRes.statusCode, 200);
  assert.equal(answerRes.body.session.status, 'media_starting');
  assert.equal(pool.desktopSessions[0].agent_answer.type, 'answer');
});

test('invalid remote desktop signaling attempts are denied', async () => {
  const pool = createRemoteDataPool();
  const userStore = createRemoteUserStore([{
    email: 'user@example.com',
    password: 'secret',
    deviceScopeMode: 'selected',
    deviceIds: ['device-1'],
  }]);
  const session = await createRemoteAccessSession(pool, 'user@example.com', createReq());
  const app = createApp();
  registerRemoteDesktopRoutes(app, { pool, userStore });

  const req = createReq({ offer: { type: 'offer', sdp: 'v=0' } });
  req.params = { id: 'missing-session' };
  req.cookies.remote_access_session = session.accessToken;
  const res = createRes();
  await runHandlers(app.routes['POST /api/remoteaccess/desktop/sessions/:id/offer'], req, res);

  assert.equal(res.statusCode, 404);
});

test('remote desktop connected state requires browser-confirmed media', async () => {
  const pool = createRemoteDataPool();
  const userStore = createRemoteUserStore([{
    email: 'user@example.com',
    password: 'secret',
    deviceScopeMode: 'selected',
    deviceIds: ['device-1'],
  }]);
  const session = await createRemoteAccessSession(pool, 'user@example.com', createReq());
  const app = createApp();
  registerRemoteAccessRoutes(app, {
    pool,
    userStore,
    getConnectedAgent: () => ({ readyState: 1 }),
  });
  registerRemoteDesktopRoutes(app, {
    pool,
    userStore,
    agentAuthMiddleware: (_req, _res, next) => next(),
  });

  const connectReq = createReq();
  connectReq.params = { id: 'device-1' };
  connectReq.cookies.remote_access_session = session.accessToken;
  const connectRes = createRes();
  await runHandlers(app.routes['POST /api/remoteaccess/devices/:id/connect'], connectReq, connectRes);
  const desktopSessionId = connectRes.body.desktopSession.id;

  const earlyMediaReq = createReq();
  earlyMediaReq.params = { id: desktopSessionId };
  earlyMediaReq.cookies.remote_access_session = session.accessToken;
  const earlyMediaRes = createRes();
  await runHandlers(app.routes['POST /api/remoteaccess/desktop/sessions/:id/media-active'], earlyMediaReq, earlyMediaRes);
  assert.equal(earlyMediaRes.statusCode, 409);

  const offerReq = createReq({ offer: { type: 'offer', sdp: 'v=0' } });
  offerReq.params = { id: desktopSessionId };
  offerReq.cookies.remote_access_session = session.accessToken;
  await runHandlers(app.routes['POST /api/remoteaccess/desktop/sessions/:id/offer'], offerReq, createRes());

  const answerReq = createReq({ deviceId: 'device-1', answer: { type: 'answer', sdp: 'v=0' } });
  answerReq.params = { id: desktopSessionId };
  await runHandlers(app.routes['POST /api/agent/remote-desktop/sessions/:id/answer'], answerReq, createRes());
  assert.equal(pool.desktopSessions[0].status, 'media_starting');

  const mediaReq = createReq();
  mediaReq.params = { id: desktopSessionId };
  mediaReq.cookies.remote_access_session = session.accessToken;
  const mediaRes = createRes();
  await runHandlers(app.routes['POST /api/remoteaccess/desktop/sessions/:id/media-active'], mediaReq, mediaRes);

  assert.equal(mediaRes.statusCode, 200);
  assert.equal(mediaRes.body.session.status, 'connected');
});

test('remote desktop session state transitions are recorded', async () => {
  const pool = createRemoteDataPool();
  const created = await createRemoteSessionGrant(pool, {
    remoteUserIdentity: 'user@example.com',
    deviceId: 'device-1',
    ttlSeconds: 180,
    token: 'known-token',
  });
  const app = createApp();
  const userStore = createRemoteUserStore([{ email: 'user@example.com', password: 'secret' }]);
  registerRemoteAccessRoutes(app, { pool, userStore, getConnectedAgent: () => ({ readyState: 1 }) });
  const session = await createRemoteDesktopSession(pool, {
    grant: created.grant,
    remoteUserIdentity: 'user@example.com',
    deviceId: 'device-1',
  });

  const connected = await setRemoteDesktopStatus(pool, session.id, 'connected');
  assert.equal(connected.status, 'connected');
  assert.ok(connected.started_at);

  const ended = await setRemoteDesktopStatus(pool, session.id, 'ended');
  assert.equal(ended.status, 'ended');
  assert.ok(ended.ended_at);

  const lookup = await getRemoteDesktopSessionForUser(pool, session.id, { email: 'user@example.com' });
  assert.equal(lookup.session.status, 'ended');
});

test('remote user cannot open a device outside assigned scope', async () => {
  const detail = await getRemoteAccessDeviceDetail(
    createRemoteDataPool(),
    { email: 'user@example.com', deviceScopeMode: 'selected', deviceIds: ['device-1'] },
    'device-2'
  );

  assert.equal(detail, null);
});

test('out-of-scope unattended session request is denied', async () => {
  const pool = createRemoteDataPool();
  const userStore = createRemoteUserStore([{
    email: 'user@example.com',
    password: 'secret',
    deviceScopeMode: 'selected',
    deviceIds: ['device-1'],
  }]);
  const session = await createRemoteAccessSession(pool, 'user@example.com', createReq());
  const app = createApp();
  registerRemoteAccessRoutes(app, {
    pool,
    userStore,
    getConnectedAgent: () => ({ readyState: 1 }),
  });

  const req = createReq();
  req.params = { id: 'device-2' };
  req.cookies.remote_access_session = session.accessToken;
  const res = createRes();
  await runHandlers(app.routes['POST /api/remoteaccess/devices/:id/connect'], req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(pool.grants.length, 0);
});

test('inactive or remote-access-disabled user is denied unattended access', async () => {
  const inactive = { email: 'user@example.com', isActive: false, remoteAccessEnabled: true };
  const disabled = { email: 'user@example.com', isActive: true, remoteAccessEnabled: false };
  assert.equal(remoteUserAllowed(inactive), false);
  assert.equal(remoteUserAllowed(disabled), false);
  assert.equal(await createRemoteUserStore([{
    email: 'user@example.com',
    password: 'secret',
    isActive: false,
  }]).verifyCredentials('user@example.com', 'secret'), null);
  assert.equal(await createRemoteUserStore([{
    email: 'user@example.com',
    password: 'secret',
    remoteAccessEnabled: false,
  }]).verifyCredentials('user@example.com', 'secret'), null);
});

test('offline device is denied unattended session grant', async () => {
  const pool = createRemoteDataPool();
  const userStore = createRemoteUserStore([{
    email: 'user@example.com',
    password: 'secret',
    deviceScopeMode: 'selected',
    deviceIds: ['device-1'],
  }]);
  const session = await createRemoteAccessSession(pool, 'user@example.com', createReq());
  const app = createApp();
  registerRemoteAccessRoutes(app, { pool, userStore, getConnectedAgent: () => null });

  const req = createReq();
  req.params = { id: 'device-1' };
  req.cookies.remote_access_session = session.accessToken;
  const res = createRes();
  await runHandlers(app.routes['POST /api/remoteaccess/devices/:id/connect'], req, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.state, 'unavailable');
  assert.equal(pool.grants.length, 0);
});

test('expired and invalid unattended session grants are denied', async () => {
  const pool = createRemoteDataPool();
  const created = await createRemoteSessionGrant(pool, {
    remoteUserIdentity: 'user@example.com',
    deviceId: 'device-1',
    ttlSeconds: 180,
    token: 'known-token',
  });

  assert.equal((await validateRemoteSessionGrant(pool, 'wrong-token', 'device-1')).ok, false);

  pool.grants[0].expires_at = new Date(Date.now() - 1_000);
  const expired = await validateRemoteSessionGrant(pool, created.token, 'device-1');
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, 'expired-grant');
  assert.equal(pool.grants[0].status, 'expired');
});

test('remote device detail exposes readiness when agent is reachable', async () => {
  const detail = await getRemoteAccessDeviceDetail(
    createRemoteDataPool(),
    { email: 'user@example.com', deviceScopeMode: 'selected', deviceIds: ['device-1'] },
    'device-1',
    { isAgentReachable: () => true }
  );

  assert.equal(detail.remoteConnect.available, true);
  assert.equal(detail.remoteConnect.state, 'grant-ready');
});

test('/remoteaccess device list includes remote detail links for allowed devices', async () => {
  const dashboard = await getRemoteAccessDashboard(
    createRemoteDataPool(),
    { email: 'user@example.com', deviceScopeMode: 'selected', deviceIds: ['device-1'] }
  );

  assert.equal(dashboard.devices.length, 1);
  assert.equal(dashboard.devices[0].id, 'device-1');
  assert.equal(dashboard.devices[0].detailPath, '/remoteaccess/devices/device-1');
});

test('selected remote user with no assigned devices cannot see all devices', async () => {
  const dashboard = await getRemoteAccessDashboard(
    createRemoteDataPool(),
    { email: 'user@example.com', deviceScopeMode: 'selected', deviceIds: [] }
  );

  assert.equal(dashboard.devices.length, 0);
});
