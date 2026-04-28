const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoginRateLimiter } = require('../rate_limit');

test('login rate limiter locks by IP and identity after repeated failures', () => {
  let current = 1_000;
  const limiter = createLoginRateLimiter({
    maxAttempts: 2,
    windowMs: 60_000,
    cooldownMs: 120_000,
    now: () => current,
  });

  assert.equal(limiter.check('1.2.3.4', 'admin@local').allowed, true);
  limiter.recordFailure('1.2.3.4', 'admin@local');
  assert.equal(limiter.check('1.2.3.4', 'admin@local').allowed, true);
  limiter.recordFailure('1.2.3.4', 'admin@local');

  const locked = limiter.check('1.2.3.4', 'admin@local');
  assert.equal(locked.allowed, false);
  assert.equal(locked.retryAfterSeconds, 120);

  current += 121_000;
  assert.equal(limiter.check('1.2.3.4', 'admin@local').allowed, true);
});

test('login rate limiter clears counters after success', () => {
  const limiter = createLoginRateLimiter({ maxAttempts: 2 });
  limiter.recordFailure('1.2.3.4', 'admin@local');
  limiter.recordSuccess('1.2.3.4', 'admin@local');
  limiter.recordFailure('1.2.3.4', 'admin@local');

  assert.equal(limiter.check('1.2.3.4', 'admin@local').allowed, true);
});
