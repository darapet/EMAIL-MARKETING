/**
 * supabase-api.js — Replaces all Express /api/ calls with direct Supabase queries.
 * Load this AFTER auth.js. It overrides apiFetch() globally.
 */

(function () {
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

  // ── Supabase with service-role-equivalent: use auth header directly ─────────
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
    const method  = (options.method || 'GET').toUpperCase();
    const body    = options.body ? JSON.parse(options.body) : null;

    // Strip API_BASE prefix if present
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
      // Scraping needs a server — save campaign as pending and notify user
      const { name, niche, channels, locations } = body || {};
      const sb = getSB();
      if (!sb) throw new Error('Supabase not loaded');
      const { data, error } = await sb.from('campaigns').insert({
        user_id:  uid(),
        name:     name || niche,
        niche:    niche || name,
        channels: channels || [],
        countries: (locations || []).map(l => l.country),
        states:   Object.fromEntries((locations || []).map(l => [l.country, l.states || []])),
        status:   'pending',
      }).select().single();
      if (error) throw new Error(error.message);
      if (typeof toast === 'function') {
        toast('Campaign created! Note: Live scraping requires the backend server. Add leads manually from the Leads tab.', 'info');
      }
      return { ...data, campaignId: data.id, leadsCount: 0, createdAt: data.created_at };
    }

    // ── SINGLE CAMPAIGN ───────────────────────────────────────────────────────
    const campaignMatch = clean.match(/^\/campaigns\/([^/]+)$/);
    if (campaignMatch && method === 'GET') {
      const id  = campaignMatch[1];
      const sb  = getSB();
      const { data: campaign } = await sb.from('campaigns').select('*').eq('id', id).single();
      const { data: leads }    = await sb.from('leads').select('*').eq('campaign_id', id);
      return { ...campaign, leads: leads || [] };
    }

    // ── CAMPAIGN LEADS ────────────────────────────────────────────────────────
    const leadsMatch = clean.match(/^\/campaigns\/([^/]+)\/leads$/);
    if (leadsMatch) {
      const id = leadsMatch[1];
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
      const id = templateMatch[1];
      const sb = getSB();
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
      const { count: total_users }     = await sb.from('profiles').select('*', { count: 'exact', head: true });
      const { count: premium_users }   = await sb.from('profiles').select('*', { count: 'exact', head: true }).eq('plan', 'premium');
      const { count: total_campaigns } = await sb.from('campaigns').select('*', { count: 'exact', head: true });
      const { count: total_emails }    = await sb.from('email_sends').select('*', { count: 'exact', head: true });
      return { stats: { total_users, premium_users, total_campaigns, total_emails_sent: total_emails } };
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
      const id = adminPlanMatch[1];
      const sb = getSB();
      const { error } = await sb.from('profiles').update({ plan: body.plan }).eq('id', id);
      if (error) throw new Error(error.message);
      return { message: 'Plan updated.' };
    }

    const adminAdminMatch = clean.match(/^\/admin\/users\/([^/]+)\/admin$/);
    if (adminAdminMatch && method === 'PUT') {
      const id = adminAdminMatch[1];
      const sb = getSB();
      const { error } = await sb.from('profiles').update({ is_admin: body.is_admin }).eq('id', id);
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

    const scheduleMatch = clean.match(/^\/schedule\/([^/]+)$/);
    if (scheduleMatch && method === 'DELETE') {
      const id = scheduleMatch[1];
      const sb = getSB();
      await sb.from('scheduled_sends').delete().eq('id', id).eq('user_id', uid());
      return { message: 'Deleted.' };
    }

    // ── AI GENERATE ───────────────────────────────────────────────────────────
    if (clean.startsWith('/ai/')) {
      if (typeof toast === 'function') toast('AI generation needs the backend server. Coming soon!', 'warn');
      throw new Error('AI generation requires backend server');
    }

    // ── OUTREACH / EMAIL SEND ─────────────────────────────────────────────────
    if (clean.startsWith('/outreach/')) {
      if (typeof toast === 'function') toast('Email sending needs the backend server. Coming soon!', 'warn');
      throw new Error('Email sending requires backend server');
    }

    // ── WHATSAPP ──────────────────────────────────────────────────────────────
    if (clean.startsWith('/whatsapp/')) {
      if (typeof toast === 'function') toast('WhatsApp needs the backend server. Coming soon!', 'warn');
      throw new Error('WhatsApp requires backend server');
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

    if (clean.startsWith('/user/brevo-slots')) {
      if (typeof toast === 'function') toast('Brevo slots need the backend server.', 'warn');
      throw new Error('Brevo slots require backend server');
    }

    if (clean === '/user/activity' && method === 'GET') {
      const data = await sbFetch(`/rest/v1/activity_logs?user_id=eq.${uid()}&select=*&order=created_at.desc&limit=50`);
      return { logs: Array.isArray(data) ? data : [] };
    }

    console.warn('[supabase-api] Unhandled route:', method, clean);
    throw new Error('Route not implemented: ' + method + ' ' + clean);
  };

  console.log('[LeadForge] Supabase-direct mode active');
})();
