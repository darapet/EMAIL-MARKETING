/**
 * server/routes/admin.js
 * Admin Panel — full platform visibility & control
 * All routes require is_admin = true on the user's profile.
 *
 * Routes:
 *   GET  /api/admin/users                — list all users
 *   GET  /api/admin/users/:id            — single user detail
 *   PUT  /api/admin/users/:id/plan       — upgrade/downgrade user plan
 *   PUT  /api/admin/users/:id/admin      — toggle admin flag
 *   GET  /api/admin/activity             — global activity log
 *   GET  /api/admin/sends                — global email send history
 *   GET  /api/admin/stats                — platform-wide stats
 *   PUT  /api/admin/branding             — update platform default branding
 *   GET  /api/admin/branding             — get platform default branding
 */

'use strict';

const express               = require('express');
const { getDb }             = require('../config/supabase');
const { requireAuth }       = require('../middleware/auth');
const { requireAdmin }      = require('../middleware/auth');
const { logActivity }       = require('../services/activity-logger');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
router.get('/users', async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  || '50'), 500);
    const offset = parseInt(req.query.offset || '0');
    const search = req.query.search || '';

    const db = getDb();
    let query = db
      .from('profiles')
      .select(
        'id,email,name,company,phone,plan,is_admin,logo_url,brand_color,active_smtp,created_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%,company.ilike.%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });

    return res.json({ users: data, total: count, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/users/:id ─────────────────────────────────────────────────
router.get('/users/:id', async (req, res, next) => {
  try {
    const db = getDb();

    const [profileRes, activityRes, sendsRes] = await Promise.all([
      db.from('profiles').select('*').eq('id', req.params.id).single(),
      db.from('activity_logs').select('*').eq('user_id', req.params.id).order('created_at', { ascending: false }).limit(20),
      db.from('email_sends').select('id,to_email,subject,status,provider,sent_at').eq('user_id', req.params.id).order('sent_at', { ascending: false }).limit(20),
    ]);

    if (profileRes.error || !profileRes.data) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Remove sensitive key fields from admin view
    const { brevo_api_key, sendgrid_api_key, mailgun_api_key, smtp_pass, ...safeProfile } = profileRes.data;

    return res.json({
      user:     safeProfile,
      activity: activityRes.data || [],
      sends:    sendsRes.data    || [],
    });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/admin/users/:id/plan ────────────────────────────────────────────
router.put('/users/:id/plan', async (req, res, next) => {
  try {
    const { plan } = req.body;
    if (!['free', 'premium'].includes(plan)) {
      return res.status(400).json({ error: 'plan must be "free" or "premium".' });
    }

    const db = getDb();
    const { data, error } = await db
      .from('profiles')
      .update({ plan })
      .eq('id', req.params.id)
      .select('id,email,plan')
      .single();

    if (error || !data) return res.status(404).json({ error: 'User not found.' });

    await logActivity(req.userId, 'admin_plan_change', { targetUserId: req.params.id, plan });
    return res.json({ message: `User plan updated to "${plan}".`, user: data });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/admin/users/:id/admin ───────────────────────────────────────────
router.put('/users/:id/admin', async (req, res, next) => {
  try {
    const { is_admin } = req.body;
    if (typeof is_admin !== 'boolean') {
      return res.status(400).json({ error: 'is_admin must be a boolean.' });
    }

    // Prevent self-demotion
    if (req.params.id === req.userId && !is_admin) {
      return res.status(400).json({ error: 'You cannot remove your own admin access.' });
    }

    const db = getDb();
    const { data, error } = await db
      .from('profiles')
      .update({ is_admin })
      .eq('id', req.params.id)
      .select('id,email,is_admin')
      .single();

    if (error || !data) return res.status(404).json({ error: 'User not found.' });

    await logActivity(req.userId, 'admin_role_change', { targetUserId: req.params.id, is_admin });
    return res.json({ message: `Admin status set to ${is_admin}.`, user: data });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/activity ──────────────────────────────────────────────────
router.get('/activity', async (req, res, next) => {
  try {
    const limit      = Math.min(parseInt(req.query.limit  || '100'), 500);
    const offset     = parseInt(req.query.offset || '0');
    const userId     = req.query.user_id;
    const action     = req.query.action;

    const db = getDb();
    let query = db
      .from('activity_logs')
      .select('*, profiles(email,name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (userId) query = query.eq('user_id', userId);
    if (action) query = query.eq('action', action);

    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });

    return res.json({ logs: data, total: count, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/sends ─────────────────────────────────────────────────────
router.get('/sends', async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  || '100'), 500);
    const offset = parseInt(req.query.offset || '0');
    const userId = req.query.user_id;

    const db = getDb();
    let query = db
      .from('email_sends')
      .select('*, profiles(email,name)', { count: 'exact' })
      .order('sent_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (userId) query = query.eq('user_id', userId);

    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });

    return res.json({ sends: data, total: count, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const db = getDb();

    const [usersRes, sendsRes, campaignsRes, leadsRes] = await Promise.all([
      db.from('profiles').select('plan', { count: 'exact' }),
      db.from('email_sends').select('status'),
      db.from('campaigns').select('id', { count: 'exact' }),
      db.from('leads').select('id', { count: 'exact' }),
    ]);

    const totalUsers   = usersRes.count   || 0;
    const premiumUsers = (usersRes.data || []).filter(u => u.plan === 'premium').length;
    const freeUsers    = totalUsers - premiumUsers;

    const sendStats = (sendsRes.data || []).reduce(
      (acc, row) => { acc.total++; acc[row.status] = (acc[row.status] || 0) + 1; return acc; },
      { total: 0, sent: 0, failed: 0 }
    );

    return res.json({
      users:     { total: totalUsers, premium: premiumUsers, free: freeUsers },
      sends:     sendStats,
      campaigns: campaignsRes.count || 0,
      leads:     leadsRes.count     || 0,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET/PUT /api/admin/branding ──────────────────────────────────────────────
// Platform-wide default branding (stored in the admin's own profile)
router.get('/branding', async (req, res, next) => {
  try {
    const db = getDb();
    const { data, error } = await db
      .from('profiles')
      .select('logo_url,default_logo_url,brand_color,company,name')
      .eq('id', req.userId)
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ branding: data });
  } catch (err) {
    next(err);
  }
});

router.put('/branding', async (req, res, next) => {
  try {
    const allowed = ['logo_url', 'default_logo_url', 'brand_color', 'company'];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid branding fields provided.' });
    }

    const db = getDb();
    const { data, error } = await db
      .from('profiles')
      .update(updates)
      .eq('id', req.userId)
      .select('logo_url,default_logo_url,brand_color,company')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await logActivity(req.userId, 'admin_branding_update', { fields: Object.keys(updates) });
    return res.json({ message: 'Platform branding updated.', branding: data });
  } catch (err) {
    next(err);
  }
});


// ─── PUT /api/admin/users/:id/email-limit ────────────────────────────────────
router.put('/users/:id/email-limit', async (req, res, next) => {
  try {
    const limit = parseInt(req.body.email_daily_limit);
    if (isNaN(limit) || limit < 0) return res.status(400).json({ error: 'email_daily_limit must be a non-negative integer.' });
    const db = getDb();
    const { data, error } = await db.from('profiles').update({ email_daily_limit: limit }).eq('id', req.params.id).select('id,email,email_daily_limit').single();
    if (error || !data) return res.status(404).json({ error: 'User not found.' });
    await logActivity(req.userId, 'admin_email_limit_change', { targetUserId: req.params.id, email_daily_limit: limit });
    return res.json({ message: 'Email limit updated to ' + limit + '/day.', user: data });
  } catch (err) { next(err); }
});

module.exports = router;
