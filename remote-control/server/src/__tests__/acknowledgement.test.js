const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CURRENT_OPERATOR_ACK_VERSION,
  acceptAcknowledgement,
  acknowledgementRequired,
  hasCurrentAcknowledgement,
} = require('../acknowledgement');

function createPool() {
  const rows = [];
  return {
    rows,
    async query(sql, params) {
      if (sql.includes('SELECT admin_identity, version, accepted_at')) {
        const [adminIdentity] = params;
        const matches = rows
          .filter((row) => row.admin_identity === adminIdentity)
          .sort((a, b) => b.accepted_at.getTime() - a.accepted_at.getTime());
        return { rowCount: matches.length ? 1 : 0, rows: matches.slice(0, 1) };
      }

      if (sql.includes('INSERT INTO admin_operator_acknowledgements')) {
        const [adminIdentity, version] = params;
        const existing = rows.find((row) =>
          row.admin_identity === adminIdentity && row.version === version
        );
        const accepted = {
          admin_identity: adminIdentity,
          version,
          accepted_at: new Date(Date.now() + rows.length + 1),
        };
        if (existing) {
          existing.accepted_at = accepted.accepted_at;
          return { rowCount: 1, rows: [existing] };
        }
        rows.push(accepted);
        return { rowCount: 1, rows: [accepted] };
      }

      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('acknowledgement required when missing', () => {
  assert.equal(acknowledgementRequired(null), true);
});

test('acknowledgement required when version changes', () => {
  assert.equal(acknowledgementRequired({ version: 'older-version' }), true);
  assert.equal(acknowledgementRequired({ version: CURRENT_OPERATOR_ACK_VERSION }), false);
});

test('acknowledgement accept flow records current version', async () => {
  const pool = createPool();
  const accepted = await acceptAcknowledgement(pool, 'admin@local');

  assert.equal(accepted.admin_identity, 'admin@local');
  assert.equal(accepted.version, CURRENT_OPERATOR_ACK_VERSION);
  assert.equal(await hasCurrentAcknowledgement(pool, 'admin@local'), true);
});

test('protected access check remains blocked until accepted', async () => {
  const pool = createPool();

  assert.equal(await hasCurrentAcknowledgement(pool, 'admin@local'), false);
  await acceptAcknowledgement(pool, 'admin@local');
  assert.equal(await hasCurrentAcknowledgement(pool, 'admin@local'), true);
});
