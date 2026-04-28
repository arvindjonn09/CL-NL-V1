const bcrypt = require('bcryptjs');

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRemoteUser(user = {}) {
  const email = String(user.email || user.username || '').trim().toLowerCase();
  if (!email) return null;

  return {
    email,
    displayName: user.displayName || user.name || email,
    password: user.password || '',
    passwordHash: user.passwordHash || user.password_hash || '',
    isActive: user.isActive !== false && user.is_active !== false,
    remoteAccessEnabled: user.remoteAccessEnabled !== false && user.remote_access_enabled !== false,
    deviceScopeMode: user.deviceScopeMode || user.device_scope_mode,
    deviceIds: Array.isArray(user.deviceIds || user.device_ids)
      ? (user.deviceIds || user.device_ids).filter(Boolean)
      : splitCsv(user.deviceIds || user.device_ids || ''),
  };
}

function configuredRemoteUsers() {
  const users = [];
  if (process.env.REMOTE_ACCESS_USERS) {
    try {
      const parsed = JSON.parse(process.env.REMOTE_ACCESS_USERS);
      if (Array.isArray(parsed)) {
        for (const user of parsed) {
          const normalized = normalizeRemoteUser(user);
          if (normalized) users.push(normalized);
        }
      }
    } catch {
      console.warn('REMOTE_ACCESS_USERS is not valid JSON; ignoring configured remote users');
    }
  }

  const single = normalizeRemoteUser({
    email: process.env.REMOTE_ACCESS_EMAIL,
    password: process.env.REMOTE_ACCESS_PASSWORD,
    passwordHash: process.env.REMOTE_ACCESS_PASSWORD_HASH,
    displayName: process.env.REMOTE_ACCESS_DISPLAY_NAME,
    deviceIds: process.env.REMOTE_ACCESS_DEVICE_IDS,
  });
  if (single && !users.some((user) => user.email === single.email)) {
    users.push(single);
  }

  return users;
}

function createRemoteUserStore(users = configuredRemoteUsers()) {
  const normalizedUsers = users
    .map((user) => normalizeRemoteUser(user))
    .filter(Boolean);
  const byEmail = new Map(normalizedUsers.map((user) => [user.email, user]));

  async function verifyCredentials(email, password) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const user = byEmail.get(normalizedEmail);
    if (!user) return null;
    if (!user.isActive || !user.remoteAccessEnabled) return null;

    if (user.passwordHash) {
      const valid = await bcrypt.compare(String(password || ''), user.passwordHash);
      return valid ? user : null;
    }

    if (user.password && user.password === String(password || '')) {
      return user;
    }

    return null;
  }

  function getUser(email) {
    const user = byEmail.get(String(email || '').trim().toLowerCase()) || null;
    if (!user || !user.isActive || !user.remoteAccessEnabled) return null;
    return user;
  }

  function listUsers() {
    return Array.from(byEmail.values()).map((user) => ({
      email: user.email,
      displayName: user.displayName,
      isActive: user.isActive,
      remoteAccessEnabled: user.remoteAccessEnabled,
      deviceScopeMode: user.deviceScopeMode,
      deviceIds: [...(user.deviceIds || [])],
    }));
  }

  return {
    getUser,
    listUsers,
    verifyCredentials,
  };
}

module.exports = {
  configuredRemoteUsers,
  createRemoteUserStore,
  normalizeRemoteUser,
};
