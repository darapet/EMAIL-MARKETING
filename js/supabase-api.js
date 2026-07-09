/**
 * supabase-api.js
 *
 * Two jobs:
 *  1. Redirect Socket.io to the Render backend (not GitHub Pages).
 *  2. Route /api/ calls:
 *       - CRUD data  → Supabase directly (fast, no server round-trip)
 *       - Scraping / AI / Email / WhatsApp → Render backend
 */

(function () {
  var RENDER = 'https://leadforge-backend-486b.onrender.com';
  var SUPABASE_URL = 'https://lvmvimijhlxsnnmrjvie.supabase.co';

  // ── 1. Fix Socket.io: intercept io() and point it at Render, not GitHub Pages ──
  //  initSocket() in app.js calls io(window.location.origin) which would try to
  //  connect to darapet.github.io — we replace that URL with Render.
  var _realIO = window.io;
  window.io = function (url, opts) {
    return _realIO(RENDER, opts);
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function getSB() {
    return window.supabase
      ? window.supabase.createClient(SUPABASE_URL, window.__LF_ANON_KEY || '')
      : null;
  }
  function uid()   { return typeof getCurrentUserId === 'function' ? getCurrentUserId() : null; }
  function tok()   { return typeof getAuthToken     === 'function' ? getAuthToken()     : null; }

  // Direct Supabase REST call (uses the user's JWT so RLS applies)
  async function sbFetch(path, options) {
    options = options || {};
    var t = tok();
    var res = await fetch(SUPABASE_URL + path, Object.assign({}, options, {
      headers: Object.assign({
        'Content-Type': 'application/json',
        'apikey': window.__LF_ANON_KEY || '',
      }, t ? { 'Authorization': 'Bearer ' + t } : {}, options.headers || {}),
    }));
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(json.message || json.error || 'Supabase error');
    return json;
  }

  // Forward to Render backend (scraping / AI / email / WhatsApp)
  async function renderFetch(path, options) {
    options = options || {};
    var t = tok();
    var res = await fetch(RENDER + '/api' + path, Object.assign({}, options, {
      headers: Object.assign({
        'Content-Type': 'application/json',
      }, t ? { 'Authorization': 'Bearer ' + t } : {}, options.headers || {}),
    }));
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      if (res.status === 401) { if (typeof handleLogout === 'function') handleLogout(); return; }
      if (res.status === 403 && json.upgrade_required) {
        if (typeof showPremiumModal === 'function') showPremiumModal();
        throw new Error('Premium feature — upgrade to access');
      }
      throw new Error(json.error || 'Server error ' + res.status);
    }
    return json;
  }

  // ── 2. Override apiFetch ─────────────────────────────────────────────────────
  window.apiFetch = async function (url, options) {
    options = options || {};
    var method = (options.method || 'GET').toUpperCase();
    var body   = options.body ? JSON.parse(options.body) : null;

    // Strip host + /api prefix to get a clean path like /campaigns
    var clean = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '');

    // ── Routes that go to RENDER (need server-side logic) ──────────────────────
    // Scraping (campaign launch)
    if (clean === '/campaigns' && method === 'POST') {
      return renderFetch(clean, options);
    }
    // AI generation
    if (clean.startsWith('/ai/')) {
      return renderFetch(clean, options);
    }
    // Email outreach / test
    if (clean.startsWith('/outreach/')) {
      return renderFetch(clean, options);
    }
    // WhatsApp
    if (clean.startsWith('/whatsapp/')) {
      return renderFetch(clean, options);
    }
    // Brevo slot management
    if (clean.startsWith('/user/brevo')) {
      return renderFetch(clean, options);
    }
    // Scheduled send execution (the actual sending is server-side)
    if (clean.startsWith('/schedule/send')) {
      return renderFetch(clean, options);
    }

    // ── Routes that go straight to SUPABASE ───────────────────────────────────
    // User profile
    if (clean === '/user/profile' && method === 'GET') {
      var rows = await sbFetch('/rest/v1/profiles?id=eq.' + uid() +
        '&select=id,email,name,company,phone,description,logo_url,brand_color,plan,is_admin,active_smtp,created_at&limit=1');
      var row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) throw new Error('Profile not found — try registering a new account.');
      return { user: row };
    }
    if (clean === '/user/profile' && method === 'PUT') {
      var allowed = ['name','company','phone','description','logo_url','signature_url','brand_color'];
      var updates = {};
      Object.keys(body || {}).forEach(function (k) { if (allowed.indexOf(k) !== -1) updates[k] = body[k]; });
      await sbFetch('/rest/v1/profiles?id=eq.' + uid(), {
        method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify(updates),
      });
      return { message: 'Profile updated.' };
    }

    // SMTP / API key settings
    if (clean === '/user/smtp' && method === 'PUT') {
      var smtpAllowed = ['active_smtp','brevo_api_key','sendgrid_api_key','mailgun_api_key',
                         'mailgun_domain','smtp_host','smtp_port','smtp_user','smtp_pass','smtp_secure'];
      var smtpUp = {};
      Object.keys(body || {}).forEach(function (k) { if (smtpAllowed.indexOf(k) !== -1) smtpUp[k] = body[k]; });
      await sbFetch('/rest/v1/profiles?id=eq.' + uid(), {
        method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify(smtpUp),
      });
      return { message: 'SMTP settings saved.' };
    }

    // Campaigns list
    if (clean === '/campaigns' && method === 'GET') {
      var data = await sbFetch('/rest/v1/campaigns?user_id=eq.' + uid() + '&select=*&order=created_at.desc');
      var campaigns = (Array.isArray(data) ? data : []).map(function (c) {
        return Object.assign({}, c, { campaignId: c.id, leadsCount: c.total_leads || 0, createdAt: c.created_at });
      });
      return { campaigns: campaigns };
    }

    // Single campaign
    var campaignGet = clean.match(/^\/campaigns\/([^/]+)$/);
    if (campaignGet && method === 'GET') {
      var sb = getSB();
      var cr  = await sb.from('campaigns').select('*').eq('id', campaignGet[1]).single();
      var lr  = await sb.from('leads').select('*').eq('campaign_id', campaignGet[1]);
      return Object.assign({}, cr.data, { leads: lr.data || [] });
    }

    // Campaign leads
    var leadsM = clean.match(/^\/campaigns\/([^/]+)\/leads$/);
    if (leadsM) {
      var ld = await sbFetch('/rest/v1/leads?campaign_id=eq.' + leadsM[1] + '&user_id=eq.' + uid() + '&select=*&order=created_at.desc');
      return { leads: Array.isArray(ld) ? ld : [] };
    }

    // Templates
    if (clean === '/templates' && method === 'GET') {
      var td = await sbFetch('/rest/v1/email_templates?user_id=eq.' + uid() + '&select=*&order=created_at.desc');
      return { templates: Array.isArray(td) ? td : [] };
    }
    if (clean === '/templates' && method === 'POST') {
      var sb2 = getSB();
      var ti  = await sb2.from('email_templates').insert(Object.assign({}, body, { user_id: uid() })).select().single();
      if (ti.error) throw new Error(ti.error.message);
      return { template: ti.data };
    }
    var tmplM = clean.match(/^\/templates\/([^/]+)$/);
    if (tmplM && method === 'PUT') {
      var sb3 = getSB();
      var ta  = ['name','subject','body','logo_url','signature_url'];
      var tu  = {};
      Object.keys(body || {}).forEach(function (k) { if (ta.indexOf(k) !== -1) tu[k] = body[k]; });
      var tr = await sb3.from('email_templates').update(tu).eq('id', tmplM[1]).eq('user_id', uid()).select().single();
      if (tr.error) throw new Error(tr.error.message);
      return { template: tr.data };
    }
    if (tmplM && method === 'DELETE') {
      var sb4 = getSB();
      var td2 = await sb4.from('email_templates').delete().eq('id', tmplM[1]).eq('user_id', uid());
      if (td2.error) throw new Error(td2.error.message);
      return { message: 'Deleted.' };
    }
    var dfltM = clean.match(/^\/templates\/([^/]+)\/default$/);
    if (dfltM && method === 'PUT') {
      var sb5 = getSB();
      await sb5.from('email_templates').update({ is_default: false }).eq('user_id', uid());
      await sb5.from('email_templates').update({ is_default: true }).eq('id', dfltM[1]).eq('user_id', uid());
      return { message: 'Default set.' };
    }

    // Schedule
    if (clean === '/schedule' && method === 'GET') {
      var sc = await sbFetch('/rest/v1/scheduled_sends?user_id=eq.' + uid() + '&select=*&order=scheduled_at.asc');
      return { schedules: Array.isArray(sc) ? sc : [] };
    }
    if (clean === '/schedule' && method === 'POST') {
      var sb6 = getSB();
      var si  = await sb6.from('scheduled_sends').insert(Object.assign({}, body, { user_id: uid() })).select().single();
      if (si.error) throw new Error(si.error.message);
      return { schedule: si.data };
    }
    var scDelM = clean.match(/^\/schedule\/([^/]+)$/);
    if (scDelM && method === 'DELETE') {
      var sb7 = getSB();
      await sb7.from('scheduled_sends').delete().eq('id', scDelM[1]).eq('user_id', uid());
      return { message: 'Deleted.' };
    }

    // Activity
    if (clean === '/user/activity' && method === 'GET') {
      var ac = await sbFetch('/rest/v1/activity_logs?user_id=eq.' + uid() + '&select=*&order=created_at.desc&limit=50');
      return { logs: Array.isArray(ac) ? ac : [] };
    }

    // Admin
    if (clean === '/admin/stats' && method === 'GET') {
      var sb8 = getSB();
      var res2 = await Promise.all([
        sb8.from('profiles').select('*', { count: 'exact', head: true }),
        sb8.from('profiles').select('*', { count: 'exact', head: true }).eq('plan', 'premium'),
        sb8.from('campaigns').select('*', { count: 'exact', head: true }),
        sb8.from('email_sends').select('*', { count: 'exact', head: true }),
      ]);
      return { stats: { total_users: res2[0].count, premium_users: res2[1].count, total_campaigns: res2[2].count, total_emails_sent: res2[3].count } };
    }
    if (clean === '/admin/users' && method === 'GET') {
      var au = await sbFetch('/rest/v1/profiles?select=id,email,name,plan,is_admin,created_at&order=created_at.desc');
      return { users: Array.isArray(au) ? au : [] };
    }
    if (clean === '/admin/activity' && method === 'GET') {
      var aa = await sbFetch('/rest/v1/activity_logs?select=*,profiles(email)&order=created_at.desc&limit=50');
      return { logs: Array.isArray(aa) ? aa : [] };
    }
    var adPlanM = clean.match(/^\/admin\/users\/([^/]+)\/plan$/);
    if (adPlanM && method === 'PUT') {
      var sb9 = getSB();
      var ap = await sb9.from('profiles').update({ plan: body.plan }).eq('id', adPlanM[1]);
      if (ap.error) throw new Error(ap.error.message);
      return { message: 'Plan updated.' };
    }
    var adAdmM = clean.match(/^\/admin\/users\/([^/]+)\/admin$/);
    if (adAdmM && method === 'PUT') {
      var sb10 = getSB();
      var adm = await sb10.from('profiles').update({ is_admin: body.is_admin }).eq('id', adAdmM[1]);
      if (adm.error) throw new Error(adm.error.message);
      return { message: 'Admin updated.' };
    }

    // Fallback: try Render for anything unrecognised
    console.warn('[supabase-api] Unknown route — forwarding to Render:', method, clean);
    return renderFetch(clean, options);
  };

  console.log('[LeadForge] Ready — data via Supabase, scraping/AI/email via Render');
})();
