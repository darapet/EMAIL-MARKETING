/**
 * server/routes/campaigns.js
 * CRUD for Scraping Campaigns + launch trigger
 */

'use strict';

const express  = require('express');
const { v4: uuidv4 }  = require('uuid');
const { getDb }        = require('../config/firebase');
const { requireAuth }  = require('../middleware/auth');
const scraperService   = require('../services/scraper');

const router = express.Router();
router.use(requireAuth);

/* ── GET /api/campaigns ──────────────────────────────────────────── */
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    if (!db) return res.json({ campaigns: [] }); // demo mode

    const snap = await db.collection('campaigns')
      .where('userId', '==', req.userId)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const campaigns = snap.docs.map(doc => ({ campaignId: doc.id, ...doc.data() }));
    return res.json({ campaigns });
  } catch (err) {
    next(err);
  }
});

/* ── GET /api/campaigns/:id ──────────────────────────────────────── */
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Firebase not configured' });

    const doc = await db.collection('campaigns').doc(req.params.id).get();
    if (!doc.exists || doc.data().userId !== req.userId) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    return res.json({ campaignId: doc.id, ...doc.data() });
  } catch (err) {
    next(err);
  }
});

/* ── POST /api/campaigns ─────────────────────────────────────────── */
router.post('/', async (req, res, next) => {
  try {
    const { name, niche, depth = 2, channels = [], locations = [] } = req.body;

    if (!name || !niche) {
      return res.status(400).json({ error: 'name and niche are required' });
    }

    const campaignId = uuidv4();
    const campaign   = {
      campaignId,
      userId:     req.userId,
      name:       name.trim(),
      niche:      niche.trim(),
      depth,
      channels,
      locations,
      status:     'running',
      leadsCount: 0,
      createdAt:  new Date(),
    };

    const db = getDb();
    if (db) {
      await db.collection('campaigns').doc(campaignId).set(campaign);
    }

    // Kick off background scraper (non-blocking)
    scraperService.run({ campaignId, userId: req.userId, niche, depth, channels, locations })
      .catch(err => console.error('[Scraper] Error:', err.message));

    return res.status(201).json(campaign);
  } catch (err) {
    next(err);
  }
});

/* ── DELETE /api/campaigns/:id ───────────────────────────────────── */
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Firebase not configured' });

    const docRef = db.collection('campaigns').doc(req.params.id);
    const doc    = await docRef.get();
    if (!doc.exists || doc.data().userId !== req.userId) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    await docRef.delete();
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/* ── GET /api/campaigns/:id/leads ────────────────────────────────── */
router.get('/:id/leads', async (req, res, next) => {
  try {
    const db = getDb();
    if (!db) return res.json({ leads: [] });

    // Verify ownership
    const campaignDoc = await db.collection('campaigns').doc(req.params.id).get();
    if (!campaignDoc.exists || campaignDoc.data().userId !== req.userId) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const snap = await db
      .collection('campaigns').doc(req.params.id)
      .collection('leads')
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();

    const leads = snap.docs.map(doc => ({ leadId: doc.id, ...doc.data() }));
    return res.json({ leads });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
