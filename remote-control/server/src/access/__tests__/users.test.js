const assert = require('node:assert/strict');
const test = require('node:test');
const bcrypt = require('bcryptjs');
const {
  createAccessUserStore,
  verifyAccessUserCredentials,
} = require('../users');

function createPool(users = []) {
  return {
    users,
    async query(sql, params = []) {
      if (sql.includes('SELECT *') && sql.includes('FROM access_users') && sql.includes('lower(email)')) {
        const identity = params[0];
        const found = users.find((user) =>
          user.email.toLowerCase() === identity || String(user.username || '').toLowerCase() === identity
        );
        return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
      }

      if (sql.includes('SELECT password_hash') && sql.includes('FROM access_users')) {
        const identity = params[0];
        const found = users.find((user) =>
          user.email.toLowerCase() === identity || String(user.username || '').toLowerCase() === identity
        );
        return { rowCount: found ? 1 : 0, rows: found ? [{ password_hash: found.password_hash }] : [] };
      }

      if (sql.includes('FROM user_device_scopes')) {
        return { rowCount: 0, rows: [] };
      }

      if (sql.includes('UPDATE access_users SET last_login_at')) {
        const found = users.find((user) => user.id === params[0]);
        if (found) found.last_login_at = new Date();
        return { rowCount: found ? 1 : 0, rows: [] };
      }

      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

async function user(overrides = {}) {
  return {
    id: overrides.id || 'user-1',
    name: overrides.name || 'Remote User',
    email: overrides.email || 'remote@example.com',
    username: overrides.username || null,
    password_hash: await bcrypt.hash(overrides.password || 'correct-password', 4),
    user_type: overrides.user_type || 'remote',
    is_active: overrides.is_active ?? true,
    remote_access_enabled: overrides.remote_access_enabled ?? true,
    device_scope_mode: 'all',
    notes: null,
    password_change_required: false,
    created_at: new Date(),
    updated_at: new Date(),
    last_login_at: null,
  };
}

test('remote store authenticates only DB users with active remote access', async () => {
  const pool = createPool([await user()]);
  const store = createAccessUserStore(pool);

  assert.equal((await store.verifyCredentials('remote@example.com', 'correct-password')).email, 'remote@example.com');
  assert.equal(await store.verifyCredentials('remote@example.com', 'wrong-password'), null);
  assert.equal(await store.verifyCredentials('unknown@example.com', 'correct-password'), null);
});

test('remote store denies disabled users and users without remote access', async () => {
  const disabledPool = createPool([await user({ is_active: false })]);
  const remoteOffPool = createPool([await user({ remote_access_enabled: false })]);

  assert.equal(await createAccessUserStore(disabledPool).verifyCredentials('remote@example.com', 'correct-password'), null);
  assert.equal(await createAccessUserStore(remoteOffPool).verifyCredentials('remote@example.com', 'correct-password'), null);
  assert.equal(await createAccessUserStore(disabledPool).getUser('remote@example.com'), null);
  assert.equal(await createAccessUserStore(remoteOffPool).getUser('remote@example.com'), null);
});

test('admin credentials do not satisfy remote access unless remote access is enabled', async () => {
  const pool = createPool([await user({ user_type: 'admin', remote_access_enabled: false })]);

  const remote = await verifyAccessUserCredentials(pool, 'remote@example.com', 'correct-password', {
    remoteAccessRequired: true,
  });

  assert.equal(remote, null);
});
