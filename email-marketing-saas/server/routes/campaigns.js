/**
 * server/routes/campaigns.js
 * CRUD for Scraping Campaigns + scrape trigger
 *
 * Routes:
 *   GET    /api/campaigns                — list user's campaigns
 *   GET    /api/campaigns/:id            — single campaign + leads preview
 *   POST   /api/campaigns                — create + trigger scrape
 *   DELETE /api/campaigns/:id            — delete campaign + its leads
 */

'use strict';

const express           = require('express');
const { v4: uuidv4 }   = require('uuid');
const { getDb }         = require('../config/supabase');
const { requireAuth }   = require('../middleware/auth');
const { logActivity }   = require('../services/activity-logger');
const scraperService    = require('../services/scraper');

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/campaigns ───────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const { data, error } = await db
      .from('campaigns')
      .select('id,name,niche,channels,countries,states,status,total_leads,scraped_at,created_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ campaigns: data });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/campaigns/:id ───────────────────────────────────────────────────
// Returns campaign details + all scraped leads (for preview before sending)
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();

    // Campaign
    const { data: campaign, error: cErr } = await db
      .from('campaigns')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    if (cErr || !campaign) return res.status(404).json({ error: 'Campaign not found.' });

    // Leads for this campaign
    const { data: leads, error: lErr } = await db
      .from('leads')
      .select('id,business_name,email,phone,whatsapp_valid,social_urls,opted_out,created_at')
      .eq('campaign_id', req.params.id)
      .eq('opted_out', false)
      .order('created_at', { ascending: false });

    if (lErr) return res.status(400).json({ error: lErr.message });

    return res.json({ campaign, leads: leads || [] });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/campaigns ──────────────────────────────────────────────────────
// Create a campaign and start the scraper asynchronously.
// Body: { name, niche, channels[], countries[], states{}, emailCount? }
router.post('/', async (req, res, next) => {
  try {
    const { name, niche, channels, countries, states, emailCount } = req.body;

    if (!niche || !countries?.length) {
      return res.status(400).json({ error: 'niche and at least one country are required.' });
    }

    const db = getDb();

    // Create campaign record
    const { data: campaign, error } = await db
      .from('campaigns')
      .insert({
        id:       uuidv4(),
        user_id:  req.userId,
        name:     name || `${niche} campaign`,
        niche,
        channels: channels || ['email'],
        countries: countries || [],
        states:    states || {},
        status:   'running',
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await logActivity(req.userId, 'scrape_start', { campaignId: campaign.id, niche, countries, emailCount });

    // Fire scraper in the background (non-blocking)
    scraperService
      .runScrape({ campaignId: campaign.id, userId: req.userId, niche, countries, states, channels: channels || ['email'], emailCount })
      .catch((err) => console.error('[Scraper] Error:', err.message));

    return res.status(201).json({ campaign });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/campaigns/:id ────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDb();

    // Verify ownership
    const { data: camp } = await db
      .from('campaigns')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    if (!camp) return res.status(404).json({ error: 'Campaign not found.' });

    // Cascade: delete leads first, then campaign
    await db.from('leads').delete().eq('campaign_id', req.params.id);
    await db.from('campaigns').delete().eq('id', req.params.id);

    return res.json({ message: 'Campaign deleted.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
