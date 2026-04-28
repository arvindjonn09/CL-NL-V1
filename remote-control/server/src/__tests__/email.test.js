const assert = require('node:assert/strict');
const test = require('node:test');

const SMTP_ENV = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_SECURE',
  'SMTP_SSL',
  'SMTP_SERVER',
  'SMTP_USERNAME',
  'SMTP_PASSWORD',
  'MAIL_HOST',
  'MAIL_PORT',
  'MAIL_USER',
  'MAIL_USERNAME',
  'MAIL_PASS',
  'MAIL_PASSWORD',
  'MAIL_SECURE',
  'MAIL_SSL',
  'EMAIL_HOST',
  'EMAIL_PORT',
  'EMAIL_USER',
  'EMAIL_PASSWORD',
  'SMTP_FROM',
  'SMTP_FROM_NAME',
  'SMTP_FROM_EMAIL',
  'MAIL_FROM_NAME',
  'MAIL_FROM_EMAIL',
  'EMAIL_FROM_NAME',
  'EMAIL_FROM_ADDRESS',
  'EMAIL_FROM',
  'REMOTE_ACCESS_EMAIL_FROM',
  'RESEND_API_KEY',
  'REMOTE_ACCESS_RESEND_API_KEY',
];

function clearSmtpEnv() {
  for (const name of SMTP_ENV) {
    delete process.env[name];
  }
}

test('smtpConfig uses common SMTP environment variable names', () => {
  clearSmtpEnv();
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '465';
  process.env.SMTP_USER = 'setulink@example.com';
  process.env.SMTP_PASS = 'secret';

  delete require.cache[require.resolve('../email')];
  const { smtpConfig } = require('../email');

  assert.deepEqual(smtpConfig(), {
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    auth: {
      user: 'setulink@example.com',
      pass: 'secret',
    },
  });

  clearSmtpEnv();
});

test('smtpConfig accepts MAIL_* aliases and explicit non-secure mode', () => {
  clearSmtpEnv();
  process.env.MAIL_HOST = 'mail.example.com';
  process.env.MAIL_PORT = '587';
  process.env.MAIL_USERNAME = 'user';
  process.env.MAIL_PASSWORD = 'pass';
  process.env.MAIL_SECURE = 'false';

  delete require.cache[require.resolve('../email')];
  const { smtpConfig } = require('../email');

  assert.deepEqual(smtpConfig(), {
    host: 'mail.example.com',
    port: 587,
    secure: false,
    auth: {
      user: 'user',
      pass: 'pass',
    },
  });

  clearSmtpEnv();
});

test('emailFromAddress builds sender from SMTP_FROM_NAME and SMTP_FROM_EMAIL', () => {
  clearSmtpEnv();
  process.env.SMTP_FROM_NAME = 'Shivom Sangha Media';
  process.env.SMTP_FROM_EMAIL = 'admin@shivomsangha.com';

  delete require.cache[require.resolve('../email')];
  const { emailFromAddress } = require('../email');

  assert.equal(emailFromAddress(), 'Shivom Sangha Media <admin@shivomsangha.com>');

  clearSmtpEnv();
});

test('emailFromAddress falls back to SMTP_USER when only sender name is configured', () => {
  clearSmtpEnv();
  process.env.SMTP_USER = 'admin@shivomsangha.com';
  process.env.SMTP_FROM_NAME = 'Shivom Sangha Media';

  delete require.cache[require.resolve('../email')];
  const { emailFromAddress } = require('../email');

  assert.equal(emailFromAddress(), 'Shivom Sangha Media <admin@shivomsangha.com>');

  clearSmtpEnv();
});

test('passwordResetEmail notifies without exposing the new password', () => {
  clearSmtpEnv();
  delete require.cache[require.resolve('../email')];
  const { passwordResetEmail } = require('../email');

  const message = passwordResetEmail({
    email: 'user@example.com',
    displayName: 'User One',
    resetBy: 'admin@example.com',
  });

  assert.equal(message.to, 'user@example.com');
  assert.equal(message.subject, 'Your SetuLink password was reset');
  assert.match(message.text, /password was reset by admin@example.com/);
  assert.match(message.text, /sign in again with the new password provided by your administrator/);
  assert.doesNotMatch(message.text, /temporary password/i);

  clearSmtpEnv();
});

test('sendEmail stores message in outbox when no delivery provider is configured', async () => {
  clearSmtpEnv();
  delete require.cache[require.resolve('../email')];
  const { sendEmail } = require('../email');
  const inserts = [];
  const pool = {
    async query(sql, params) {
      assert.match(sql, /INSERT INTO email_outbox/);
      inserts.push(params);
      return { rowCount: 1, rows: [] };
    },
  };

  const result = await sendEmail(pool, {
    to: 'user@example.com',
    subject: 'Verification code',
    text: 'Your code is 1234',
    html: '<p>Your code is 1234</p>',
  });

  assert.deepEqual(result, { provider: 'outbox' });
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][1], 'user@example.com');
  assert.equal(inserts[0][2], 'Verification code');
  assert.equal(inserts[0][3], 'Your code is 1234');
  assert.equal(inserts[0][4], 'outbox');

  clearSmtpEnv();
});

test('sendEmail fails when smtp rejects the recipient', async () => {
  clearSmtpEnv();
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_USER = 'setulink@example.com';
  process.env.SMTP_PASS = 'secret';

  const nodemailer = require('nodemailer');
  const originalCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = () => ({
    async sendMail() {
      return {
        accepted: [],
        rejected: ['user@example.com'],
        pending: [],
        response: 'recipient rejected',
      };
    },
  });

  delete require.cache[require.resolve('../email')];
  const { sendEmail } = require('../email');

  try {
    await assert.rejects(
      sendEmail({ query: async () => assert.fail('outbox should not be used') }, {
        to: 'user@example.com',
        subject: 'Verification code',
        text: 'Your code is 1234',
        html: '<p>Your code is 1234</p>',
      }),
      /rejected verification recipient/
    );
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    clearSmtpEnv();
  }
});
