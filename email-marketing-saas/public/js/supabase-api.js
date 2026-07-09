/**
 * supabase-api.js — Replaces all Express /api/ calls with direct Supabase queries.
 * Load this AFTER auth.js. It overrides apiFetch() globally.
 */

(function () {
  // ── Stub Socket.io so initSocket() silently does nothing on GitHub Pages ────
  // The real `io()` tries to connect to window.location.origin (darapet.github.io)
  // which hangs and prevents the app from loading. This fake socket absorbs all
  // event registrations and emits without crashing anything.
  window.io = function () {
    const stub = {
      on:         function () { return stub; },
      off:        function () { return stub; },
      emit:       function () { return stub; },
      connect:    function () { return stub; },
      disconnect: function () { return stub; },
      id: null,
      connected: false,
    };
    return stub;
  };

  const SUPABASE_URL = 'https://lvmvimijhlxsnnmrjvie.supabase.co';

  function getSB() {
    return window.supabase
      ? window.supabase.createClient(SUPABASE_URL, window.__LF_ANON_KEY || '')
      : null;
  }

  function uid() {
    return typeof getCurrentUserId === 'function' ? getCurrentUserId() : null;
  }

  function token() {
    return typeof getAuthToken === 'function' ? getAuthToken() : null;
  }

  // ── Supabase REST fetch with auth header ────────────────────────────────────
  async function sbFetch(path, options = {}) {
    const t = token();
    const res = await fetch(SUPABASE_URL + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'apikey': window.__LF_ANON_KEY || '',
        ...(t ? { 'Authorization': 'Bearer ' + t } : {}),
        ...(options.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || json.error || 'Request failed');
    return json;
  }

  // ── Main router — intercepts every apiFetch call ────────────────────────────
  window.apiFetch = async function (url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const body   = options.body ? JSON.parse(options.body) : null;

    // Strip API_BASE prefix and /api prefix
    const clean = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '');

    // ── USER PROFILE ──────────────────────────────────────────────────────────
    if (clean === '/user/profile' && method === 'GET') {
      const data = await sbFetch(`/rest/v1/profiles?id=eq.${uid()}&select=id,email,name,company,phone,description,logo_url,brand_color,plan,is_admin,active_smtp,created_at&limit=1`);
      const row  = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('Profile not found.');
      return { user: row };
    }

    if (clean === '/user/profile' && method === 'PUT') {
      const allowed = ['name','company','phone','description','logo_url','signature_url','brand_color'];
      const updates = Object.fromEntries(Object.entries(body || {}).filter(([k]) => allowed.includes(k)));
      await sbFetch(`/rest/v1/profiles?id=eq.${uid()}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify(updates),
      });
      return { message: 'Profile updated.' };
    }

    // ── CAMPAIGNS ─────────────────────────────────────────────────────────────
    if (clean === '/campaigns' && method === 'GET') {
      const data = await sbFetch(`/rest/v1/campaigns?user_id=eq.${uid()}&select=*&order=created_at.desc`);
      const campaigns = (Array.isArray(data) ? data : []).map(c => ({
        ...c,
        campaignId: c.id,
        leadsCount: c.total_leads || 0,
        createdAt:  c.created_at,
      }));
      return { campaigns };
    }

    if (clean === '/campaigns' && method === 'POST') {
      const { name, niche, channels, locations } = body || {};
      const sb = getSB();
      if (!sb) throw new Error('Supabase not loaded');
      const { data, error } = await sb.from('campaigns').insert({
        user_id:   uid(),
        name:      name || niche,
        niche:     niche || name,
        channels:  channels || [],
        countries: (locations || []).map(l => l.country),
        states:    Object.fromEntries((locations || []).map(l => [l.country, l.states || []])),
        status:    'pending',
      }).select().single();
      if (error) throw new Error(error.message);
      if (typeof toast === 'function') {
        toast('Campaign saved! Live scraping needs the backend — add leads manually from the Leads tab.', 'info');
      }
      return { ...data, campaignId: data.id, leadsCount: 0, createdAt: data.created_at };
    }

    // ── SINGLE CAMPAIGN ───────────────────────────────────────────────────────
    const campaignMatch = clean.match(/^\/campaigns\/([^/]+)$/);
    if (campaignMatch && method === 'GET') {
      const id = campaignMatch[1];
      const sb = getSB();
      const { data: campaign } = await sb.from('campaigns').select('*').eq('id', id).single();
      const { data: leads }    = await sb.from('leads').select('*').eq('campaign_id', id);
      return { ...campaign, leads: leads || [] };
    }

    // ── CAMPAIGN LEADS ────────────────────────────────────────────────────────
    const leadsMatch = clean.match(/^\/campaigns\/([^/]+)\/leads$/);
    if (leadsMatch) {
      const id   = leadsMatch[1];
      const data = await sbFetch(`/rest/v1/leads?campaign_id=eq.${id}&user_id=eq.${uid()}&select=*&order=created_at.desc`);
      return { leads: Array.isArray(data) ? data : [] };
    }

    // ── TEMPLATES ─────────────────────────────────────────────────────────────
    if (clean === '/templates' && method === 'GET') {
      const data = await sbFetch(`/rest/v1/email_templates?user_id=eq.${uid()}&select=*&order=created_at.desc`);
      return { templates: Array.isArray(data) ? data : [] };
    }

    if (clean === '/templates' && method === 'POST') {
      const sb = getSB();
      const { data, error } = await sb.from('email_templates').insert({ ...body, user_id: uid() }).select().single();
      if (error) throw new Error(error.message);
      return { template: data };
    }

    const templateMatch = clean.match(/^\/templates\/([^/]+)$/);
    if (templateMatch && method === 'PUT') {
      const id      = templateMatch[1];
      const sb      = getSB();
      const allowed = ['name','subject','body','logo_url','signature_url'];
      const updates = Object.fromEntries(Object.entries(body || {}).filter(([k]) => allowed.includes(k)));
      const { data, error } = await sb.from('email_templates').update(updates).eq('id', id).eq('user_id', uid()).select().single();
      if (error) throw new Error(error.message);
      return { template: data };
    }

    if (templateMatch && method === 'DELETE') {
      const id = templateMatch[1];
      const sb = getSB();
      const { error } = await sb.from('email_templates').delete().eq('id', id).eq('user_id', uid());
      if (error) throw new Error(error.message);
      return { message: 'Deleted.' };
    }

    const defaultMatch = clean.match(/^\/templates\/([^/]+)\/default$/);
    if (defaultMatch && method === 'PUT') {
      const id = defaultMatch[1];
      const sb = getSB();
      await sb.from('email_templates').update({ is_default: false }).eq('user_id', uid());
      await sb.from('email_templates').update({ is_default: true  }).eq('id', id).eq('user_id', uid());
      return { message: 'Default set.' };
    }

    // ── ADMIN ─────────────────────────────────────────────────────────────────
    if (clean === '/admin/stats' && method === 'GET') {
      const sb = getSB();
      const [u, p, c, e] = await Promise.all([
        sb.from('profiles').select('*', { count: 'exact', head: true }),
        sb.from('profiles').select('*', { count: 'exact', head: true }).eq('plan', 'premium'),
        sb.from('campaigns').select('*', { count: 'exact', head: true }),
        sb.from('email_sends').select('*', { count: 'exact', head: true }),
      ]);
      return { stats: { total_users: u.count, premium_users: p.count, total_campaigns: c.count, total_emails_sent: e.count } };
    }

    if (clean === '/admin/users' && method === 'GET') {
      const data = await sbFetch(`/rest/v1/profiles?select=id,email,name,plan,is_admin,created_at&order=created_at.desc`);
      return { users: Array.isArray(data) ? data : [] };
    }

    if (clean === '/admin/activity' && method === 'GET') {
      const data = await sbFetch(`/rest/v1/activity_logs?select=*,profiles(email)&order=created_at.desc&limit=50`);
      return { logs: Array.isArray(data) ? data : [] };
    }

    const adminPlanMatch = clean.match(/^\/admin\/users\/([^/]+)\/plan$/);
    if (adminPlanMatch && method === 'PUT') {
      const sb = getSB();
      const { error } = await sb.from('profiles').update({ plan: body.plan }).eq('id', adminPlanMatch[1]);
      if (error) throw new Error(error.message);
      return { message: 'Plan updated.' };
    }

    const adminAdminMatch = clean.match(/^\/admin\/users\/([^/]+)\/admin$/);
    if (adminAdminMatch && method === 'PUT') {
      const sb = getSB();
      const { error } = await sb.from('profiles').update({ is_admin: body.is_admin }).eq('id', adminAdminMatch[1]);
      if (error) throw new Error(error.message);
      return { message: 'Admin updated.' };
    }

    // ── SCHEDULE ──────────────────────────────────────────────────────────────
    if (clean === '/schedule' && method === 'GET') {
      const data = await sbFetch(`/rest/v1/scheduled_sends?user_id=eq.${uid()}&select=*&order=scheduled_at.asc`);
      return { schedules: Array.isArray(data) ? data : [] };
    }

    if (clean === '/schedule' && method === 'POST') {
      const sb = getSB();
      const { data, error } = await sb.from('scheduled_sends').insert({ ...body, user_id: uid() }).select().single();
      if (error) throw new Error(error.message);
      return { schedule: data };
    }

    const scheduleDelMatch = clean.match(/^\/schedule\/([^/]+)$/);
    if (scheduleDelMatch && method === 'DELETE') {
      const sb = getSB();
      await sb.from('scheduled_sends').delete().eq('id', scheduleDelMatch[1]).eq('user_id', uid());
      return { message: 'Deleted.' };
    }

    // ── USER SMTP / API KEYS ──────────────────────────────────────────────────
    if (clean === '/user/smtp' && method === 'PUT') {
      const allowed = ['active_smtp','brevo_api_key','sendgrid_api_key','mailgun_api_key','mailgun_domain','smtp_host','smtp_port','smtp_user','smtp_pass','smtp_secure'];
      const updates = Object.fromEntries(Object.entries(body || {}).filter(([k]) => allowed.includes(k)));
      await sbFetch(`/rest/v1/profiles?id=eq.${uid()}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify(updates),
      });
      return { message: 'SMTP settings saved.' };
    }

    if (clean === '/user/activity' && method === 'GET') {
      const data = await sbFetch(`/rest/v1/activity_logs?user_id=eq.${uid()}&select=*&order=created_at.desc&limit=50`);
      return { logs: Array.isArray(data) ? data : [] };
    }

    // ── Features that need a backend — graceful message ───────────────────────
    if (clean.startsWith('/ai/') || clean.startsWith('/outreach/') ||
        clean.startsWith('/whatsapp/') || clean.startsWith('/user/brevo')) {
      if (typeof toast === 'function') toast('This feature needs the backend server — coming soon!', 'warn');
      throw new Error('Requires backend server');
    }

    console.warn('[supabase-api] Unhandled route:', method, clean);
    throw new Error('Route not implemented: ' + method + ' ' + clean);
  };

  console.log('[LeadForge] Supabase-direct mode active — Socket.io stubbed');
})();
