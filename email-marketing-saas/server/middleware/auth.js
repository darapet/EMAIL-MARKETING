/**
 * server/middleware/auth.js
 * Lightweight auth middleware — reads X-User-Id header (dev mode)
 * or Firebase ID token (production mode).
 *
 * To enforce Firebase Auth in production, set REQUIRE_AUTH=true in .env.
 */

'use strict';

const { getAuth } = require('../config/firebase');

/**
 * requireAuth middleware
 * In dev (REQUIRE_AUTH != 'true'), trusts the X-User-Id header directly.
 * In production, verifies the Firebase Bearer token.
 */
async function requireAuth(req, res, next) {
  // Developer shortcut: trust X-User-Id header
  if (process.env.REQUIRE_AUTH !== 'true') {
    req.userId = req.headers['x-user-id'] || 'dev-user';
    return next();
  }

  // Production: Firebase ID token in Authorization header
  const authHeader = req.headers['authorization'] || '';
  const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No authentication token provided' });
  }

  try {
    const firebaseAuth = getAuth();
    if (!firebaseAuth) {
      return res.status(503).json({ error: 'Auth service not configured' });
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
