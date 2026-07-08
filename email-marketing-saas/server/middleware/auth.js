/**
 * server/middleware/auth.js
 * JWT authentication middleware using Supabase
 *
 * Verifies the Bearer token in Authorization header against Supabase,
 * then attaches req.userId and req.user to the request.
 */

'use strict';

const { getDb } = require('../config/supabase');

/**
 * requireAuth middleware — protects all routes that need a logged-in user.
 * Frontend must send: Authorization: Bearer <supabase_access_token>
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
    }

    const token = header.slice(7).trim();
    const db = getDb();

    // Verify the token via Supabase Auth
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    req.userId      = data.user.id;
    req.userEmail   = data.user.email;
    req.accessToken = token;

    // Attach the full profile (includes plan, is_admin, SMTP settings)
    const { data: profile } = await db
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    req.user = profile || { id: data.user.id, email: data.user.email, plan: 'free', is_admin: false };

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * requireAdmin middleware — restricts routes to admin users only.
 * Must be used AFTER requireAuth.
 */
function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
