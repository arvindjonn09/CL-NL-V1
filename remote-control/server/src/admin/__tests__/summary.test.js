const assert = require('node:assert/strict');
const test = require('node:test');
const { buildAdminOverview, buildAdminUsers, fleetSummary } = require('../summary');

test('fleetSummary counts online offline degraded and operator attention devices', () => {
  const summary = fleetSummary([
    { status: 'online', healthStatus: 'healthy' },
    { status: 'online', healthStatus: 'degraded', operatorAttentionNeeded: true },
    { status: 'offline', healthStatus: 'offline' },
    { status: 'stale', healthStatus: 'stale' },
  ]);

  assert.deepEqual(summary, {
    totalDevices: 4,
    onlineDevices: 2,
    offlineDevices: 1,
    degradedDevices: 2,
    operatorAttentionDevices: 1,
  });
});

test('buildAdminOverview includes admin plus remote users and recent warning shape', () => {
  const overview = buildAdminOverview({
    devices: [{ status: 'online', healthStatus: 'healthy' }],
    remoteUsers: [{ email: 'remote@example.com' }],
    healthEvents: [{
      id: 'event-1',
      level: 'warning',
      source: 'watchdog',
      message: 'operator attention needed',
      created_at: '2026-04-19T00:00:00Z',
      device_id: 'device-1',
    }],
  });

  assert.equal(overview.cards.totalUsers, 2);
  assert.equal(overview.cards.totalRemoteAccessUsers, 1);
  assert.equal(overview.cards.totalDevices, 1);
  assert.equal(overview.recentWarnings[0].deviceId, 'device-1');
});

test('buildAdminUsers shows safe admin and remote user fields', () => {
  const users = buildAdminUsers({
    remoteUsers: [{ email: 'remote@example.com', displayName: 'Remote', deviceIds: ['device-1'] }],
    acknowledgements: [{
      admin_identity: 'admin@local',
      version: 'operator-safety-v1',
      accepted_at: '2026-04-19T00:00:00Z',
    }],
    sessions: [{
      admin_user: 'admin@local',
      issued_at: '2026-04-19T01:00:00Z',
    }],
  });

  assert.equal(users.length, 2);
  assert.equal(users[0].userType, 'admin');
  assert.equal(users[0].acknowledgementVersion, 'operator-safety-v1');
  assert.equal(users[1].userType, 'remote access');
  assert.equal(users[1].deviceAccessScope, 'device-1');
});
