const assert = require('node:assert/strict');
const test = require('node:test');
const { registerDiagnosticsRoutes } = require('../handlers');

function createAppRecorder() {
  const routes = {};
  return {
    routes,
    get(path, _middleware, handler) {
      routes[`GET ${path}`] = handler;
    },
    post(path, _middleware, handler) {
      routes[`POST ${path}`] = handler;
    },
  };
}

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
  };
}

test('agent diagnostics upload route persists and responds', async () => {
  const app = createAppRecorder();
  const pool = {
    async query(_sql, params) {
      return { rows: [{ device_id: params[0], status: params[1] }] };
    },
  };

  registerDiagnosticsRoutes(app, {
    pool,
    authMiddleware: (_req, _res, next) => next(),
    agentAuthMiddleware: (_req, _res, next) => next(),
  });

  const handler = app.routes['POST /api/agent/diagnostics'];
  const res = createResponse();
  await handler({
    body: {
      diagnostics: {
        device_id: 'device-1',
        degraded: false,
        recovery: { state: 'normal' },
      },
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.diagnostics.device_id, 'device-1');
});
