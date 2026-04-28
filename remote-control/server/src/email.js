const crypto = require('crypto');
const nodemailer = require('nodemailer');

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function boolEnv(...names) {
  const value = firstEnv(...names).toLowerCase();
  if (!value) return null;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function emailFromAddress() {
  const configured = firstEnv('REMOTE_ACCESS_EMAIL_FROM', 'EMAIL_FROM', 'SMTP_FROM');
  if (configured) return configured;

  const fromEmail = firstEnv(
    'SMTP_FROM_EMAIL',
    'MAIL_FROM_EMAIL',
    'EMAIL_FROM_ADDRESS',
    'SMTP_USER',
    'SMTP_USERNAME',
    'MAIL_USER',
    'MAIL_USERNAME',
    'EMAIL_USER'
  );
  const fromName = firstEnv('SMTP_FROM_NAME', 'MAIL_FROM_NAME', 'EMAIL_FROM_NAME');
  if (fromEmail && fromName) return `${fromName} <${fromEmail}>`;
  if (fromEmail) return fromEmail;

  return 'NetraLink <no-reply@netralink.local>';
}

function smtpConfig() {
  const host = firstEnv('SMTP_HOST', 'SMTP_SERVER', 'MAIL_HOST', 'EMAIL_HOST');
  const portRaw = firstEnv('SMTP_PORT', 'MAIL_PORT', 'EMAIL_PORT');
  const user = firstEnv('SMTP_USER', 'SMTP_USERNAME', 'MAIL_USER', 'MAIL_USERNAME', 'EMAIL_USER');
  const pass = firstEnv('SMTP_PASS', 'SMTP_PASSWORD', 'MAIL_PASS', 'MAIL_PASSWORD', 'EMAIL_PASSWORD');

  if (!host) return null;

  const port = Number(portRaw || 587);
  const secure = boolEnv('SMTP_SECURE', 'SMTP_SSL', 'MAIL_SECURE', 'MAIL_SSL');

  return {
    host,
    port,
    secure: secure === null ? port === 465 : secure,
    auth: user || pass ? { user, pass } : undefined,
  };
}

function verificationEmail({ email, code, expiresMinutes }) {
  return {
    to: email,
    subject: 'Your NetraLink remote access code',
    text: [
      `Your NetraLink remote access verification code is ${code}.`,
      '',
      `This code expires in ${expiresMinutes} minutes.`,
      'If you did not request this code, ignore this email.',
    ].join('\n'),
    html: [
      '<p>Your NetraLink remote access verification code is:</p>',
      `<p style="font-size: 24px; font-weight: 700; letter-spacing: 4px;">${code}</p>`,
      `<p>This code expires in ${expiresMinutes} minutes.</p>`,
      '<p>If you did not request this code, ignore this email.</p>',
    ].join(''),
  };
}

function passwordResetEmail({ email, displayName, resetBy }) {
  const name = String(displayName || email || 'there').trim();
  const adminLine = resetBy ? ` by ${resetBy}` : '';
  return {
    to: email,
    subject: 'Your NetraLink password was reset',
    text: [
      `Hi ${name},`,
      '',
      `Your NetraLink account password was reset${adminLine}.`,
      'Your existing NetraLink sessions were revoked, so please sign in again with the new password provided by your administrator.',
      '',
      'If you did not expect this reset, contact your administrator immediately.',
    ].join('\n'),
    html: [
      `<p>Hi ${name},</p>`,
      `<p>Your NetraLink account password was reset${adminLine}.</p>`,
      '<p>Your existing NetraLink sessions were revoked, so please sign in again with the new password provided by your administrator.</p>',
      '<p>If you did not expect this reset, contact your administrator immediately.</p>',
    ].join(''),
  };
}

function redactEmail(value) {
  return String(value || '').replace(/^(.).+(@.+)$/, '$1***$2');
}

function redactEmailList(values) {
  return Array.isArray(values) ? values.map(redactEmail) : [];
}

async function sendEmail(pool, message) {
  const emailFrom = emailFromAddress();
  const smtp = smtpConfig();
  const resendApiKey = firstEnv('RESEND_API_KEY', 'REMOTE_ACCESS_RESEND_API_KEY');
  if (smtp) {
    const transporter = nodemailer.createTransport(smtp);
    const info = await transporter.sendMail({
      from: emailFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    console.info('email delivery accepted by smtp', {
      to: redactEmail(message.to),
      accepted: redactEmailList(info.accepted),
      rejected: redactEmailList(info.rejected),
      pending: redactEmailList(info.pending),
      response: info.response || null,
      messageIdPresent: Boolean(info.messageId),
    });
    if (Array.isArray(info.rejected) && info.rejected.length > 0) {
      throw new Error('email provider rejected verification recipient');
    }
    return { provider: 'smtp' };
  }

  if (resendApiKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });

    if (!response.ok) {
      throw new Error(`email provider failed with status ${response.status}`);
    }
    return { provider: 'resend' };
  }

  await pool.query(
    `
    INSERT INTO email_outbox (id, recipient, subject, body, provider)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [
      crypto.randomUUID(),
      message.to,
      message.subject,
      message.text,
      'outbox',
    ]
  );
  console.warn('email delivery is not configured; verification email stored in email_outbox');
  return { provider: 'outbox' };
}

async function sendRemoteAccessVerificationEmail(pool, { email, code, expiresMinutes }) {
  return sendEmail(pool, verificationEmail({ email, code, expiresMinutes }));
}

async function sendPasswordResetConfirmationEmail(pool, { email, displayName, resetBy }) {
  return sendEmail(pool, passwordResetEmail({ email, displayName, resetBy }));
}

module.exports = {
  sendEmail,
  sendPasswordResetConfirmationEmail,
  sendRemoteAccessVerificationEmail,
  emailFromAddress,
  passwordResetEmail,
  smtpConfig,
  verificationEmail,
};
