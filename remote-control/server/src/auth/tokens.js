const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SECRET = process.env.AUTH_SECRET || 'supersecret';
const ACCESS_TOKEN_SECONDS = Number(process.env.ADMIN_ACCESS_TOKEN_SECONDS || 15 * 60);
const REFRESH_TOKEN_SECONDS = Number(process.env.ADMIN_REFRESH_TOKEN_SECONDS || 7 * 24 * 60 * 60);

function signAccessToken(payload, options = {}) {
  return jwt.sign(payload, SECRET, {
    expiresIn: options.expiresIn || ACCESS_TOKEN_SECONDS,
  });
}

function verifyAccessToken(token) {
  try {
    return { valid: true, payload: jwt.verify(token, SECRET) };
  } catch (err) {
    return {
      valid: false,
      expired: err?.name === 'TokenExpiredError',
      error: err,
    };
  }
}

function createRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

module.exports = {
  ACCESS_TOKEN_SECONDS,
  REFRESH_TOKEN_SECONDS,
  createRefreshToken,
  hashToken,
  signAccessToken,
  verifyAccessToken,
};
