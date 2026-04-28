const crypto = require('crypto');
const { requestIp, requestUserAgent } = require('../auth/sessions');
const { sendRemoteAccessVerificationEmail } = require('../email');

const CODE_TTL_SECONDS = Number(process.env.REMOTE_ACCESS_CODE_TTL_SECONDS || 5 * 60);
const RESEND_COOLDOWN_SECONDS = Number(process.env.REMOTE_ACCESS_RESEND_SECONDS || 60);
const MAX_CODE_ATTEMPTS = Number(process.env.REMOTE_ACCESS_CODE_ATTEMPTS || 5);

function hashCode(challengeId, email, code) {
  return crypto
    .createHash('sha256')
    .update([
      process.env.AUTH_SECRET || 'supersecret',
      challengeId,
      String(email || '').toLowerCase(),
      String(code || ''),
    ].join(':'))
    .digest('hex');
}

function generateVerificationCode() {
  return String(crypto.randomInt(0, 10_000)).padStart(4, '0');
}

function codeExpired(row, now = new Date()) {
  return new Date(row.expires_at).getTime() <= now.getTime();
}

async function issueVerificationCode(pool, user, req, options = {}) {
  const codeGenerator = options.codeGenerator || generateVerificationCode;
  const emailSender = options.emailSender || sendRemoteAccessVerificationEmail;
  const challengeId = crypto.randomUUID();
  const code = codeGenerator();
  const email = user.email;

  await pool.query(
    `
    INSERT INTO remote_access_verification_codes (
      id,
      email,
      code_hash,
      issued_at,
      expires_at,
      attempts,
      resend_available_at,
      ip,
      user_agent
    )
    VALUES ($1, $2, $3, NOW(), NOW() + ($4::text || ' seconds')::interval, 0, NOW() + ($5::text || ' seconds')::interval, $6, $7)
    `,
    [
      challengeId,
      email,
      hashCode(challengeId, email, code),
      CODE_TTL_SECONDS,
      RESEND_COOLDOWN_SECONDS,
      requestIp(req),
      requestUserAgent(req),
    ]
  );

  try {
    await emailSender(pool, {
      email,
      code,
      expiresMinutes: Math.ceil(CODE_TTL_SECONDS / 60),
    });
  } catch (err) {
    await pool.query(
      `
      DELETE FROM remote_access_verification_codes
      WHERE id = $1 AND consumed_at IS NULL
      `,
      [challengeId]
    );
    throw err;
  }

  await pool.query(
    `
    UPDATE remote_access_verification_codes
    SET consumed_at = COALESCE(consumed_at, NOW())
    WHERE email = $1 AND consumed_at IS NULL AND id <> $2
    `,
    [email, challengeId]
  );

  return {
    challengeId,
    email,
    expiresInSeconds: CODE_TTL_SECONDS,
    resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
  };
}

async function getChallenge(pool, challengeId) {
  const result = await pool.query(
    `
    SELECT *
    FROM remote_access_verification_codes
    WHERE id = $1
    LIMIT 1
    `,
    [challengeId]
  );
  return result.rows[0] || null;
}

async function verifyCode(pool, challengeId, code, now = new Date()) {
  const row = await getChallenge(pool, challengeId);
  if (!row || row.consumed_at) {
    return { ok: false, statusCode: 401, error: 'Invalid or expired verification code' };
  }

  if (codeExpired(row, now)) {
    return { ok: false, statusCode: 401, email: row.email, error: 'Invalid or expired verification code' };
  }

  if (Number(row.attempts || 0) >= MAX_CODE_ATTEMPTS) {
    return { ok: false, statusCode: 429, email: row.email, error: 'Too many verification attempts' };
  }

  const expected = hashCode(row.id, row.email, String(code || '').trim());
  if (expected !== row.code_hash) {
    await pool.query(
      `
      UPDATE remote_access_verification_codes
      SET attempts = attempts + 1
      WHERE id = $1
      `,
      [row.id]
    );
    return { ok: false, statusCode: 401, email: row.email, error: 'Invalid or expired verification code' };
  }

  await pool.query(
    `
    UPDATE remote_access_verification_codes
    SET consumed_at = NOW()
    WHERE id = $1
    `,
    [row.id]
  );

  return { ok: true, email: row.email };
}

async function canResend(pool, challengeId, now = new Date()) {
  const row = await getChallenge(pool, challengeId);
  if (!row || row.consumed_at || codeExpired(row, now)) {
    return { ok: false, statusCode: 401, error: 'Verification challenge expired' };
  }

  const resendAt = new Date(row.resend_available_at);
  if (resendAt.getTime() > now.getTime()) {
    return {
      ok: false,
      statusCode: 429,
      email: row.email,
      error: 'Wait before requesting another code',
      retryAfterSeconds: Math.ceil((resendAt.getTime() - now.getTime()) / 1000),
    };
  }

  return { ok: true, email: row.email };
}

module.exports = {
  CODE_TTL_SECONDS,
  MAX_CODE_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  canResend,
  generateVerificationCode,
  hashCode,
  issueVerificationCode,
  verifyCode,
};
