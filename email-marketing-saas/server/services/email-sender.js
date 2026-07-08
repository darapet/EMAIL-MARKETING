/**
 * server/services/email-sender.js
 * Transactional Email via Brevo (Sendinblue) SDK
 *
 * Features:
 *  - Sends professional HTML email with logo, phone, company branding
 *  - Supports merge fields: {businessName}, {niche}, {yourName}, {yourCompany}
 *  - Automatic opt-out footer appended to every message
 *  - Per-user Brevo API key support (loaded from Firestore)
 *  - Sequential queue with configurable delay between sends
 */

'use strict';

const SibApiV3Sdk = require('sib-api-v3-sdk');
const { getDb }   = require('../config/firebase');

// ── Build HTML email ───────────────────────────────────────────────
function buildHtml({ subject, body, logoUrl, phone, company, brandColor = '#6366f1', businessName, niche, yourName }) {
  const filledBody = (body || '')
    .replace(/{businessName}/g, businessName || 'there')
    .replace(/{niche}/g,        niche        || 'your industry')
    .replace(/{yourName}/g,     yourName     || '')
    .replace(/{yourCompany}/g,  company      || '')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
  <style>
    body { margin:0; background:#f4f4f7; font-family:'Helvetica Neue',Arial,sans-serif; }
    .outer { padding: 30px 16px; }
    .wrap  { max-width:600px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.10); }
    .header { background:${brandColor}; padding:32px 40px; text-align:center; }
    .header img { max-height:52px; max-width:220px; display:block; margin:0 auto 16px; }
    .header h1  { color:#ffffff; font-size:22px; font-weight:700; margin:0; line-height:1.3; }
    .body   { padding:36px 40px; color:#333333; font-size:15px; line-height:1.75; }
    .body p { margin:0 0 16px; }
    .footer { background:#f9f9fb; border-top:1px solid #e8e8ef; padding:22px 40px; text-align:center; }
    .footer p { font-size:12px; color:#999999; margin:4px 0; }
    .footer a { color:${brandColor}; text-decoration:none; }
    .optout { font-size:11px; color:#bbbbbb; margin-top:12px; }
    @media (max-width:600px) {
      .header, .body, .footer { padding-left:20px; padding-right:20px; }
    }
  </style>
</head>
<body>
  <div class="outer">
    <div class="wrap">
      <div class="header">
        ${logoUrl ? `<img src="${logoUrl}" alt="${company} Logo" />` : ''}
        <h1>${subject}</h1>
      </div>
      <div class="body">
        <p>${filledBody}</p>
      </div>
      <div class="footer">
        <p><strong>${company || 'LeadForge'}</strong>${phone ? ` &middot; ${phone}` : ''}</p>
        <div class="optout">
          <p>You are receiving this because your business was identified as a potential match for our services.</p>
          <p>Reply <strong>STOP</strong> to opt out of future messages.</p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ── Send a single email ────────────────────────────────────────────
async function sendSingle({ brevoApiKey, to, subject, html, fromName, fromEmail }) {
  if (!brevoApiKey) throw new Error('Brevo API key not configured');

  const defaultClient   = SibApiV3Sdk.ApiClient.instance;
  const apiKeyAuth      = defaultClient.authentications['api-key'];
  apiKeyAuth.apiKey     = brevoApiKey;

  const apiInstance     = new SibApiV3Sdk.TransactionalEmailsApi();
  const sendSmtpEmail   = new SibApiV3Sdk.SendSmtpEmail();

  sendSmtpEmail.subject = subject;
  sendSmtpEmail.htmlContent = html;
  sendSmtpEmail.sender  = { name: fromName || 'LeadForge', email: fromEmail || 'noreply@leadforge.io' };
  sendSmtpEmail.to      = [{ email: to }];

  return apiInstance.sendTransacEmail(sendSmtpEmail);
}

// ── Campaign batch sender ──────────────────────────────────────────
async function startCampaign({
  userId,
  campaignId,
  leads,
  subject,
  bodyTemplate,
  userProfile,
  includeLogo  = true,
  includePhone = true,
  logoUrl,
}) {
  const db  = getDb();
  const io  = global._io;

  // Load Brevo API key from Firestore (user's personal key)
  let brevoApiKey = process.env.BREVO_API_KEY;
  if (db) {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists && userDoc.data().brevoApiKey) {
      brevoApiKey = userDoc.data().brevoApiKey;
    }
  }

  if (!brevoApiKey) {
    emitLog(io, userId, 'No Brevo API key configured. Add it in Settings → API Keys.', 'error');
    return;
  }

  const fromName  = userProfile.name    || 'LeadForge';
  const fromEmail = userProfile.email   || process.env.FROM_EMAIL || 'noreply@leadforge.io';
  const company   = userProfile.company || '';
  const phone     = includePhone ? (userProfile.phone || '') : '';
  const logo      = includeLogo  ? (logoUrl || '') : '';
  const color     = userProfile.brandColor || '#6366f1';

  emitLog(io, userId, `Starting email campaign to ${leads.length} leads...`);

  let sent = 0;
  let failed = 0;

  for (const lead of leads) {
    if (!lead.email) continue;

    const html = buildHtml({
      subject,
      body:       bodyTemplate,
      logoUrl:    logo,
      phone,
      company,
      brandColor: color,
      businessName: lead.businessName || '',
      niche:      lead.niche || '',
      yourName:   fromName,
    });

    try {
      await sendSingle({
        brevoApiKey,
        to:         lead.email,
        subject:    fillMergeFields(subject, lead, fromName),
        html,
        fromName,
        fromEmail,
      });

      sent++;
      emitLog(io, userId, `✓ Email sent to ${lead.email} (${sent}/${leads.length})`, 'success');

      // Log to Firestore
      if (db && lead.leadId) {
        await db.collection('outreach_logs').add({
          userId, campaignId, leadId: lead.leadId,
          type: 'email', subject, sentAt: new Date(),
        });

        // Update lead status
        await db.collection('campaigns').doc(campaignId)
          .collection('leads').doc(lead.leadId)
          .update({ emailSent: true, emailSentAt: new Date() });
      }

    } catch (err) {
      failed++;
      emitLog(io, userId, `⚠ Failed for ${lead.email}: ${err.message}`, 'warn');
    }

    // Respectful delay between sends (avoid spam flags)
    await sleep(1500 + Math.random() * 1000);
  }

  emitLog(io, userId, `✓ Email campaign complete — ${sent} sent, ${failed} failed`, 'success');
}

// ── Helpers ────────────────────────────────────────────────────────
function fillMergeFields(text, lead, yourName) {
  return (text || '')
    .replace(/{businessName}/g, lead.businessName || '')
    .replace(/{niche}/g,        lead.niche || '')
    .replace(/{yourName}/g,     yourName || '');
}

function emitLog(io, userId, text, type = 'info') {
  if (io) io.to(`user:${userId}`).emit('email_log', { text, type });
  console.log(`[Email][${userId}] ${text}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { buildHtml, sendSingle, startCampaign };
