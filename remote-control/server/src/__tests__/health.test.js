const assert = require('node:assert/strict');
const test = require('node:test');
const {
  deriveHealthStatus,
  shapeDeviceSummary,
} = require('../health');

test('fresh heartbeat derives online and healthy despite stale stored error status', () => {
  const now = new Date('2026-04-18T00:00:00Z');
  const derived = deriveHealthStatus(
    {
      status: 'error',
      last_seen: new Date('2026-04-17T23:59:50Z'),
      last_error_at: new Date('2026-04-16T10:00:00Z'),
      last_error_source: 'command',
      last_error_message: 'command failed',
      last_command_activity_at: new Date('2026-04-16T10:00:00Z'),
      last_command_summary: { status: 'failed' },
      diagnostics_status: 'healthy',
      diagnostics_degraded: false,
      diagnostics_json: { degraded: false },
    },
    now
  );

  assert.equal(derived.connectionStatus, 'online');
  assert.equal(derived.healthStatus, 'healthy');
});

test('operation transport errors do not override fresh heartbeat and healthy diagnostics', () => {
  const now = new Date('2026-04-18T00:00:00Z');
  const derived = deriveHealthStatus(
    {
      last_seen: new Date('2026-04-17T23:59:55Z'),
      last_error_at: new Date('2026-04-17T23:59:40Z'),
      last_error_source: 'command-result',
      last_error_message: 'posting command result failed',
      last_command_activity_at: new Date('2026-04-17T23:59:50Z'),
      last_command_summary: { status: 'completed' },
      diagnostics_status: 'healthy',
      diagnostics_degraded: false,
      diagnostics_json: { degraded: false },
    },
    now
  );

  assert.equal(derived.connectionStatus, 'online');
  assert.equal(derived.healthStatus, 'healthy');
});

test('recent unresolved command or file failure is only a health warning', () => {
  const now = new Date('2026-04-18T00:00:00Z');
  const derived = deriveHealthStatus(
    {
      last_seen: new Date('2026-04-17T23:59:55Z'),
      last_command_activity_at: new Date('2026-04-17T23:59:50Z'),
      last_command_summary: { status: 'failed' },
      diagnostics_status: 'healthy',
      diagnostics_degraded: false,
      diagnostics_json: { degraded: false },
    },
    now
  );

  assert.equal(derived.connectionStatus, 'online');
  assert.equal(derived.healthStatus, 'warning');
});

test('summary exposes current watchdog attention without throwing', () => {
  const summary = shapeDeviceSummary({
    id: 'device-1',
    hostname: 'host-1',
    last_seen: new Date(),
    diagnostics_status: 'healthy',
    diagnostics_degraded: false,
    diagnostics_json: {
      operator_attention_needed: false,
      watchdog: { operatorAttentionNeeded: false },
    },
  });

  assert.equal(summary.status, 'online');
  assert.equal(summary.healthStatus, 'healthy');
  assert.equal(summary.operatorAttentionNeeded, false);
});
