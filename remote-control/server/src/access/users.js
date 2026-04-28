const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUsername(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeUserType(value) {
  return value === 'admin' ? 'admin' : 'remote';
}

function normalizeDeviceScopeMode(value) {
  return value === 'selected' ? 'selected' : 'all';
}

function normalizeDeviceIds(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
}

function rowToUser(row, deviceIds = []) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    displayName: row.name,
    email: row.email,
    username: row.username,
    userType: row.user_type,
    isActive: row.is_active,
    remoteAccessEnabled: row.remote_access_enabled,
    deviceScopeMode: row.device_scope_mode,
    deviceIds,
    notes: row.notes,
    passwordChangeRequired: row.password_change_required,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

async function deviceIdsForUsers(pool, userIds) {
  if (!userIds.length) return new Map();
  const result = await pool.query(
    `
    SELECT user_id, device_id
    FROM user_device_scopes
    WHERE user_id = ANY($1)
    ORDER BY device_id
    `,
    [userIds]
  );
  const byUserId = new Map(userIds.map((id) => [id, []]));
  for (const row of result.rows) {
    byUserId.get(row.user_id)?.push(row.device_id);
  }
  return byUserId;
}

async function listAccessUsers(pool) {
  const result = await pool.query(`
    SELECT *
    FROM access_users
    ORDER BY created_at ASC
  `);
  const scopes = await deviceIdsForUsers(pool, result.rows.map((row) => row.id));
  return result.rows.map((row) => rowToUser(row, scopes.get(row.id) || []));
}

async function getAccessUserById(pool, id) {
  const result = await pool.query('SELECT * FROM access_users WHERE id = $1 LIMIT 1', [id]);
  if (result.rowCount === 0) return null;
  const scopes = await deviceIdsForUsers(pool, [id]);
  return rowToUser(result.rows[0], scopes.get(id) || []);
}

async function findAccessUserForLogin(pool, identity) {
  const normalized = normalizeEmail(identity);
  const result = await pool.query(
    `
    SELECT *
    FROM access_users
    WHERE lower(email) = $1 OR lower(username) = $1
    LIMIT 1
    `,
    [normalized]
  );
  if (result.rowCount === 0) return null;
  const scopes = await deviceIdsForUsers(pool, [result.rows[0].id]);
  return rowToUser(result.rows[0], scopes.get(result.rows[0].id) || []);
}

async function getPasswordHash(pool, identity) {
  const normalized = normalizeEmail(identity);
  const result = await pool.query(
    `
    SELECT password_hash
    FROM access_users
    WHERE lower(email) = $1 OR lower(username) = $1
    LIMIT 1
    `,
    [normalized]
  );
  return result.rows[0]?.password_hash || null;
}

async function setDeviceScope(pool, userId, mode, deviceIds = []) {
  await pool.query('DELETE FROM user_device_scopes WHERE user_id = $1', [userId]);
  if (mode !== 'selected') return;
  for (const deviceId of normalizeDeviceIds(deviceIds)) {
    await pool.query(
      `
      INSERT INTO user_device_scopes (user_id, device_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      `,
      [userId, deviceId]
    );
  }
}

async function createAccessUser(pool, input) {
  const email = normalizeEmail(input.email);
  const name = String(input.name || input.displayName || email).trim();
  const password = String(input.password || '');
  if (!email) {
    const err = new Error('Email is required');
    err.statusCode = 400;
    throw err;
  }
  if (!name) {
    const err = new Error('Name is required');
    err.statusCode = 400;
    throw err;
  }
  if (password.length < 8) {
    const err = new Error('Password must be at least 8 characters');
    err.statusCode = 400;
    throw err;
  }

  const id = crypto.randomUUID();
  const userType = normalizeUserType(input.userType || input.user_type);
  const scopeMode = normalizeDeviceScopeMode(input.deviceScopeMode || input.device_scope_mode);
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    await pool.query(
      `
      INSERT INTO access_users (
        id,
        name,
        email,
        username,
        password_hash,
        user_type,
        is_active,
        remote_access_enabled,
        device_scope_mode,
        notes,
        password_change_required
      )
      VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, $9, $10)
      `,
      [
        id,
        name,
        email,
        normalizeUsername(input.username),
        passwordHash,
        userType,
        input.remoteAccessEnabled === true || input.remote_access_enabled === true,
        scopeMode,
        input.notes || null,
        input.passwordChangeRequired === true || input.password_change_required === true,
      ]
    );
  } catch (err) {
    if (err.code === '23505') {
      err.statusCode = 409;
      err.message = 'A user with that email or username already exists';
    }
    throw err;
  }

  await setDeviceScope(pool, id, scopeMode, input.deviceIds || input.device_ids || []);
  return getAccessUserById(pool, id);
}

async function updateAccessUser(pool, id, input) {
  const existing = await getAccessUserById(pool, id);
  if (!existing) return null;

  const userType = input.userType === undefined ? existing.userType : normalizeUserType(input.userType);
  const scopeMode = input.deviceScopeMode === undefined
    ? existing.deviceScopeMode
    : normalizeDeviceScopeMode(input.deviceScopeMode);

  await pool.query(
    `
    UPDATE access_users
    SET name = $2,
        email = $3,
        username = $4,
        user_type = $5,
        is_active = $6,
        remote_access_enabled = $7,
        device_scope_mode = $8,
        notes = $9,
        updated_at = NOW()
    WHERE id = $1
    `,
    [
      id,
      String(input.name ?? existing.name).trim() || existing.name,
      normalizeEmail(input.email ?? existing.email),
      normalizeUsername(input.username ?? existing.username),
      userType,
      input.isActive === undefined ? existing.isActive : input.isActive === true,
      input.remoteAccessEnabled === undefined
        ? existing.remoteAccessEnabled
        : input.remoteAccessEnabled === true,
      scopeMode,
      input.notes === undefined ? existing.notes : input.notes || null,
    ]
  );

  if (input.deviceScopeMode !== undefined || input.deviceIds !== undefined) {
    await setDeviceScope(pool, id, scopeMode, input.deviceIds || []);
  }

  return getAccessUserById(pool, id);
}

async function resetAccessUserPassword(pool, id, password, passwordChangeRequired = true) {
  if (String(password || '').length < 8) {
    const err = new Error('Password must be at least 8 characters');
    err.statusCode = 400;
    throw err;
  }
  const passwordHash = await bcrypt.hash(String(password), 12);
  const result = await pool.query(
    `
    UPDATE access_users
    SET password_hash = $2,
        password_change_required = $3,
        updated_at = NOW()
    WHERE id = $1
    RETURNING id
    `,
    [id, passwordHash, passwordChangeRequired === true]
  );
  return result.rowCount > 0;
}

async function recordLogin(pool, userId) {
  if (!userId) return;
  await pool.query(
    'UPDATE access_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1',
    [userId]
  );
}

async function verifyAccessUserCredentials(pool, identity, password, options = {}) {
  const user = await findAccessUserForLogin(pool, identity);
  if (!user || !user.isActive) return null;
  if (options.userType && user.userType !== options.userType) return null;
  if (options.remoteAccessRequired && !user.remoteAccessEnabled) return null;

  const hash = await getPasswordHash(pool, identity);
  if (!hash) return null;
  const valid = await bcrypt.compare(String(password || ''), hash);
  return valid ? user : null;
}

async function verifyAdminCredentials(pool, email, password) {
  const dbUser = await verifyAccessUserCredentials(pool, email, password, { userType: 'admin' });
  if (dbUser) {
    await recordLogin(pool, dbUser.id);
    return { ok: true, email: dbUser.email, source: 'access_users' };
  }

  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail !== ADMIN_EMAIL) return { ok: false };
  const valid = ADMIN_PASSWORD_HASH
    ? await bcrypt.compare(String(password || ''), ADMIN_PASSWORD_HASH)
    : String(password || '') === ADMIN_PASSWORD;
  return valid ? { ok: true, email: ADMIN_EMAIL, source: 'env' } : { ok: false };
}

async function revokeUserSessions(pool, user) {
  if (!user) return { adminSessions: 0, remoteSessions: 0 };
  const admin = await pool.query(
    `
    UPDATE admin_sessions
    SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE admin_user = $1 AND revoked_at IS NULL
    `,
    [user.email]
  );
  const remote = await pool.query(
    `
    UPDATE remote_access_sessions
    SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE email = $1 AND revoked_at IS NULL
    `,
    [user.email]
  );
  return { adminSessions: admin.rowCount, remoteSessions: remote.rowCount };
}

async function recentUserAudit(pool, email, limit = 8) {
  const result = await pool.query(
    `
    SELECT action, target_type, target_id, admin_user, result, detail, created_at
    FROM admin_audit_logs
    WHERE target_id = $1 OR admin_user = $1
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [email, limit]
  );
  return result.rows;
}

function createAccessUserStore(pool) {
  return {
    async getUser(identity) {
      const user = await findAccessUserForLogin(pool, identity);
      if (!user || !user.isActive || !user.remoteAccessEnabled) return null;
      return user;
    },
    async listUsers() {
      return listAccessUsers(pool);
    },
    async verifyCredentials(identity, password) {
      const user = await verifyAccessUserCredentials(pool, identity, password, {
        remoteAccessRequired: true,
      });
      if (user) await recordLogin(pool, user.id);
      return user;
    },
  };
}

module.exports = {
  createAccessUser,
  createAccessUserStore,
  getAccessUserById,
  listAccessUsers,
  recentUserAudit,
  resetAccessUserPassword,
  revokeUserSessions,
  updateAccessUser,
  verifyAccessUserCredentials,
  verifyAdminCredentials,
};
