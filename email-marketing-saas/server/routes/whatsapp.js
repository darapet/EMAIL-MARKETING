/**
 * server/routes/whatsapp.js
 * WhatsApp session management + bulk outreach via Baileys
 *
 * Routes:
 *   GET  /api/whatsapp/status          — check session status
 *   POST /api/whatsapp/connect         — initiate connection (triggers QR via Socket.io)
 *   POST /api/whatsapp/disconnect      — disconnect session
 *   POST /api/whatsapp/send            — send bulk WhatsApp messages to campaign leads
 *   GET  /api/whatsapp/contacts        — list WA contacts from active session
 */

'use strict';

const express             = require('express');
const { getDb }           = require('../config/supabase');
const { requireAuth }     = require('../middleware/auth');
const { logActivity }     = require('../services/activity-logger');
const waSessionManager    = require('../services/whatsapp-session');

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/whatsapp/status ─────────────────────────────────────────────────
router.get('/status', async (req, res, next) => {
  try {
    const db = getDb();
    const { data } = await db
      .from('whatsapp_sessions')
      .select('is_active,phone_number,connected_at')
      .eq('user_id', req.userId)
      .single();

    const inMemory = waSessionManager.isActive(req.userId);

    return res.json({
      is_active:    inMemory || data?.is_active || false,
      phone_number: data?.phone_number || null,
      connected_at: data?.connected_at  || null,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/whatsapp/connect ───────────────────────────────────────────────
// Triggers QR generation — client receives QR via Socket.io event 'wa:qr'
router.post('/connect', async (req, res, next) => {
  try {
    if (!req.io) return res.status(500).json({ error: 'Socket.io not available.' });

    await waSessionManager.initSession(req.userId, req.io);
    await logActivity(req.userId, 'wa_connect_init');

    return res.json({ message: 'WhatsApp connection initiated. Scan the QR code in the app.' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/whatsapp/disconnect ───────────────────────────────────────────
router.post('/disconnect', async (req, res, next) => {
  try {
    await waSessionManager.destroySession(req.userId);

    const db = getDb();
    await db
      .from('whatsapp_sessions')
      .update({ is_active: false })
      .eq('user_id', req.userId);

    await logActivity(req.userId, 'wa_disconnect');
    return res.json({ message: 'WhatsApp session disconnected.' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/whatsapp/send ──────────────────────────────────────────────────
/**
 * Body:
 * {
 *   campaignId: string,
 *   leadIds:    string[] | 'all',
 *   message:    string,              // with merge field {businessName}
 *   useContacts?: boolean,           // send to phone contact list instead
 * }
 *
 * Messages are queued with random jitter (60–180s) between each send (anti-ban).
 */
router.post('/send', async (req, res, next) => {
  try {
    const { campaignId, leadIds, message, useContacts } = req.body;

    if (!message) return res.status(400).json({ error: 'message is required.' });
    if (!campaignId && !useContacts) return res.status(400).json({ error: 'campaignId or useContacts required.' });

    const sock = waSessionManager.getSession(req.userId);
    if (!sock) {
      return res.status(400).json({ error: 'No active WhatsApp session. Please connect first.' });
    }

    const db = getDb();
    let leads = [];

    if (!useContacts) {
      // Load from campaign leads
      const { data: camp } = await db
        .from('campaigns')
        .select('id,niche')
        .eq('id', campaignId)
        .eq('user_id', req.userId)
        .single();

      if (!camp) return res.status(404).json({ error: 'Campaign not found.' });

      let q = db
        .from('leads')
        .select('id,business_name,phone,email')
        .eq('campaign_id', campaignId)
        .eq('opted_out', false)
        .not('phone', 'is', null);

      if (Array.isArray(leadIds) && leadIds.length > 0) q = q.in('id', leadIds);

      const { data } = await q;
      leads = data || [];
    }

    if (!leads.length && !useContacts) {
      return res.status(400).json({ error: 'No leads with phone numbers found.' });
    }

    res.json({
      message:   `WhatsApp blast started for ${useContacts ? 'phone contacts' : leads.length + ' leads'}.`,
      total:     leads.length,
    });

    // ── Background send ───────────────────────────────────────────────────────
    await logActivity(req.userId, 'wa_blast_start', { campaignId, total: leads.length });

    const sendTargets = useContacts
      ? Object.values(sock.contacts || {}).filter((c) => c.notify).slice(0, 200)
      : leads;

    for (const lead of sendTargets) {
      const phone       = lead.phone || lead.id;
      const bizName     = lead.business_name || lead.notify || '';
      const filledMsg   = message.replace(/{businessName}/g, bizName);
      const jid         = phone.replace(/\D/g, '') + '@s.whatsapp.net';

      // Random jitter 60–180 seconds (anti-ban)
      const jitter = 60_000 + Math.random() * 120_000;

      try {
        // Simulate typing for 2–5 seconds before sending
        await sock.sendPresenceUpdate('composing', jid);
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
        await sock.sendPresenceUpdate('paused', jid);

        await sock.sendMessage(jid, { text: filledMsg + '\n\nReply STOP to opt out.' });

        await logActivity(req.userId, 'wa_message_sent', { jid, campaignId });
      } catch (err) {
        console.error(`[WA] Failed to send to ${jid}:`, err.message);
        await logActivity(req.userId, 'wa_message_failed', { jid, error: err.message });
      }

      await new Promise((r) => setTimeout(r, jitter));
    }

    await logActivity(req.userId, 'wa_blast_done', { campaignId, total: sendTargets.length });
    console.log(`[WA] Blast done for campaign ${campaignId}`);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/whatsapp/contacts ───────────────────────────────────────────────
router.get('/contacts', async (req, res, next) => {
  try {
    const sock = waSessionManager.getSession(req.userId);
    if (!sock) {
      return res.status(400).json({ error: 'No active WhatsApp session.' });
    }

    const contacts = Object.values(sock.contacts || {})
      .filter((c) => c.notify)
      .map((c) => ({ name: c.notify, phone: c.id?.split('@')[0] || '' }))
      .slice(0, 500);

    return res.json({ contacts });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
