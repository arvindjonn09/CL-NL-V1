const assert = require('node:assert/strict');
const test = require('node:test');
const {
  computeDiagnosticsHealth,
  saveLatestDiagnostics,
} = require('../service');

test('computeDiagnosticsHealth reports degraded diagnostics before generic warning', () => {
  const now = new Date('2026-04-18T00:00:30Z');
  const health = computeDiagnosticsHealth(
    { last_seen: new Date('2026-04-18T00:00:20Z') },
    {
      degraded: true,
      degraded_reason: 'backend unavailable',
      recovery: { state: 'degraded' },
    },
    now
  );

  assert.equal(health.status, 'degraded');
  assert.equal(health.label, 'Degraded');
  assert.equal(health.reason, 'backend unavailable');
});

test('computeDiagnosticsHealth reports recovery in progress', () => {
  const health = computeDiagnosticsHealth(
    { last_seen: new Date('2026-04-18T00:00:20Z') },
    {
      degraded: false,
      recovery: { state: 'recovering' },
    },
    new Date('2026-04-18T00:00:30Z')
  );

  assert.equal(health.status, 'recovering');
  assert.equal(health.label, 'Recovery in progress');
});

test('computeDiagnosticsHealth reports watchdog operator attention', () => {
  const health = computeDiagnosticsHealth(
    { last_seen: new Date('2026-04-18T00:00:20Z') },
    {
      degraded: true,
      diagnostics_json: {
        operator_attention_needed: true,
        watchdog: {
          operatorAttentionNeeded: true,
          reasons: ['excessive repair attempts'],
        },
      },
    },
    new Date('2026-04-18T00:00:30Z')
  );

  assert.equal(health.status, 'degraded');
  assert.equal(health.label, 'Operator attention needed');
  assert.equal(health.reason, 'excessive repair attempts');
});

test('saveLatestDiagnostics persists normalized snapshot', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ device_id: params[0], degraded: params[2] }] };
    },
  };

  const saved = await saveLatestDiagnostics(pool, {
    diagnostics: {
      device_id: 'device-1',
      version: '0.1.0',
      degraded: true,
      degraded_reason: 'backend unavailable',
      recovery: { state: 'degraded', consecutiveBackendFailures: 3 },
      watchdog: { operatorAttentionNeeded: true, reasons: ['prolonged degraded state'] },
      startup_checks: { passed: true },
    },
  });

  assert.equal(saved.device_id, 'device-1');
  assert.equal(saved.degraded, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[0], 'device-1');
  assert.equal(calls[0].params[2], true);
});
