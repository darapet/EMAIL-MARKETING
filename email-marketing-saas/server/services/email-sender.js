/**
 * server/services/email-sender.js
 * Multi-Provider Transactional Email Service
 *
 * Supported providers (per-user, configurable in Settings):
 *   - 'system'    → admin's Brevo key (default fallback)
 *   - 'brevo'     → user's own Brevo (Sendinblue) API key
 *   - 'sendgrid'  → user's own SendGrid API key
 *   - 'mailgun'   → user's own Mailgun API key + domain
 *   - 'smtp'      → user's own generic SMTP credentials
 *
 * Premium feature: using any provider other than 'system' requires plan = 'premium'.
 */

'use strict';

const SibApiV3Sdk = require('sib-api-v3-sdk');
const nodemailer  = require('nodemailer');
const sgMail      = require('@sendgrid/mail');
const Mailgun     = require('mailgun.js');
const FormData    = require('form-data');

// ─── HTML Email Builder ────────────────────────────────────────────────────────

/**
 * Build a professional red/white branded HTML email.
 * Merge fields: {businessName}, {niche}, {yourName}, {yourCompany}
 */
function buildHtml({
  subject,
  body,
  logoUrl       = '',
  signatureUrl  = '',
  phone         = '',
  company       = '',
  brandColor    = '#dc2626',
  businessName  = '',
  niche         = '',
  yourName      = '',
}) {
  const filledBody = (body || '')
    .replace(/{businessName}/g,  businessName || 'there')
    .replace(/{niche}/g,         niche        || 'your industry')
    .replace(/{yourName}/g,      yourName     || '')
    .replace(/{yourCompany}/g,   company      || '')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
  <style>
    body  { margin:0; background:#f4f4f7; font-family:'Helvetica Neue',Arial,sans-serif; }
    .outer{ padding:30px 16px; }
    .wrap { max-width:600px; margin:0 auto; background:#ffffff; border-radius:12px;
            overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.10); }
    .header{ background:${brandColor}; padding:28px 32px; text-align:center; }
    .header img{ max-height:60px; max-width:200px; object-fit:contain; }
    .header h1{ color:#ffffff; margin:12px 0 0; font-size:22px; font-weight:700; }
    .body  { padding:32px; color:#333333; font-size:15px; line-height:1.7; }
    .divider{ border:none; border-top:1px solid #f0f0f0; margin:24px 0; }
    .sig   { display:flex; align-items:center; gap:16px; margin-top:20px; }
    .sig img{ width:56px; height:56px; border-radius:50%; object-fit:cover;
              border:2px solid ${brandColor}; }
    .sig-info{ font-size:14px; color:#555; }
    .sig-name{ font-weight:700; color:#222; font-size:15px; }
    .footer{ background:#f9f9f9; padding:16px 32px; text-align:center;
             font-size:12px; color:#999; border-top:1px solid #eee; }
    a { color:${brandColor}; }
  </style>
</head>
<body>
<div class="outer">
  <div class="wrap">
    <div class="header">
      ${logoUrl ? `<img src="${logoUrl}" alt="${company} logo" />` : ''}
      ${!logoUrl && company ? `<h1>${company}</h1>` : ''}
    </div>
    <div class="body">
      ${filledBody}
      <hr class="divider" />
      <div class="sig">
        ${signatureUrl ? `<img src="${signatureUrl}" alt="signature" />` : ''}
        <div class="sig-info">
          ${yourName ? `<div class="sig-name">${yourName}</div>` : ''}
          ${company  ? `<div>${company}</div>` : ''}
          ${phone    ? `<div>📞 ${phone}</div>` : ''}
        </div>
      </div>
    </div>
    <div class="footer">
      You are receiving this email because your business matched our search criteria.<br/>
      <a href="#">Reply 'STOP' to opt out.</a>
    </div>
  </div>
</div>
</body>
</html>`;
}

// ─── Provider Senders ─────────────────────────────────────────────────────────

/** Send via Brevo (Sendinblue) SDK */
async function sendViaBrevo(apiKey, { fromName, fromEmail, toEmail, subject, htmlContent }) {
  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  defaultClient.authentications['api-key'].apiKey = apiKey;

  const api  = new SibApiV3Sdk.TransactionalEmailsApi();
  const mail = new SibApiV3Sdk.SendSmtpEmail();

  mail.sender  = { name: fromName, email: fromEmail };
  mail.to      = [{ email: toEmail }];
  mail.subject = subject;
  mail.htmlContent = htmlContent;

  return api.sendTransacEmail(mail);
}

/** Send via SendGrid */
async function sendViaSendGrid(apiKey, { fromName, fromEmail, toEmail, subject, htmlContent }) {
  sgMail.setApiKey(apiKey);
  return sgMail.send({
    from:    { name: fromName, email: fromEmail },
    to:      toEmail,
    subject,
    html:    htmlContent,
  });
}

/** Send via Mailgun */
async function sendViaMailgun(apiKey, domain, { fromName, fromEmail, toEmail, subject, htmlContent }) {
  const mg     = new Mailgun(FormData);
  const client = mg.client({ username: 'api', key: apiKey });
  return client.messages.create(domain, {
    from:    `${fromName} <${fromEmail}>`,
    to:      [toEmail],
    subject,
    html:    htmlContent,
  });
}

/** Send via generic SMTP (nodemailer) */
async function sendViaSmtp(config, { fromName, fromEmail, toEmail, subject, htmlContent }) {
  const transporter = nodemailer.createTransport({
    host:   config.host,
    port:   config.port || 587,
    secure: config.secure !== false,
    auth:   { user: config.user, pass: config.pass },
  });

  return transporter.sendMail({
    from:    `"${fromName}" <${fromEmail}>`,
    to:      toEmail,
    subject,
    html:    htmlContent,
  });
}

// ─── Main sendEmail ────────────────────────────────────────────────────────────

/**
 * @param {object} userProfile  - full profile row from Supabase
 * @param {object} options
 * @param {string} options.toEmail
 * @param {string} options.subject
 * @param {string} options.body       - raw text/HTML body with merge fields
 * @param {string} [options.businessName]
 * @param {string} [options.niche]
 * @param {string} [options.logoUrl]      - override template logo
 * @param {string} [options.signatureUrl] - override template signature
 * @param {string} [options.fromEmail]    - sender email (defaults to user's email)
 */
async function sendEmail(userProfile, options) {
  const {
    toEmail, subject, body,
    businessName = '',
    niche = '',
    logoUrl      = userProfile.logo_url       || '',
    signatureUrl = '',
    fromEmail    = userProfile.email,
    fromName     = userProfile.company || userProfile.name || 'LeadForge',
  } = options;

  const htmlContent = buildHtml({
    subject,
    body,
    logoUrl,
    signatureUrl,
    phone:      userProfile.phone   || '',
    company:    userProfile.company || fromName,
    brandColor: userProfile.brand_color || '#dc2626',
    businessName,
    niche,
    yourName:   userProfile.name    || '',
  });

  // Determine which SMTP provider to use
  const provider = userProfile.active_smtp || 'system';

  switch (provider) {
    case 'brevo': {
      const key = userProfile.brevo_api_key || process.env.BREVO_API_KEY;
      if (!key) throw new Error('No Brevo API key configured.');
      await sendViaBrevo(key, { fromName, fromEmail, toEmail, subject, htmlContent });
      break;
    }
    case 'sendgrid': {
      if (!userProfile.sendgrid_api_key) throw new Error('No SendGrid API key configured.');
      await sendViaSendGrid(userProfile.sendgrid_api_key, { fromName, fromEmail, toEmail, subject, htmlContent });
      break;
    }
    case 'mailgun': {
      if (!userProfile.mailgun_api_key || !userProfile.mailgun_domain) throw new Error('Mailgun API key and domain required.');
      await sendViaMailgun(userProfile.mailgun_api_key, userProfile.mailgun_domain, { fromName, fromEmail, toEmail, subject, htmlContent });
      break;
    }
    case 'smtp': {
      if (!userProfile.smtp_host || !userProfile.smtp_user) throw new Error('SMTP host and user required.');
      await sendViaSmtp(
        { host: userProfile.smtp_host, port: userProfile.smtp_port, secure: userProfile.smtp_secure, user: userProfile.smtp_user, pass: userProfile.smtp_pass },
        { fromName, fromEmail, toEmail, subject, htmlContent }
      );
      break;
    }
    case 'system':
    default: {
      const key = process.env.BREVO_API_KEY;
      if (!key) throw new Error('System Brevo API key not configured. Contact admin.');
      await sendViaBrevo(key, { fromName, fromEmail, toEmail, subject, htmlContent });
      break;
    }
  }

  return { provider, toEmail, subject };
}

module.exports = { sendEmail, buildHtml };
