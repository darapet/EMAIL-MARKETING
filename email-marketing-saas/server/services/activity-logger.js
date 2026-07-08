/**
 * server/services/activity-logger.js
 * Records user activity to the activity_logs table in Supabase.
 *
 * Call logActivity() from any route handler.
 * Failures are silently swallowed — never let logging crash a request.
 */

'use strict';

const { getDb } = require('../config/supabase');

/**
 * @param {string} userId       - Supabase auth user UUID
 * @param {string} action       - e.g. 'scrape_start', 'email_blast', 'login', 'wa_connect'
 * @param {object} [meta={}]    - any additional JSON metadata
 * @param {string} [ip]         - client IP address
 */
async function logActivity(userId, action, meta = {}, ip = null) {
  if (!userId || !action) return;

  try {
    const db = getDb();
    await db.from('activity_logs').insert({
      user_id:    userId,
      action,
      meta,
      ip,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Never let logging crash a request
    console.error('[ActivityLogger] Failed to write log:', err.message);
  }
}

/**
 * Express middleware factory.
 * Usage: router.post('/email', logRequest('email_blast'), handler)
 */
function logRequest(action, metaFn = (req) => ({})) {
  return (req, res, next) => {
    if (req.userId) {
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      logActivity(req.userId, action, metaFn(req), ip).catch(() => {});
    }
    next();
  };
}

module.exports = { logActivity, logRequest };
