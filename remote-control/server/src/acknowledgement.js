const CURRENT_OPERATOR_ACK_VERSION = 'phase6-operator-safety-v1';

function acknowledgementRequired(current = null, expectedVersion = CURRENT_OPERATOR_ACK_VERSION) {
  return !current || current.version !== expectedVersion;
}

async function getLatestAcknowledgement(pool, adminIdentity) {
  if (!adminIdentity) return null;

  const result = await pool.query(
    `
    SELECT admin_identity, version, accepted_at
    FROM admin_operator_acknowledgements
    WHERE admin_identity = $1
    ORDER BY accepted_at DESC
    LIMIT 1
    `,
    [adminIdentity]
  );

  return result.rows[0] || null;
}

async function hasCurrentAcknowledgement(pool, adminIdentity, expectedVersion = CURRENT_OPERATOR_ACK_VERSION) {
  return !acknowledgementRequired(
    await getLatestAcknowledgement(pool, adminIdentity),
    expectedVersion
  );
}

async function acceptAcknowledgement(pool, adminIdentity, version = CURRENT_OPERATOR_ACK_VERSION) {
  if (!adminIdentity) {
    const err = new Error('admin identity is required');
    err.statusCode = 400;
    throw err;
  }

  const result = await pool.query(
    `
    INSERT INTO admin_operator_acknowledgements (admin_identity, version, accepted_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (admin_identity, version)
    DO UPDATE SET accepted_at = EXCLUDED.accepted_at
    RETURNING admin_identity, version, accepted_at
    `,
    [adminIdentity, version]
  );

  return result.rows[0];
}

module.exports = {
  CURRENT_OPERATOR_ACK_VERSION,
  acceptAcknowledgement,
  acknowledgementRequired,
  getLatestAcknowledgement,
  hasCurrentAcknowledgement,
};
