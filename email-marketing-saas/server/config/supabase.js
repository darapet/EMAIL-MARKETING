/**
 * server/config/supabase.js
 * Supabase client — replaces Firebase config
 *
 * Uses the SERVICE ROLE key on the server (bypasses RLS) for full access.
 * Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');

let _client = null;

/**
 * Returns a singleton Supabase admin client.
 * Call getDb() anywhere in server code.
 */
function getDb() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment. ' +
      'Copy .env.example → .env and fill in your Supabase project credentials.'
    );
  }

  _client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _client;
}

/**
 * Returns a Supabase client scoped to an authenticated user's JWT.
 * Used when you need row-level security to apply.
 */
function getUserDb(accessToken) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment.');
  }

  return createClient(url, anonKey, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

module.exports = { getDb, getUserDb };
