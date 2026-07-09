/**
 * server/services/scheduler.js
 * Background scheduler — checks for pending scheduled sends every minute
 * and dispatches email / WhatsApp messages when their time arrives.
 *
 * Usage: call startScheduler(io) once from server/index.js
 */

'use strict';

const { getDb }       = require('../config/supabase');
const { sendEmail }   = require('./email-sender');
const { logActivity } = require('./activity-logger');

const CHECK_INTERVAL_MS = 60 * 1000; // check every 60 seconds

let _io     = null;
let _timer  = null;

function startScheduler(io) {
  _io = io;
  console.log('[Scheduler] Started — checking every 60 seconds');
  _timer = setInterval(runCheck, CHECK_INTERVAL_MS);
  runCheck(); // immediate first check
}

function stopScheduler() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

async function runCheck() {
  try {
    const db  = getDb();
    const now = new Date().toISOString();

    // Fetch all pending sends that are due
    const { data: due, error } = await db
      .from('scheduled_sends')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', now)
      .limit(20);

    if (error || !due?.length) return;

    console.log(`[Scheduler] ${due.length} scheduled send(s) due`);

    for (const job of due) {
      // Mark as running to avoid double-send
      const { error: lockErr } = await db
        .from('scheduled_sends')
        .update({ status: 'running' })
        .eq('id', job.id)
        .eq('status', 'pending');
      if (lockErr) continue; // another worker picked it up

      processJob(job).catch(err => {
        console.error(`[Scheduler] job ${job.id} failed:`, err.message);
      });
    }
  } catch (err) {
    console.error('[Scheduler] runCheck error:', err.message);
  }
}

async function processJob(job) {
  const db = getDb();

  try {
    // Load user profile
    const { data: profile } = await db
      .from('profiles')
      .select('*')
      .eq('id', job.user_id)
      .single();

    if (!profile) throw new Error('User profile not found');

    if (job.type === 'email') {
      await processEmailJob(job, profile, db);
    } else if (job.type === 'whatsapp') {
      await processWhatsAppJob(job, profile, db);
    }

    // Mark done
    await db
      .from('scheduled_sends')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', job.id);

    await logActivity(job.user_id, 'schedule_executed', { id: job.id, type: job.type });

    // Notify via socket
    if (_io) {
      _io.to(`user:${job.user_id}`).emit('schedule:done', { id: job.id, type: job.type });
    }

    console.log(`[Scheduler] job ${job.id} (${job.type}) executed OK`);
  } catch (err) {
    await db
      .from('scheduled_sends')
      .update({ status: 'failed', error_msg: err.message })
      .eq('id', job.id);
    console.error(`[Scheduler] job ${job.id} failed: ${err.message}`);
  }
}

async function processEmailJob(job, profile, db) {
  // Load leads
  let leadQuery = db
    .from('leads')
    .select('id,business_name,email,phone')
    .eq('user_id', job.user_id)
    .eq('opted_out', false)
    .not('email', 'is', null);

  if (job.campaign_id) leadQuery = leadQuery.eq('campaign_id', job.campaign_id);
  if (Array.isArray(job.lead_ids) && job.lead_ids.length > 0) {
    leadQuery = leadQuery.in('id', job.lead_ids);
  }

  const { data: leads } = await leadQuery;
  if (!leads?.length) {
    console.log(`[Scheduler] email job ${job.id}: no eligible leads`);
    return;
  }

  // Check daily limit
  const today = new Date().toDateString();
  const lastReset = profile.last_send_reset ? new Date(profile.last_send_reset).toDateString() : null;
  let sentToday = (lastReset === today) ? (profile.emails_sent_today || 0) : 0;
  const dailyLimit = profile.email_daily_limit || 300;

  // Load template if specified
  let logoUrl = profile.logo_url || '';
  let signatureUrl = profile.signature_url || '';
  if (job.template_id) {
    const { data: tpl } = await db
      .from('email_templates')
      .select('logo_url,signature_url')
      .eq('id', job.template_id)
      .eq('user_id', job.user_id)
      .single();
    if (tpl) { logoUrl = tpl.logo_url || logoUrl; signatureUrl = tpl.signature_url || signatureUrl; }
  }

  // Use rotating Brevo slots if available
  const brevoKeys = Array.isArray(profile.brevo_keys) ? profile.brevo_keys.filter(k => k.key) : [];
  let slotIdx = 0;

  let sentCount = 0;
  for (const lead of leads) {
    if (!lead.email) continue;
    if (sentToday >= dailyLimit) { console.log('[Scheduler] Daily limit reached'); break; }

    // Pick Brevo slot (rotate)
    const overrideProfile = { ...profile };
    if (brevoKeys.length > 0) {
      const slot = brevoKeys[slotIdx % brevoKeys.length];
      overrideProfile.brevo_api_key = slot.key;
      overrideProfile.active_smtp   = 'brevo';
      slotIdx++;
    }

    try {
      await sendEmail(overrideProfile, {
        toEmail:      lead.email,
        subject:      job.subject,
        body:         job.body,
        logoUrl,
        signatureUrl,
        businessName: lead.business_name || '',
        niche:        '',
      });
      sentToday++;
      sentCount++;
      await db.from('email_sends').insert({
        user_id:     job.user_id,
        campaign_id: job.campaign_id || null,
        to_email:    lead.email,
        subject:     job.subject,
        status:      'sent',
        provider:    overrideProfile.active_smtp || 'system',
        sent_at:     new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[Scheduler] email to ${lead.email} failed:`, err.message);
    }

    await delay(1500);
  }

  // Update sent counter
  await db.from('profiles').update({
    emails_sent_today: sentToday,
    last_send_reset:   new Date().toISOString().slice(0, 10),
  }).eq('id', job.user_id);

  console.log(`[Scheduler] email job ${job.id}: sent ${sentCount} emails`);
}

async function processWhatsAppJob(job, profile, db) {
  // Find active WhatsApp session
  const waSessionManager = require('./whatsapp-session');
  const sock = waSessionManager.getSession(job.user_id);
  if (!sock) throw new Error('No active WhatsApp session for user.');

  let leadQuery = db
    .from('leads')
    .select('id,business_name,phone')
    .eq('user_id', job.user_id)
    .eq('opted_out', false)
    .not('phone', 'is', null);

  if (job.campaign_id) leadQuery = leadQuery.eq('campaign_id', job.campaign_id);
  if (Array.isArray(job.lead_ids) && job.lead_ids.length > 0) {
    leadQuery = leadQuery.in('id', job.lead_ids);
  }

  const { data: leads } = await leadQuery;
  if (!leads?.length) return;

  let sentCount = 0;
  for (const lead of leads) {
    if (!lead.phone) continue;
    try {
      const jid  = lead.phone.replace(/\D/g, '') + '@s.whatsapp.net';
      const text = (job.body || '').replace(/{businessName}/g, lead.business_name || 'there');
      await sock.sendPresenceUpdate('composing', jid);
      await delay(2000 + Math.random() * 2000);
      await sock.sendMessage(jid, { text });
      sentCount++;
    } catch (err) {
      console.error(`[Scheduler] WA to ${lead.phone} failed:`, err.message);
    }
    // Anti-ban jitter
    await delay(60000 + Math.random() * 120000);
  }
  console.log(`[Scheduler] WA job ${job.id}: sent ${sentCount} messages`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { startScheduler, stopScheduler };
