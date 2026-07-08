/**
 * server/routes/whatsapp.js
 * WhatsApp session REST endpoints
 * Real-time session events are handled via Socket.io in services/whatsapp-session.js
 */

'use strict';

const express = require('express');
const { requireAuth }      = require('../middleware/auth');
const waSessionManager     = require('../services/whatsapp-session');

const router = express.Router();
router.use(requireAuth);

/* ── GET /api/whatsapp/status ────────────────────────────────────── */
router.get('/status', (req, res) => {
  const session = waSessionManager.getSession(req.userId);
  return res.json({
    connected: session ? session.connected : false,
    phone:     session ? session.phone : null,
    name:      session ? session.name  : null,
  });
});

/* ── POST /api/whatsapp/disconnect ───────────────────────────────── */
router.post('/disconnect', async (req, res, next) => {
  try {
    await waSessionManager.disconnectUser(req.userId);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/* ── POST /api/whatsapp/broadcast ────────────────────────────────── */
router.post('/broadcast', async (req, res, next) => {
  try {
    const {
      campaignId,
      message,
      minDelay = 60,
      maxDelay = 180,
      source = 'campaign',
    } = req.body;

    if (!message) return res.status(400).json({ error: 'message is required' });

    const session = waSessionManager.getSession(req.userId);
    if (!session || !session.connected) {
      return res.status(400).json({ error: 'WhatsApp not connected for this user' });
    }

    // Kick off async broadcast (non-blocking)
    waSessionManager.startBroadcast({
      userId:     req.userId,
      campaignId,
      message,
      minDelay:   Math.max(10, Number(minDelay)),
      maxDelay:   Math.max(10, Number(maxDelay)),
      source,
    }).catch(err => console.error('[WA Broadcast] Error:', err.message));

    return res.json({ success: true, message: 'Broadcast queued' });
  } catch (err) {
    next(err);
  }
});

/* ── POST /api/whatsapp/send-single ─────────────────────────────── */
router.post('/send-single', async (req, res, next) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'phone and message are required' });
    }

    const session = waSessionManager.getSession(req.userId);
    if (!session || !session.connected) {
      return res.status(400).json({ error: 'WhatsApp not connected' });
    }

    await waSessionManager.sendMessage(req.userId, phone, message);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
