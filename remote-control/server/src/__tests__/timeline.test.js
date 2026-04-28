const assert = require('node:assert/strict');
const test = require('node:test');
const { buildDeviceTimeline } = require('../timeline');

test('buildDeviceTimeline merges recent operational sources newest first', () => {
  const timeline = buildDeviceTimeline({
    heartbeats: [
      {
        id: 'hb-1',
        created_at: '2026-04-18T00:02:00Z',
        run_mode: 'windows-service',
        agent_version: '0.1.0',
        process_id: 42,
      },
    ],
    commands: [
      {
        command_id: 'cmd-1',
        command: 'date',
        status: 'completed',
        command_created_at: '2026-04-18T00:00:00Z',
        completed_at: '2026-04-18T00:01:00Z',
        exit_code: 0,
      },
    ],
    fileJobs: [
      {
        id: 'file-1',
        original_name: 'notes.txt',
        status: 'failed',
        created_at: '2026-04-17T23:59:00Z',
        completed_at: '2026-04-18T00:00:30Z',
        error_message: 'disk full',
      },
    ],
    healthEvents: [
      {
        id: 'health-1',
        level: 'warning',
        source: 'watchdog',
        message: 'operator attention needed',
        created_at: '2026-04-18T00:01:30Z',
      },
    ],
    actions: [
      {
        id: 'action-1',
        action_type: 'restart-service',
        status: 'success',
        requested_by: 'admin@example.com',
        requested_at: '2026-04-17T23:58:00Z',
        completed_at: '2026-04-17T23:58:30Z',
        result_summary: 'service restarted',
      },
    ],
    upgradeEvents: [
      {
        id: 'upgrade-1',
        status: 'rollback-requested',
        from_version: '0.1.0',
        to_version: '0.2.0',
        created_at: '2026-04-18T00:03:00Z',
      },
    ],
    auditLogs: [
      {
        id: 'audit-1',
        action: 'file_access',
        admin_user: 'admin@example.com',
        result: 'success',
        detail: 'upload queued',
        created_at: '2026-04-17T23:59:10Z',
      },
    ],
  });

  assert.equal(timeline[0].label, 'Upgrade rollback recorded');
  assert.equal(timeline[1].label, 'Heartbeat seen');
  assert.ok(timeline.some((event) => event.label === 'Operator attention changed'));
  assert.ok(timeline.some((event) => event.label === 'Command dispatched'));
  assert.ok(timeline.some((event) => event.label === 'Command completed'));
  assert.ok(timeline.some((event) => event.label === 'File transfer failed'));
  assert.ok(timeline.some((event) => event.source === 'admin@example.com'));
});

test('buildDeviceTimeline applies limit after sorting', () => {
  const timeline = buildDeviceTimeline(
    {
      heartbeats: [
        { id: 'old', created_at: '2026-04-18T00:00:00Z' },
        { id: 'new', created_at: '2026-04-18T00:01:00Z' },
      ],
    },
    1
  );

  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].id, 'heartbeat:new');
});
