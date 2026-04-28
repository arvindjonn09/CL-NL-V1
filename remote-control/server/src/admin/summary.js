const { CURRENT_OPERATOR_ACK_VERSION } = require('../acknowledgement');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@local';

function fleetSummary(devices = []) {
  const summary = {
    totalDevices: devices.length,
    onlineDevices: 0,
    offlineDevices: 0,
    degradedDevices: 0,
    operatorAttentionDevices: 0,
  };

  for (const device of devices) {
    if (device.status === 'online') summary.onlineDevices += 1;
    if (device.status === 'offline') summary.offlineDevices += 1;
    if (device.healthStatus === 'degraded' || device.healthStatus === 'warning' || device.healthStatus === 'stale') {
      summary.degradedDevices += 1;
    }
    if (device.operatorAttentionNeeded) summary.operatorAttentionDevices += 1;
  }

  return summary;
}

function buildAdminOverview({ devices = [], remoteUsers = [], healthEvents = [] } = {}) {
  const activeUsers = remoteUsers.filter((user) => user.isActive !== false);
  const disabledUsers = remoteUsers.filter((user) => user.isActive === false);
  const admins = remoteUsers.filter((user) => user.userType === 'admin');
  const remoteAccessUsers = remoteUsers.filter((user) => user.userType !== 'admin' || user.remoteAccessEnabled);
  return {
    cards: {
      totalUsers: 1 + remoteUsers.length,
      totalActiveUsers: 1 + activeUsers.length,
      totalAdmins: 1 + admins.length,
      totalRemoteAccessUsers: remoteAccessUsers.length,
      totalDisabledUsers: disabledUsers.length,
      ...fleetSummary(devices),
    },
    recentWarnings: healthEvents.map((event) => ({
      id: event.id,
      level: event.level,
      source: event.source,
      message: event.message,
      createdAt: event.created_at,
      deviceId: event.device_id || null,
    })),
  };
}

function buildAdminUsers({ remoteUsers = [], acknowledgements = [], sessions = [] } = {}) {
  const ackByIdentity = new Map(acknowledgements.map((row) => [row.admin_identity, row]));
  const sessionByIdentity = new Map();
  for (const session of sessions) {
    if (!sessionByIdentity.has(session.admin_user)) {
      sessionByIdentity.set(session.admin_user, session);
    }
  }

  return [
    {
      id: 'env-admin',
      email: ADMIN_EMAIL,
      displayName: 'Owner/Admin',
      username: null,
      userType: 'admin',
      status: 'active',
      remoteAccessEnabled: false,
      acknowledgementVersion: ackByIdentity.get(ADMIN_EMAIL)?.version || null,
      acknowledgementAcceptedAt: ackByIdentity.get(ADMIN_EMAIL)?.accepted_at || null,
      acknowledgementCurrentVersion: CURRENT_OPERATOR_ACK_VERSION,
      deviceScopeMode: 'all',
      deviceIds: [],
      deviceAccessScope: 'all devices',
      createdAt: null,
      updatedAt: null,
      notes: 'Environment-configured owner account',
      lastLoginAt: sessionByIdentity.get(ADMIN_EMAIL)?.issued_at || null,
    },
    ...remoteUsers.map((user) => {
      const deviceScopeMode = user.deviceScopeMode || (user.deviceIds?.length ? 'selected' : 'all');
      const deviceIds = user.deviceIds || [];
      return {
      id: user.id || user.email,
      email: user.email,
      displayName: user.displayName || user.email,
      username: user.username || null,
      userType: user.userType === 'admin' ? 'admin' : 'remote access',
      status: user.isActive === false ? 'disabled' : 'active',
      remoteAccessEnabled: user.remoteAccessEnabled !== false,
      acknowledgementVersion: null,
      acknowledgementAcceptedAt: null,
      acknowledgementCurrentVersion: null,
      deviceScopeMode,
      deviceIds,
      deviceAccessScope: deviceScopeMode === 'selected'
        ? (user.deviceScopeMode ? `${deviceIds.length} selected` : deviceIds.join(', '))
        : 'all devices',
      createdAt: user.createdAt || null,
      updatedAt: user.updatedAt || null,
      notes: user.notes || null,
      lastLoginAt: user.lastLoginAt || null,
      };
    }),
  ];
}

module.exports = {
  buildAdminOverview,
  buildAdminUsers,
  fleetSummary,
};
