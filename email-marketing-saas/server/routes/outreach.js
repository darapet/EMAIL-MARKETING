/**
 * server/routes/outreach.js
 * Email outreach pipeline via Brevo Transactional SMTP
 */

'use strict';

const express  = require('express');
const { getDb }       = require('../config/firebase');
const { requireAuth } = require('../middleware/auth');
const emailService    = require('../services/email-sender');

const router = express.Router();
router.use(requireAuth);

/* ── POST /api/outreach/email ────────────────────────────────────── */
// Launch email campaign for all leads in a campaign
router.post('/email', async (req, res, next) => {
  try {
    const {
      campaignId,
      subject,
      body,
      includeLogo  = true,
      includePhone = true,
      logoUrl      = '',
    } = req.body;

    if (!campaignId || !subject || !body) {
      return res.status(400).json({ error: 'campaignId, subject, and body are required' });
    }

    // Load user profile for merge fields
    const db = getDb();
    let userProfile = {};
    if (db) {
      const userDoc = await db.collection('users').doc(req.userId).get();
      if (userDoc.exists) userProfile = userDoc.data();
    }

    // ── Ownership check — must own the campaign ──────────────────
    if (db) {
      const campaignDoc = await db.collection('campaigns').doc(campaignId).get();
      if (!campaignDoc.exists || campaignDoc.data().userId !== req.userId) {
        return res.status(403).json({ error: 'Campaign not found or access denied' });
      }
    }

    // Load leads with email addresses (scoped to verified campaign)
    let leads = [];
    if (db) {
      const snap = await db
        .collection('campaigns').doc(campaignId)
        .collection('leads')
        .where('status', '!=', 'optout')
        .get();
      leads = snap.docs
        .map(d => ({ leadId: d.id, ...d.data() }))
        .filter(l => l.email);
    }

    if (!leads.length) {
      return res.status(400).json({ error: 'No leads with email addresses found in this campaign' });
    }

    // Queue async sends (non-blocking)
    emailService.startCampaign({
      userId:      req.userId,
      campaignId,
      leads,
      subject,
      bodyTemplate: body,
      userProfile,
      includeLogo,
      includePhone,
      logoUrl:     logoUrl || userProfile.logoUrl || '',
    }).catch(err => console.error('[Email Campaign] Error:', err.message));

    return res.json({ success: true, queued: leads.length });
  } catch (err) {
    next(err);
  }
});

/* ── POST /api/outreach/test-email ───────────────────────────────── */
router.post('/test-email', async (req, res, next) => {
  try {
    const { to, subject, html } = req.body;
    if (!to || !subject || !html) {
      return res.status(400).json({ error: 'to, subject, and html are required' });
    }

    // Load user's Brevo API key
    const db = getDb();
    let brevoApiKey = process.env.BREVO_API_KEY;
    if (db) {
      const userDoc = await db.collection('users').doc(req.userId).get();
      if (userDoc.exists && userDoc.data().brevoApiKey) {
        brevoApiKey = userDoc.data().brevoApiKey;
      }
    }

    await emailService.sendSingle({
      brevoApiKey,
      to,
      subject,
      html,
      fromName:  'LeadForge Test',
      fromEmail: process.env.FROM_EMAIL || 'noreply@leadforge.io',
    });

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/* ── GET /api/outreach/logs ──────────────────────────────────────── */
router.get('/logs', async (req, res, next) => {
  try {
    const db = getDb();
    if (!db) return res.json({ logs: [] });

    const snap = await db.collection('outreach_logs')
      .where('userId', '==', req.userId)
      .orderBy('sentAt', 'desc')
      .limit(200)
      .get();

    const logs = snap.docs.map(d => ({ logId: d.id, ...d.data() }));
    return res.json({ logs });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
