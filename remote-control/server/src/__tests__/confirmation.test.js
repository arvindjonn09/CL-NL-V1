const assert = require('node:assert/strict');
const test = require('node:test');
const {
  actionConfirmationRuleKey,
  auditConfirmationDetail,
  validateConfirmation,
} = require('../confirmation');

test('restart-service requires warning confirmation intent', () => {
  assert.throws(
    () => validateConfirmation('action:restart-service', {}),
    /confirmation intent is required: restart-service/
  );

  const result = validateConfirmation('action:restart-service', {
    confirmation: { intent: 'restart-service' },
  });
  assert.equal(result.required, true);
  assert.equal(result.risk, 'warning');
  assert.equal(result.typed, false);
});

test('apply-staged-upgrade requires typed APPLY confirmation', () => {
  assert.throws(
    () => validateConfirmation('action:apply-staged-upgrade', {
      confirmation: { intent: 'apply-staged-upgrade', typedValue: 'apply' },
    }),
    /typed confirmation is required: APPLY/
  );

  const result = validateConfirmation('action:apply-staged-upgrade', {
    confirmation: { intent: 'apply-staged-upgrade', typedValue: 'APPLY' },
  });
  assert.equal(result.risk, 'typed');
  assert.equal(result.typed, true);
});

test('device delete and environment routes enforce their own confirmation intents', () => {
  assert.throws(
    () => validateConfirmation('device:delete', { confirmation: { intent: 'device-delete' } }),
    /typed confirmation is required: DELETE/
  );

  assert.equal(validateConfirmation('device:delete', {
    confirmation: { intent: 'device-delete', typedValue: 'DELETE' },
  }).ok, true);

  assert.equal(validateConfirmation('device:environment', {
    confirmation: { intent: 'environment-change' },
  }).ok, true);
});

test('file upload requires explicit file-upload confirmation intent', () => {
  assert.throws(
    () => validateConfirmation('file:upload', { confirmation: { intent: 'wrong' } }),
    /confirmation intent is required: file-upload/
  );
  assert.equal(validateConfirmation('file:upload', {
    confirmationIntent: 'file-upload',
  }).ok, true);
});

test('action rule lookup and audit detail stay concise', () => {
  assert.equal(actionConfirmationRuleKey('force-heartbeat'), null);
  assert.equal(actionConfirmationRuleKey('restart-service'), 'action:restart-service');
  assert.equal(
    auditConfirmationDetail('restart-service', {
      required: true,
      intent: 'restart-service',
      risk: 'warning',
      typed: false,
    }),
    'restart-service; confirmation=restart-service; risk=warning'
  );
});
