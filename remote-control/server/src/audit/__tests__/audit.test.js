const assert = require('node:assert/strict');
const test = require('node:test');
const { audit } = require('../audit');

function createReq(user = null) {
  return {
    user,
    ip: '127.0.0.1',
    get(name) {
      return name === 'user-agent' ? 'test-agent' : undefined;
    },
  };
}

test('audit creates login success and failure records', async () => {
  const entries = [];
  const pool = {
    async query(_sql, params) {
      entries.push(params);
      return { rowCount: 1 };
    },
  };

  await audit(pool, createReq(), {
    adminIdentity: 'admin@local',
    action: 'login',
    result: 'success',
  });
  await audit(pool, createReq(), {
    adminIdentity: 'admin@local',
    action: 'login',
    result: 'failure',
    detail: 'Invalid credentials',
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0][2], 'login');
  assert.equal(entries[0][7], 'success');
  assert.equal(entries[1][7], 'failure');
});

test('audit records admin action route context', async () => {
  const entries = [];
  const pool = {
    async query(_sql, params) {
      entries.push(params);
      return { rowCount: 1 };
    },
  };

  await audit(pool, createReq({ email: 'admin@local' }), {
    action: 'command_dispatch',
    targetType: 'device',
    targetId: 'device-1',
    result: 'success',
    detail: 'commandId=abc',
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0][1], 'admin@local');
  assert.equal(entries[0][2], 'command_dispatch');
  assert.equal(entries[0][3], 'device');
  assert.equal(entries[0][4], 'device-1');
});
