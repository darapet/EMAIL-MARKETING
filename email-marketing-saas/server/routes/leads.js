/**
 * server/routes/leads.js
 * Lead management — update status, opt-out handling
 */

'use strict';

const express = require('express');
const { getDb }       = require('../config/firebase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/* ── GET /api/leads ──────────────────────────────────────────────── */
// Cross-campaign lead search — scoped strictly to the caller's own campaigns
router.get('/', async (req, res, next) => {
  try {
    const { email, phone } = req.query;
    const db = getDb();
    if (!db) return res.json({ leads: [] });

    // First, fetch all campaign IDs that belong to this user
    const campaignSnap = await db.collection('campaigns')
      .where('userId', '==', req.userId)
      .select() // fetch doc refs only — no field data needed
      .get();

    if (campaignSnap.empty) return res.json({ leads: [] });

    // Run per-campaign lead queries (collection-group would expose other tenants)
    const leadPromises = campaignSnap.docs.map(async (campaignDoc) => {
      let q = db.collection('campaigns').doc(campaignDoc.id).collection('leads');
      if (email) q = q.where('email', '==', email);
      if (phone) q = q.where('phone', '==', phone);
      const snap = await q.limit(20).get();
      return snap.docs.map(d => ({ leadId: d.id, campaignId: campaignDoc.id, ...d.data() }));
    });

    const nested = await Promise.all(leadPromises);
    const leads  = nested.flat().slice(0, 200); // cap response size
    return res.json({ leads });
  } catch (err) {
    next(err);
  }
});

/* ── PATCH /api/leads/:campaignId/:leadId ────────────────────────── */
router.patch('/:campaignId/:leadId', async (req, res, next) => {
  try {
    const { campaignId, leadId } = req.params;
    const updates = req.body;

    // Validate fields
    const allowed = ['status', 'email', 'phone', 'businessName', 'waVerified', 'notes'];
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([k]) => allowed.includes(k))
    );

    const db = getDb();
    if (!db) return res.json({ success: true });

    // Ownership check via campaign
    const campaignDoc = await db.collection('campaigns').doc(campaignId).get();
    if (!campaignDoc.exists || campaignDoc.data().userId !== req.userId) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    await db.collection('campaigns').doc(campaignId)
      .collection('leads').doc(leadId)
      .update({ ...filtered, updatedAt: new Date() });

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/* ── POST /api/leads/:campaignId/:leadId/optout ──────────────────── */
// Called automatically when incoming WA message contains "STOP"
router.post('/:campaignId/:leadId/optout', async (req, res, next) => {
  try {
    const { campaignId, leadId } = req.params;
    const db = getDb();
    if (!db) return res.json({ success: true });

    await db.collection('campaigns').doc(campaignId)
      .collection('leads').doc(leadId)
      .update({ status: 'optout', optedOutAt: new Date() });

    // Log outreach record
    await db.collection('outreach_logs').add({
      userId:     req.userId,
      campaignId,
      leadId,
      type:       'optout',
      sentAt:     new Date(),
    });

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
