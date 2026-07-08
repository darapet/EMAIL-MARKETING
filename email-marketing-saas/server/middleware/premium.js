/**
 * server/middleware/premium.js
 * Premium feature gate middleware
 *
 * Use after requireAuth. Returns 403 if user is not on a premium plan.
 * Admin users always pass through (admins can test all features).
 */

'use strict';

function requirePremium(req, res, next) {
  const user = req.user;

  if (!user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  // Admins bypass premium check
  if (user.is_admin) return next();

  if (user.plan !== 'premium') {
    return res.status(403).json({
      error: 'This feature requires a premium plan.',
      upgrade_required: true,
    });
  }

  next();
}

module.exports = { requirePremium };
