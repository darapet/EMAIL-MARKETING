/**
 * server/routes/schedule.js
 * Automation / Scheduled Sends
 *
 * Routes:
 *   GET    /api/schedule           — list scheduled sends for user
 *   POST   /api/schedule           — create a scheduled send (email or WhatsApp)
 *   PUT    /api/schedule/:id       — update schedule time or message
 *   DELETE /api/schedule/:id       — cancel a scheduled send
 */

'use strict';

const express         = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb }       = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../services/activity-logger');

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/schedule ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const { data, error } = await db
      .from('scheduled_sends')
      .select('*')
      .eq('user_id', req.userId)
      .order('scheduled_at', { ascending: true })
      .limit(100);

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ scheduled: data || [] });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/schedule ───────────────────────────────────────────────────────
/**
 * Body:
 * {
 *   type:         'email' | 'whatsapp',
 *   scheduled_at: ISO date string,        e.g. "2025-08-10T09:00:00"
 *   campaignId:   string | null,
 *   leadIds:      string[] | 'all',
 *   subject:      string,                 (email only)
 *   body:         string,
 *   provider:     'system'|'brevo'|...,   optional
 *   templateId:   string | null,          optional
 * }
 */
router.post('/', async (req, res, next) => {
  try {
    const { type = 'email', scheduled_at, campaignId, leadIds, subject, body, provider, templateId } = req.body;

    if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required (ISO date string).' });
    if (!body)         return res.status(400).json({ error: 'body / message is required.' });
    if (type === 'email' && !subject) return res.status(400).json({ error: 'subject is required for email schedules.' });

    const schedTime = new Date(scheduled_at);
    if (isNaN(schedTime.getTime()) || schedTime <= new Date()) {
      return res.status(400).json({ error: 'scheduled_at must be a valid future date/time.' });
    }

    const db = getDb();

    // Validate campaign ownership if provided
    if (campaignId) {
      const { data: camp } = await db.from('campaigns').select('id').eq('id', campaignId).eq('user_id', req.userId).single();
      if (!camp) return res.status(403).json({ error: 'Campaign not found or does not belong to you.' });
    }

    const { data, error } = await db
      .from('scheduled_sends')
      .insert({
        id:           uuidv4(),
        user_id:      req.userId,
        campaign_id:  campaignId || null,
        type,
        status:       'pending',
        scheduled_at: schedTime.toISOString(),
        subject:      subject || null,
        body,
        lead_ids:     Array.isArray(leadIds) ? leadIds : [],
        provider:     provider || 'system',
        template_id:  templateId || null,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await logActivity(req.userId, 'schedule_create', { type, scheduled_at, campaignId });
    return res.status(201).json({ scheduled: data });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/schedule/:id ────────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const { scheduled_at, subject, body, provider } = req.body;
    const updates = {};

    if (scheduled_at) {
      const schedTime = new Date(scheduled_at);
      if (isNaN(schedTime.getTime()) || schedTime <= new Date()) {
        return res.status(400).json({ error: 'scheduled_at must be a valid future date/time.' });
      }
      updates.scheduled_at = schedTime.toISOString();
    }
    if (subject)  updates.subject  = subject;
    if (body)     updates.body     = body;
    if (provider) updates.provider = provider;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    const db = getDb();
    const { data, error } = await db
      .from('scheduled_sends')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .eq('status', 'pending')   // can only edit pending schedules
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Scheduled send not found or already processed.' });
    return res.json({ scheduled: data });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/schedule/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const { error } = await db
      .from('scheduled_sends')
      .update({ status: 'cancelled' })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .eq('status', 'pending');

    if (error) return res.status(400).json({ error: error.message });
    await logActivity(req.userId, 'schedule_cancel', { id: req.params.id });
    return res.json({ message: 'Scheduled send cancelled.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
