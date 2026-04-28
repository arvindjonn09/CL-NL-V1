const crypto = require('crypto');
const { currentApprovedManifest, validateManifest } = require('./manifest');

function getApprovedManifest() {
  const manifest = currentApprovedManifest();
  if (!validateManifest(manifest)) {
    return null;
  }
  return manifest;
}

async function recordUpgradeEvent(pool, event) {
  await pool.query(
    `
    INSERT INTO upgrade_events (id, device_id, from_version, to_version, status, reason)
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      crypto.randomUUID(),
      event.deviceId || null,
      event.fromVersion || null,
      event.toVersion || null,
      event.status,
      event.reason || null,
    ]
  );
}

module.exports = {
  getApprovedManifest,
  recordUpgradeEvent,
};
