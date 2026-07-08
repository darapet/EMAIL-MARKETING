/**
 * server/routes/outreach.js
 * Email Outreach Pipeline
 *
 * Routes:
 *   POST /api/outreach/email          — send emails to all leads in a campaign
 *   POST /api/outreach/email/preview  — preview email HTML before sending
 *   GET  /api/outreach/history        — paginated send history
 *   GET  /api/outreach/stats          — aggregate send stats for the user
 *
 * Flow:
 *   1. Frontend scrapes → shows leads preview → user selects recipients
 *   2. User chooses SMTP provider (system vs own)
 *   3. POST /api/outreach/email is called with selected lead IDs
 *   4. Emails are sent one by one with delay, every send is recorded
 */

'use strict';

const express           = require('express');
const { getDb }         = require('../config/supabase');
const { requireAuth }   = require('../middleware/auth');
const { logActivity }   = require('../services/activity-logger');
const { sendEmail }     = require('../services/email-sender');

const SEND_DELAY_MS = parseInt(process.env.EMAIL_SEND_DELAY_MS || '1500'); // 1.5s between sends

const router = express.Router();
router.use(requireAuth);

// ─── POST /api/outreach/email ─────────────────────────────────────────────────
/**
 * Body:
 * {
 *   campaignId:  string,
 *   leadIds:     string[] | 'all',   // specific IDs or 'all'
 *   subject:     string,
 *   body:        string,
 *   templateId?: string,             // optional — use saved template
 *   provider?:   'system'|'brevo'|'sendgrid'|'mailgun'|'smtp',
 * }
 */
router.post('/email', async (req, res, next) => {
  try {
    const { campaignId, leadIds, subject, body, templateId, provider } = req.body;

    if (!campaignId || !subject || !body) {
      return res.status(400).json({ error: 'campaignId, subject, and body are required.' });
    }

    const db = getDb();

    // Load campaign (verify ownership)
    const { data: campaign, error: cErr } = await db
      .from('campaigns')
      .select('id,niche,user_id')
      .eq('id', campaignId)
      .eq('user_id', req.userId)
      .single();

    if (cErr || !campaign) return res.status(404).json({ error: 'Campaign not found.' });

    // Load user profile (includes SMTP keys, branding)
    const userProfile = { ...req.user };

    // If a specific provider is requested and user has permission, override active_smtp
    if (provider && provider !== userProfile.active_smtp) {
      // Only premium users can switch providers; admins always allowed
      if (userProfile.plan !== 'premium' && !userProfile.is_admin) {
        return res.status(403).json({
          error: 'Using your own SMTP provider requires a premium plan.',
          upgrade_required: true,
        });
      }
      userProfile.active_smtp = provider;
    }

    // Load template if provided
    let logoUrl = userProfile.logo_url || '';
    let signatureUrl = '';
    if (templateId) {
      const { data: tpl } = await db
        .from('email_templates')
        .select('logo_url,signature_url')
        .eq('id', templateId)
        .eq('user_id', req.userId)
        .single();
      if (tpl) {
        logoUrl      = tpl.logo_url      || logoUrl;
        signatureUrl = tpl.signature_url || '';
      }
    }

    // Load leads
    let leadQuery = db
      .from('leads')
      .select('id,business_name,email,phone')
      .eq('campaign_id', campaignId)
      .eq('opted_out', false)
      .not('email', 'is', null);

    if (Array.isArray(leadIds) && leadIds.length > 0) {
      leadQuery = leadQuery.in('id', leadIds);
    }

    const { data: leads, error: lErr } = await leadQuery;
    if (lErr) return res.status(400).json({ error: lErr.message });
    if (!leads?.length) return res.status(400).json({ error: 'No eligible leads found.' });

    // Respond immediately — send in background
    res.json({
      message: `Email campaign started. Sending to ${leads.length} lead(s).`,
      total:   leads.length,
      provider: userProfile.active_smtp || 'system',
    });

    // ── Background send loop ────────────────────────────────────────────────
    await logActivity(req.userId, 'email_blast_start', {
      campaignId,
      total:    leads.length,
      provider: userProfile.active_smtp,
    });

    let sentCount   = 0;
    let failedCount = 0;

    for (const lead of leads) {
      if (!lead.email) continue;

      let status   = 'sent';
      let errorMsg = null;

      try {
        await sendEmail(userProfile, {
          toEmail:      lead.email,
          subject,
          body,
          businessName: lead.business_name || '',
          niche:        campaign.niche      || '',
          logoUrl,
          signatureUrl,
        });
        sentCount++;
      } catch (err) {
        status   = 'failed';
        errorMsg = err.message;
        failedCount++;
        console.error(`[Outreach] Failed to send to ${lead.email}:`, err.message);
      }

      // Record every send
      await db.from('email_sends').insert({
        user_id:     req.userId,
        campaign_id: campaignId,
        lead_id:     lead.id,
        template_id: templateId || null,
        to_email:    lead.email,
        subject,
        status,
        provider:    userProfile.active_smtp || 'system',
        error_msg:   errorMsg,
      }).catch((e) => console.error('[Outreach] Failed to log send:', e.message));

      // Delay between sends to avoid rate-limiting
      await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
    }

    await logActivity(req.userId, 'email_blast_done', {
      campaignId,
      sent:   sentCount,
      failed: failedCount,
    });

    console.log(`[Outreach] Campaign ${campaignId}: ${sentCount} sent, ${failedCount} failed`);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/outreach/email/preview ────────────────────────────────────────
// Returns the rendered HTML email for preview in the browser (no send)
router.post('/email/preview', async (req, res, next) => {
  try {
    const { buildHtml } = require('../services/email-sender');
    const {
      subject, body,
      businessName = 'Acme Corp',
      niche        = 'Restaurant',
      logoUrl      = '',
      signatureUrl = '',
    } = req.body;

    if (!subject || !body) return res.status(400).json({ error: 'subject and body are required.' });

    const user = req.user;
    const html = buildHtml({
      subject, body,
      logoUrl:      logoUrl      || user.logo_url  || '',
      signatureUrl: signatureUrl || '',
      phone:        user.phone   || '',
      company:      user.company || user.name || 'LeadForge',
      brandColor:   user.brand_color || '#dc2626',
      businessName,
      niche,
      yourName:     user.name    || '',
    });

    return res.json({ html });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/outreach/history ────────────────────────────────────────────────
router.get('/history', async (req, res, next) => {
  try {
    const limit      = Math.min(parseInt(req.query.limit  || '50'), 200);
    const offset     = parseInt(req.query.offset || '0');
    const campaignId = req.query.campaign_id;

    const db = getDb();
    let query = db
      .from('email_sends')
      .select('id,to_email,subject,status,provider,error_msg,sent_at,campaign_id', { count: 'exact' })
      .eq('user_id', req.userId)
      .order('sent_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (campaignId) query = query.eq('campaign_id', campaignId);

    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });

    return res.json({ sends: data, total: count, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/outreach/stats ──────────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const db = getDb();

    const { data, error } = await db
      .from('email_sends')
      .select('status')
      .eq('user_id', req.userId);

    if (error) return res.status(400).json({ error: error.message });

    const stats = (data || []).reduce(
      (acc, row) => {
        acc.total++;
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      },
      { total: 0, sent: 0, failed: 0, bounced: 0, opted_out: 0 }
    );

    return res.json({ stats });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
