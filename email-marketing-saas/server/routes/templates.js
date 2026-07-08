/**
 * server/routes/templates.js
 * Email Template Management (up to 5 templates per user)
 *
 * Routes:
 *   GET    /api/templates          — list user's templates
 *   GET    /api/templates/:id      — single template
 *   POST   /api/templates          — create new template
 *   PUT    /api/templates/:id      — update template
 *   DELETE /api/templates/:id      — delete template
 *   PUT    /api/templates/:id/default — set as default template
 */

'use strict';

const express         = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb }       = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const MAX_TEMPLATES = 5;

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/templates ───────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const { data, error } = await db
      .from('email_templates')
      .select('id,name,subject,is_default,logo_url,signature_url,created_at,updated_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ templates: data });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/templates/:id ───────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const { data, error } = await db
      .from('email_templates')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Template not found.' });
    return res.json({ template: data });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/templates ──────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { name, subject, body, logo_url, signature_url, is_default } = req.body;

    if (!name || !subject || !body) {
      return res.status(400).json({ error: 'name, subject, and body are required.' });
    }

    const db = getDb();

    // Enforce 5-template limit
    const { count } = await db
      .from('email_templates')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId);

    if (count >= MAX_TEMPLATES) {
      return res.status(400).json({
        error: `You have reached the maximum of ${MAX_TEMPLATES} email templates. Delete one to add a new one.`,
      });
    }

    // If setting as default, unset others first
    if (is_default) {
      await db
        .from('email_templates')
        .update({ is_default: false })
        .eq('user_id', req.userId);
    }

    const { data, error } = await db
      .from('email_templates')
      .insert({
        id:            uuidv4(),
        user_id:       req.userId,
        name,
        subject,
        body,
        logo_url:      logo_url      || null,
        signature_url: signature_url || null,
        is_default:    is_default    || false,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ template: data });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/templates/:id ───────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['name', 'subject', 'body', 'logo_url', 'signature_url'];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided.' });
    }

    const db = getDb();
    const { data, error } = await db
      .from('email_templates')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Template not found.' });
    return res.json({ template: data });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/templates/:id ────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const { error } = await db
      .from('email_templates')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId);

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ message: 'Template deleted.' });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/templates/:id/default ──────────────────────────────────────────
router.put('/:id/default', async (req, res, next) => {
  try {
    const db = getDb();

    // Unset all defaults for this user
    await db
      .from('email_templates')
      .update({ is_default: false })
      .eq('user_id', req.userId);

    // Set the new default
    const { data, error } = await db
      .from('email_templates')
      .update({ is_default: true })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select('id,name,is_default')
      .single();

    if (error || !data) return res.status(404).json({ error: 'Template not found.' });
    return res.json({ message: 'Default template updated.', template: data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
