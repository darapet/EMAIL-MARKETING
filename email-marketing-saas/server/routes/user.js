/**
 * server/routes/user.js
 * User profile, branding, and multi-SMTP API key management
 *
 * Routes:
 *   GET    /api/user/profile            — fetch own profile
 *   PUT    /api/user/profile            — update name, company, phone, desc, logoUrl, brandColor
 *   PUT    /api/user/smtp               — save SMTP/API key settings (premium)
 *   DELETE /api/user/smtp/:provider     — remove a provider's credentials
 *   GET    /api/user/activity           — own activity log
 */

'use strict';

const express             = require('express');
const { getDb }           = require('../config/supabase');
const { requireAuth }     = require('../middleware/auth');
const { requirePremium }  = require('../middleware/premium');
const { logActivity }     = require('../services/activity-logger');

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/user/profile ────────────────────────────────────────────────────
router.get('/profile', async (req, res, next) => {
  try {
    const db = getDb();
    const { data, error } = await db
      .from('profiles')
      .select('id,email,name,company,phone,description,logo_url,brand_color,plan,is_admin,active_smtp,created_at')
      .eq('id', req.userId)
      .single();

    if (error) return res.status(404).json({ error: 'Profile not found.' });

    return res.json({ user: data });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/user/profile ────────────────────────────────────────────────────
router.put('/profile', async (req, res, next) => {
  try {
    const allowed = ['name', 'company', 'phone', 'description', 'logo_url', 'brand_color'];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }

    const db = getDb();
    const { data, error } = await db
      .from('profiles')
      .update(updates)
      .eq('id', req.userId)
      .select('id,email,name,company,phone,desc,logo_url,brand_color,plan,active_smtp')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await logActivity(req.userId, 'profile_update', { fields: Object.keys(updates) });
    return res.json({ user: data });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/user/smtp ───────────────────────────────────────────────────────
// Saves SMTP / API key settings. Premium feature (or admin).
router.put('/smtp', requirePremium, async (req, res, next) => {
  try {
    const allowed = [
      'active_smtp',
      'brevo_api_key',
      'sendgrid_api_key',
      'mailgun_api_key', 'mailgun_domain',
      'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_secure',
    ];

    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid SMTP fields provided.' });
    }

    // Validate active_smtp value
    const validProviders = ['system', 'brevo', 'sendgrid', 'mailgun', 'smtp'];
    if (updates.active_smtp && !validProviders.includes(updates.active_smtp)) {
      return res.status(400).json({ error: `Invalid provider. Choose from: ${validProviders.join(', ')}` });
    }

    const db = getDb();
    const { data, error } = await db
      .from('profiles')
      .update(updates)
      .eq('id', req.userId)
      .select('id,active_smtp,mailgun_domain')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await logActivity(req.userId, 'smtp_update', { active_smtp: updates.active_smtp });
    return res.json({ message: 'SMTP settings saved.', active_smtp: data.active_smtp });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/user/smtp/:provider ─────────────────────────────────────────
// Clears a specific provider's credentials and resets to 'system'.
router.delete('/smtp/:provider', requirePremium, async (req, res, next) => {
  try {
    const providerMap = {
      brevo:     { brevo_api_key: null },
      sendgrid:  { sendgrid_api_key: null },
      mailgun:   { mailgun_api_key: null, mailgun_domain: null },
      smtp:      { smtp_host: null, smtp_port: null, smtp_user: null, smtp_pass: null, smtp_secure: true },
    };

    const clears = providerMap[req.params.provider];
    if (!clears) return res.status(400).json({ error: 'Unknown provider.' });

    const db = getDb();
    await db
      .from('profiles')
      .update({ ...clears, active_smtp: 'system' })
      .eq('id', req.userId);

    return res.json({ message: `${req.params.provider} credentials removed. Provider reset to system.` });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/user/activity ───────────────────────────────────────────────────
router.get('/activity', async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  || '50'), 200);
    const offset = parseInt(req.query.offset || '0');

    const db = getDb();
    const { data, error, count } = await db
      .from('activity_logs')
      .select('*', { count: 'exact' })
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ logs: data, total: count, limit, offset });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
