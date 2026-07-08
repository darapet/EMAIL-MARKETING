/**
 * server/routes/leads.js
 * Lead management
 *
 * Routes:
 *   GET  /api/leads                      — list leads (filter by campaignId, email, opted_out)
 *   GET  /api/leads/:id                  — single lead
 *   POST /api/leads/opt-out              — mark a lead as opted out
 */

'use strict';

const express         = require('express');
const { getDb }       = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/leads ───────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { campaign_id, opted_out, search, limit = '100', offset = '0' } = req.query;

    const db = getDb();
    let query = db
      .from('leads')
      .select('*', { count: 'exact' })
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (campaign_id) query = query.eq('campaign_id', campaign_id);
    if (opted_out !== undefined) query = query.eq('opted_out', opted_out === 'true');
    if (search) query = query.or(`email.ilike.%${search}%,business_name.ilike.%${search}%`);

    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });

    return res.json({ leads: data, total: count, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/leads/:id ───────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const { data, error } = await db
      .from('leads')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Lead not found.' });
    return res.json({ lead: data });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/leads/opt-out ──────────────────────────────────────────────────
// Called internally when a recipient replies 'STOP', or manually by admin.
router.post('/opt-out', async (req, res, next) => {
  try {
    const { email, lead_id } = req.body;
    if (!email && !lead_id) return res.status(400).json({ error: 'email or lead_id required.' });

    const db = getDb();
    let query = db.from('leads').update({ opted_out: true });

    if (lead_id) {
      query = query.eq('id', lead_id).eq('user_id', req.userId);
    } else {
      query = query.eq('email', email).eq('user_id', req.userId);
    }

    const { error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    return res.json({ message: 'Lead opted out successfully.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
