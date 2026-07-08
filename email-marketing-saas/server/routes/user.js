/**
 * server/routes/user.js
 * User profile, branding, and API key management
 */

'use strict';

const express = require('express');
const { getDb }       = require('../config/firebase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/* ── GET /api/user/profile ───────────────────────────────────────── */
router.get('/profile', async (req, res, next) => {
  try {
    const db = getDb();
    if (!db) return res.json({ userId: req.userId });

    const doc = await db.collection('users').doc(req.userId).get();
    if (!doc.exists) return res.json({ userId: req.userId });

    // Never send sensitive fields to client
    const { brevoApiKey: _bk, firebaseConfig: _fc, ...safeData } = doc.data();
    return res.json({ userId: req.userId, ...safeData });
  } catch (err) {
    next(err);
  }
});

/* ── PUT /api/user/profile ───────────────────────────────────────── */
router.put('/profile', async (req, res, next) => {
  try {
    const allowed = ['name', 'email', 'company', 'phone', 'desc', 'logoUrl', 'brandColor'];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );

    const db = getDb();
    if (db) {
      await db.collection('users').doc(req.userId).set(
        { ...updates, updatedAt: new Date() },
        { merge: true }
      );
    }

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/* ── PUT /api/user/apikeys ───────────────────────────────────────── */
router.put('/apikeys', async (req, res, next) => {
  try {
    const { brevoApiKey } = req.body;
    if (!brevoApiKey) return res.status(400).json({ error: 'brevoApiKey is required' });

    // Store server-side only — never returned to client
    const db = getDb();
    if (db) {
      await db.collection('users').doc(req.userId).set(
        { brevoApiKey, apiKeysUpdatedAt: new Date() },
        { merge: true }
      );
    }

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
