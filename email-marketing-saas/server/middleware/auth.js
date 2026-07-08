/**
 * server/middleware/auth.js
 * Auth middleware — Firebase ID token verification (production)
 * or local-dev shortcut gated by NODE_ENV=development AND explicit DEV_AUTH=true.
 *
 * Default: Firebase token required.
 * Dev shortcut: only active when BOTH NODE_ENV=development AND DEV_AUTH=true.
 */

'use strict';

const { getAuth } = require('../config/firebase');

/**
 * requireAuth middleware
 * Verifies the Firebase Bearer token on every request.
 * Dev shortcut (X-User-Id header) only works when NODE_ENV=development
 * AND the DEV_AUTH=true flag is explicitly set — never in production.
 */
async function requireAuth(req, res, next) {
  // ── Dev shortcut (must be opt-in AND non-production) ────────────
  const isDevShortcut =
    process.env.NODE_ENV === 'development' &&
    process.env.DEV_AUTH === 'true';

  if (isDevShortcut) {
    const devId = req.headers['x-user-id'];
    if (!devId || devId.trim() === '') {
      return res.status(401).json({ error: 'x-user-id header required in dev mode' });
    }
    req.userId = devId.trim();
    return next();
  }

  // ── Production: Firebase ID token in Authorization header ────────
  const authHeader = req.headers['authorization'] || '';
  const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No authentication token provided' });
  }

  try {
    const firebaseAuth = getAuth();
    if (!firebaseAuth) {
      return res.status(503).json({ error: 'Auth service not configured — set Firebase env vars' });
    }
    const decoded  = await firebaseAuth.verifyIdToken(token);
    req.userId     = decoded.uid;
    req.userEmail  = decoded.email;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };
