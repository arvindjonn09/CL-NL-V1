const assert = require('node:assert/strict');
const test = require('node:test');
const { validateManifest } = require('../manifest');
const { registerUpgradeRoutes } = require('../handlers');

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
    end() {
      this.ended = true;
      return this;
    },
  };
}

test('validateManifest accepts stable approved manifest shape', () => {
  assert.equal(validateManifest({
    version: '0.2.0',
    downloadUrl: 'https://example.com/setulink-agent.exe',
    sha256: 'abc',
    sizeBytes: 10,
  }), true);
  assert.equal(validateManifest({ version: '0.2.0' }), false);
});

test('agent manifest route returns approved manifest', async () => {
  const previous = {
    UPGRADE_VERSION: process.env.UPGRADE_VERSION,
    UPGRADE_DOWNLOAD_URL: process.env.UPGRADE_DOWNLOAD_URL,
    UPGRADE_SHA256: process.env.UPGRADE_SHA256,
    UPGRADE_SIZE_BYTES: process.env.UPGRADE_SIZE_BYTES,
  };
  process.env.UPGRADE_VERSION = '0.2.0';
  process.env.UPGRADE_DOWNLOAD_URL = 'https://example.com/setulink-agent.exe';
  process.env.UPGRADE_SHA256 = 'abc';
  process.env.UPGRADE_SIZE_BYTES = '10';

  const app = createAppRecorder();
  const pool = { async query() { return { rowCount: 1, rows: [] }; } };
  registerUpgradeRoutes(app, {
    pool,
    agentAuthMiddleware: (_req, _res, next) => next(),
    authMiddleware: (_req, _res, next) => next(),
  });
  const res = createResponse();
  await app.routes['GET /api/agent/upgrades/manifest']({ query: { id: 'device-1', version: '0.1.0' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.version, '0.2.0');

  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});
