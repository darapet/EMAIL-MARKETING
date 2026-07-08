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
// Cross-campaign lead search (optional utility)
router.get('/', async (req, res, next) => {
  try {
    const { email, phone } = req.query;
    const db = getDb();
    if (!db) return res.json({ leads: [] });

    // Firestore collection group query across all leads subcollections
    let query = db.collectionGroup('leads');
    if (email) query = query.where('email', '==', email);
    if (phone) query = query.where('phone', '==', phone);
    query = query.limit(50);

    const snap  = await query.get();
    const leads = snap.docs.map(doc => ({ leadId: doc.id, campaignId: doc.ref.parent.parent.id, ...doc.data() }));
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
