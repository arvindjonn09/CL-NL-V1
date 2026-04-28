function createLoginRateLimiter(options = {}) {
  const maxAttempts = options.maxAttempts || 5;
  const windowMs = options.windowMs || 10 * 60 * 1000;
  const cooldownMs = options.cooldownMs || 15 * 60 * 1000;
  const now = options.now || (() => Date.now());
  const attempts = new Map();

  function keyFor(type, value) {
    return `${type}:${String(value || 'unknown').toLowerCase()}`;
  }

  function getState(key) {
    const state = attempts.get(key);
    const current = now();
    if (!state || current - state.firstAt > windowMs) {
      return { count: 0, firstAt: current, lockedUntil: 0 };
    }
    return state;
  }

  function check(ip, identity) {
    for (const key of [keyFor('ip', ip), keyFor('identity', identity)]) {
      const state = getState(key);
      if (state.lockedUntil && state.lockedUntil > now()) {
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil((state.lockedUntil - now()) / 1000),
        };
      }
    }
    return { allowed: true };
  }

  function recordFailure(ip, identity) {
    for (const key of [keyFor('ip', ip), keyFor('identity', identity)]) {
      const state = getState(key);
      state.count += 1;
      if (state.count >= maxAttempts) {
        state.lockedUntil = now() + cooldownMs;
      }
      attempts.set(key, state);
    }
  }

  function recordSuccess(ip, identity) {
    attempts.delete(keyFor('ip', ip));
    attempts.delete(keyFor('identity', identity));
  }

  return {
    check,
    recordFailure,
    recordSuccess,
  };
}

module.exports = {
  createLoginRateLimiter,
};
