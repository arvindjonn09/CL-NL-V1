const assert = require('node:assert/strict');
const test = require('node:test');
const { CURRENT_OPERATOR_ACK_VERSION } = require('../../acknowledgement');
const { createAuthMiddleware, isAcknowledgementExemptPath } = require('../middleware');
const { signAccessToken } = require('../tokens');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    cookie() {},
  };
}

function createPool({ acknowledged = false } = {}) {
  return {
    async query(sql, params) {
      if (sql.includes('FROM admin_sessions') && sql.includes('WHERE id = $1')) {
        return { rowCount: 1, rows: [{ id: params[0] }] };
      }
      if (sql.includes('SELECT admin_identity, version, accepted_at')) {
        if (!acknowledged) return { rowCount: 0, rows: [] };
        return {
          rowCount: 1,
          rows: [{
            admin_identity: params[0],
            version: CURRENT_OPERATOR_ACK_VERSION,
            accepted_at: new Date(),
          }],
        };
      }
      if (sql.includes('FROM admin_sessions') && sql.includes('token_hash')) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('auth middleware blocks protected access until acknowledgement is accepted', async () => {
  const middleware = createAuthMiddleware(createPool({ acknowledged: false }));
  const token = signAccessToken({ email: 'admin@local', sid: 'session-1' });
  const req = { path: '/api/devices', cookies: { session: token } };
  const res = createResponse();
  let nextCalled = false;

  await middleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.acknowledgementRequired, true);
  assert.equal(res.body.version, CURRENT_OPERATOR_ACK_VERSION);
});

test('auth middleware allows protected access after acknowledgement is accepted', async () => {
  const middleware = createAuthMiddleware(createPool({ acknowledged: true }));
  const token = signAccessToken({ email: 'admin@local', sid: 'session-1' });
  const req = { path: '/api/devices', cookies: { session: token } };
  const res = createResponse();
  let nextCalled = false;

  await middleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('acknowledgement endpoint is exempt from acknowledgement gate', async () => {
  assert.equal(isAcknowledgementExemptPath('/api/auth/acknowledgement'), true);

  const middleware = createAuthMiddleware(createPool({ acknowledged: false }));
  const token = signAccessToken({ email: 'admin@local', sid: 'session-1' });
  const req = { path: '/api/auth/acknowledgement', cookies: { session: token } };
  const res = createResponse();
  let nextCalled = false;

  await middleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});
