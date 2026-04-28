const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createAdminSession,
  isSessionActive,
  rotateAdminSession,
} = require('../sessions');
const { hashToken } = require('../tokens');

function createPool() {
  const sessions = [];
  return {
    sessions,
    async query(sql, params) {
      if (sql.includes('INSERT INTO admin_sessions')) {
        sessions.push({
          id: params[0],
          admin_user: params[1],
          token_hash: params[2],
          rotated_from: params[4] || null,
          revoked_at: null,
          expires_at: new Date(Date.now() + 60_000),
        });
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('SELECT *') && sql.includes('FROM admin_sessions')) {
        const found = sessions.find((session) =>
          session.token_hash === params[0] &&
          !session.revoked_at &&
          session.expires_at > new Date()
        );
        return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
      }

      if (sql.includes('UPDATE admin_sessions') && sql.includes('WHERE id = $1')) {
        const found = sessions.find((session) => session.id === params[0]);
        if (found) found.revoked_at = new Date();
        return { rowCount: found ? 1 : 0, rows: [] };
      }

      if (sql.includes('SELECT id') && sql.includes('WHERE id = $1')) {
        const found = sessions.find((session) =>
          session.id === params[0] &&
          !session.revoked_at &&
          session.expires_at > new Date()
        );
        return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
      }

      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('admin refresh rotation revokes old token and creates a new session', async () => {
  const pool = createPool();
  const req = { get: () => 'agent', ip: '127.0.0.1' };
  const created = await createAdminSession(pool, 'admin@local', req);
  assert.equal(pool.sessions.length, 1);
  assert.equal(pool.sessions[0].token_hash, hashToken(created.refreshToken));

  const rotated = await rotateAdminSession(pool, created.refreshToken, req);
  assert.ok(rotated);
  assert.notEqual(rotated.sessionId, created.sessionId);
  assert.equal(pool.sessions.length, 2);
  assert.ok(pool.sessions[0].revoked_at);
  assert.equal(await isSessionActive(pool, created.sessionId), false);
  assert.equal(await isSessionActive(pool, rotated.sessionId), true);
});
