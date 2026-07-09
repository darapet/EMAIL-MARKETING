/**
 * app.js — LeadForge Frontend Application
 * Handles: Navigation, Wizard, Campaign management,
 * WhatsApp session (Socket.io), Email outreach (Brevo REST), Settings
 */

// ═══════════════════════════════════════════════════
// 1. GLOBAL STATE
// ═══════════════════════════════════════════════════
const App = {
  currentPage: 'dashboard',
  wizardStep: 1,
  selectedChannels: new Set(['email', 'whatsapp', 'website']),
  selectedCountries: [],
  campaigns: [],
  leads: [],
  socket: null,
  waConnected: false,
  broadcastSource: 'campaign',
  userProfile: JSON.parse(localStorage.getItem('lf_profile') || '{}'),
};

// ═══════════════════════════════════════════════════
// 2. SOCKET.IO INITIALISATION
// ═══════════════════════════════════════════════════
function initSocket() {
  if (typeof io === 'undefined') {
    console.warn('[Socket] socket.io not loaded — WhatsApp/scraping real-time unavailable');
    return;
  }
  const serverUrl = (window.__LF_API_BASE || '').replace(/\/$/, '') || window.location.origin;
  const token = (typeof getAuthToken === 'function' && getAuthToken()) || null;
  const authPayload = token
    ? { token }
    : { userId: (typeof getCurrentUserId === 'function' && getCurrentUserId()) || 'anon' };

  App.socket = io(serverUrl, { transports: ['websocket'], auth: authPayload });

  App.socket.on('connect', () => console.log('[WS] Connected:', App.socket.id));
  App.socket.on('qr',               (qrDataUrl) => showQRCode(qrDataUrl));
  App.socket.on('wa_connected',     (info)       => { setWAConnected(true, info); toast('WhatsApp connected!', 'success'); });
  App.socket.on('wa_disconnected',  ()           => { setWAConnected(false); toast('WhatsApp disconnected', 'warn'); });
  App.socket.on('scrape_log',       (msg)        => appendScrapeLog(msg.text, msg.type || 'info'));
  App.socket.on('scrape_progress',  (data)       => updateScrapeProgress(data));
  App.socket.on('scrape_complete',  (data)       => onScrapeComplete(data));
  App.socket.on('broadcast_log',    (msg)        => appendBroadcastLog(msg.text, msg.type || 'info'));
}

// ═══════════════════════════════════════════════════
// 3. NAVIGATION
// ═══════════════════════════════════════════════════
function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.page').forEach(el  => el.classList.remove('active'));

  const navEl  = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl)  navEl.classList.add('active');
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  const titles = {
    dashboard:  ['Dashboard',       'Overview'],
    campaigns:  ['Campaigns',       'All scraping campaigns'],
    scraper:    ['Lead Scraper',    'Wizard — configure & launch'],
    leads:      ['Leads',           'Browse and manage leads'],
    whatsapp:   ['WhatsApp',        'Session manager & broadcast'],
    outreach:   ['Send Outreach',   'Email campaign builder'],
    analytics:  ['Analytics',       'Performance metrics'],
    settings:   ['Settings',        'Account & configuration'],
    templates:  ['Email Templates', 'Manage reusable email templates'],
    admin:      ['Admin Panel',     'Platform management'],
    automation: ['Automation',      'Schedule email & WhatsApp sends'],
  };
  if (titles[page]) {
    document.getElementById('pageTitle').textContent   = titles[page][0];
    document.getElementById('breadcrumb').textContent  = titles[page][1];
  }

  App.currentPage = page;

  if (page === 'campaigns') renderCampaignsTable();
  if (page === 'leads')     populateCampaignFilter();
  if (page === 'outreach')  { populateEmailCampaignSelect(); if (typeof loadTemplates === 'function') loadTemplates(); }
  if (page === 'whatsapp')  populateBroadcastCampaignSelect();
  if (page === 'templates') { if (typeof loadTemplates === 'function') loadTemplates(); }
  if (page === 'admin')     { if (typeof loadAdminDashboard === 'function') loadAdminDashboard(); }
  if (page === 'automation'){ if (typeof loadSchedules === 'function') loadSchedules(); }
}

// ═══════════════════════════════════════════════════
// 4. SCRAPER WIZARD
// ═══════════════════════════════════════════════════
// COUNTRIES is defined in locations.js (loaded before this script)

function renderCountries(list) {
  const grid = document.getElementById('countriesGrid');
  if (!grid) return;
  grid.innerHTML = list.map(c => `
    <label class="country-card" onclick="toggleCountry('${c.code}')">
      <input type="checkbox" id="country-${c.code}">
      <span class="country-flag">${getFlagEmoji(c.code)}</span>
      <span class="country-name">${c.name}</span>
    </label>
  `).join('');
}

function getFlagEmoji(code) {
  return code.toUpperCase().split('').map(c => String.fromCodePoint(127397 + c.charCodeAt(0))).join('');
}

function toggleCountry(code) {
  const country = COUNTRIES.find(c => c.code === code);
  if (!country) return;
  const idx = App.selectedCountries.findIndex(c => c.code === code);
  const cb  = document.getElementById(`country-${code}`);
  if (idx >= 0) {
    App.selectedCountries.splice(idx, 1);
    if (cb) cb.checked = false;
  } else {
    App.selectedCountries.push({ ...country, selectedStates: [] });
    if (cb) cb.checked = true;
  }
  renderSelectedRegions();
}

function renderSelectedRegions() {
  const container = document.getElementById('selectedRegions');
  if (!container) return;
  if (!App.selectedCountries.length) {
    container.innerHTML = '<p class="empty-state">No countries selected yet. Pick from the grid above.</p>';
    return;
  }
  container.innerHTML = App.selectedCountries.map(c => `
    <div class="region-group">
      <div class="region-header">
        <strong>${c.name}</strong>
        <button class="btn-link" onclick="selectAllStates('${c.code}')">Toggle all</button>
      </div>
      <div class="state-chips">${c.states.map(s => `
        <label class="state-chip ${c.selectedStates.includes(s) ? 'selected' : ''}" onclick="toggleState('${c.code}','${s.replace(/'/g,"\\'")}')">
          <input type="checkbox" ${c.selectedStates.includes(s) ? 'checked' : ''}> ${s}
        </label>
      `).join('')}</div>
    </div>
  `).join('');
}

function toggleState(code, state) {
  const c = App.selectedCountries.find(x => x.code === code);
  if (!c) return;
  const i = c.selectedStates.indexOf(state);
  if (i >= 0) c.selectedStates.splice(i, 1);
  else c.selectedStates.push(state);
  renderSelectedRegions();
}

function wizardNext() {
  if (App.wizardStep >= 4) return;
  App.wizardStep++;
  updateWizardStep();
}

function wizardBack() {
  if (App.wizardStep <= 1) return;
  App.wizardStep--;
  updateWizardStep();
}

function updateWizardStep() {
  document.querySelectorAll('.wizard-step').forEach((el, i) => {
    el.classList.toggle('active',   i + 1 === App.wizardStep);
    el.classList.toggle('done',     i + 1 <  App.wizardStep);
  });
  document.querySelectorAll('.wizard-panel').forEach((el, i) => {
    el.classList.toggle('active', i + 1 === App.wizardStep);
  });
}

async function launchScraper() {
  const name  = document.getElementById('campaignName').value.trim();
  const niche = document.getElementById('nicheInput').value.trim();
  const depth = parseInt(document.getElementById('scrapeDepth')?.value || 2);

  const channels  = [...App.selectedChannels];
  const locations = App.selectedCountries.map(c => ({
    code:   c.code,
    name:   c.name,
    states: c.selectedStates.length ? c.selectedStates : c.states.slice(0, 3),
  }));

  if (!name || !niche) { toast('Campaign name and niche are required', 'warn'); return; }

  const btn      = document.getElementById('launchBtn');
  btn.disabled   = true;
  btn.textContent = 'Launching...';

  const progress = document.getElementById('scrapeProgress');
  progress.style.display = 'block';
  document.getElementById('scrapeLog').innerHTML = '';

  try {
    const emailCount = typeof getEmailCount === 'function' ? getEmailCount() : 50;

    // Create campaign record in Supabase first
    const sb  = getSupabase();
    const uid = getCurrentUserId();
    const { data: campaign, error } = await sb.from('campaigns').insert({
      user_id:     uid,
      name,
      niche,
      channels,
      locations,
      depth,
      email_count: emailCount,
      status:      'running',
      leads_count: 0,
      emails_sent: 0,
    }).select().single();

    if (error) throw error;

    const mapped = mapCampaign(campaign);
    App.campaigns.unshift(mapped);
    updateBadge('campaignBadge', App.campaigns.length);
    updateDashboardStats();

    appendScrapeLog(`Campaign "${name}" created. Starting scraper...`, 'info');

    // Try to kick off real-time scraping via socket if available
    if (App.socket?.connected) {
      App.socket.emit('start_scrape', { campaignId: campaign.id, name, niche, depth, channels, locations, emailCount });
      toast(`Campaign "${name}" started!`, 'success');
    } else {
      appendScrapeLog('Real-time scraping requires the backend server. Campaign saved — leads will appear here when the scraper runs.', 'warn');
      document.getElementById('scrapeProgressBar').style.width = '100%';
      document.getElementById('scrapeStatusText').textContent  = 'Campaign saved — awaiting scraper';
      btn.disabled   = false;
      btn.innerHTML  = `<span>🚀</span> Launch Scrape`;
      toast(`Campaign "${name}" saved!`, 'success');
    }
  } catch (err) {
    toast('Failed to launch campaign: ' + err.message, 'error');
    btn.disabled   = false;
    btn.innerHTML  = `<span>🚀</span> Launch Scrape`;
  }
}

// ── Helper: map Supabase snake_case → frontend camelCase ─────────────────────
function mapCampaign(c) {
  return {
    campaignId:  c.id,
    id:          c.id,
    name:        c.name,
    niche:       c.niche,
    status:      c.status      || 'pending',
    leadsCount:  c.leads_count || 0,
    emailsSent:  c.emails_sent || 0,
    createdAt:   c.created_at,
    channels:    c.channels    || [],
    locations:   c.locations   || [],
  };
}

function mapLead(l) {
  return {
    id:           l.id,
    campaignId:   l.campaign_id,
    businessName: l.business_name || '',
    email:        l.email        || '',
    phone:        l.phone        || '',
    waVerified:   l.wa_verified  || false,
    status:       l.status       || 'pending',
    socialUrls:   Array.isArray(l.social_urls) ? l.social_urls : [],
    createdAt:    l.created_at,
  };
}

function updateScrapeProgress({ percent, found, processed, waVerified, status }) {
  document.getElementById('scrapeProgressBar').style.width = `${percent}%`;
  document.getElementById('scrapeStatusText').textContent  = status || 'Scraping...';
  if (found     !== undefined) document.getElementById('foundCount').textContent     = found;
  if (processed !== undefined) document.getElementById('processedCount').textContent = processed;
  if (waVerified !== undefined) document.getElementById('waVerifiedCount').textContent = waVerified;
}

function onScrapeComplete(data) {
  document.getElementById('scrapeProgressBar').style.width = '100%';
  document.getElementById('scrapeStatusText').textContent  = '✓ Scrape complete!';
  document.getElementById('launchBtn').disabled   = false;
  document.getElementById('launchBtn').innerHTML  = `<span>🚀</span> Launch Scrape`;
  appendScrapeLog(`✓ Done! Found ${data.totalLeads} leads.`, 'success');
  updateBadge('leadsBadge', data.totalLeads);
  toast(`Scrape complete — ${data.totalLeads} leads found`, 'success');
  if (data.campaignId && data.totalLeads > 0 && typeof showScrapedPreview === 'function') {
    setTimeout(() => showScrapedPreview(data.campaignId, data.totalLeads), 800);
  }
  loadCampaigns(); // refresh from Supabase
}

function appendScrapeLog(text, type = 'info') {
  const log  = document.getElementById('scrapeLog');
  const line = document.createElement('div');
  line.className   = `log-line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

// ═══════════════════════════════════════════════════
// 5. CAMPAIGNS TABLE — Supabase direct
// ═══════════════════════════════════════════════════
async function loadCampaigns() {
  try {
    const sb  = getSupabase();
    const uid = getCurrentUserId();
    if (!sb || !uid) return;

    const { data, error } = await sb
      .from('campaigns')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });

    if (error) throw error;

    App.campaigns = (data || []).map(mapCampaign);
    updateBadge('campaignBadge', App.campaigns.length);
    renderCampaignsTable();
    updateDashboardStats();
  } catch (err) {
    console.error('Failed to load campaigns:', err);
  }
}

function renderCampaignsTable(list) {
  const rows  = list || App.campaigns;
  const tbody = document.getElementById('campaignsBody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted)">
      No campaigns yet. <a href="#" onclick="navigateTo('scraper')">Start your first scrape →</a>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(c => {
    const cid = esc(c.campaignId || c.id || '');
    return `<tr>
      <td><strong>${esc(c.niche || c.name || '')}</strong><br><small style="color:var(--text-muted)">${esc(c.name || '')}</small></td>
      <td><span class="badge badge-${c.status}">${esc(c.status || 'pending')}</span></td>
      <td>${c.leadsCount || 0}</td>
      <td>${c.emailsSent || 0}</td>
      <td>${formatDate(c.createdAt)}</td>
      <td>
        <button class="btn-icon" title="View Leads" onclick="viewCampaignLeads('${cid}')">👁</button>
        <button class="btn-icon" title="Send Outreach" onclick="outreachForCampaign('${cid}')">✉</button>
      </td>
    </tr>`;
  }).join('');
}

function filterCampaigns() {
  const q      = document.getElementById('campaignsSearch')?.value.toLowerCase();
  const status = document.getElementById('campaignsStatusFilter')?.value;
  let rows = App.campaigns;
  if (status) rows = rows.filter(c => c.status === status);
  if (q)      rows = rows.filter(c =>
    (c.niche || '').toLowerCase().includes(q) ||
    (c.name  || '').toLowerCase().includes(q)
  );
  renderCampaignsTable(rows);
}

function viewCampaignLeads(campaignId) {
  navigateTo('leads');
  const filter = document.getElementById('leadsCampaignFilter');
  if (filter) { filter.value = campaignId; loadLeadsForCampaign(campaignId); }
}

function outreachForCampaign(campaignId) {
  navigateTo('outreach');
  const sel = document.getElementById('emailCampaignSelect');
  if (sel) sel.value = campaignId;
}

// ═══════════════════════════════════════════════════
// 6. LEADS TABLE — Supabase direct
// ═══════════════════════════════════════════════════
async function loadLeadsForCampaign(campaignId) {
  if (!campaignId) return;
  try {
    const sb = getSupabase();
    if (!sb) return;

    const { data, error } = await sb
      .from('leads')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    App.leads = (data || []).map(mapLead);
    updateBadge('leadsBadge', App.leads.length);
    renderLeadsTable();
  } catch (err) {
    toast('Failed to load leads', 'error');
  }
}

function populateCampaignFilter() {
  const sel = document.getElementById('leadsCampaignFilter');
  if (!sel) return;
  sel.innerHTML = '<option value="">Select campaign...</option>' +
    App.campaigns.map(c => `<option value="${esc(c.id)}">${esc(c.niche)} — ${formatDate(c.createdAt)}</option>`).join('');
}

function renderLeadsTable(list) {
  const rows  = list || App.leads;
  const tbody = document.getElementById('leadsBody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted)">No leads found. Select a campaign above.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((lead, i) => `
    <tr>
      <td><input type="checkbox" class="lead-cb" data-id="${esc(lead.id)}"></td>
      <td><strong>${esc(lead.businessName || '—')}</strong></td>
      <td>${lead.email ? `<a href="mailto:${esc(lead.email)}">${esc(lead.email)}</a>` : '—'}</td>
      <td>${lead.phone ? esc(lead.phone) : '—'}</td>
      <td>${lead.socialUrls.slice(0,3).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(getDomain(u))}</a>`).join(' ')}${lead.socialUrls.length > 3 ? ` +${lead.socialUrls.length - 3}` : ''}</td>
      <td>${lead.waVerified ? '✓ Yes' : 'No'}</td>
      <td>${lead.status || 'pending'}</td>
      <td>
        <button class="btn-icon" onclick="showLeadDetail(${i})">Details</button>
        ${lead.status !== 'optout' ? `<button class="btn-icon" onclick="outreachForCampaign('${esc(lead.campaignId)}')">Send</button>` : ''}
      </td>
    </tr>
  `).join('');
}

function filterLeads() {
  const campaign = document.getElementById('leadsCampaignFilter')?.value;
  const status   = document.getElementById('leadsStatusFilter')?.value;
  const q        = document.getElementById('leadsSearch')?.value.toLowerCase();

  let filtered = App.leads;
  if (status) filtered = filtered.filter(l => l.status === status);
  if (q)      filtered = filtered.filter(l =>
    (l.businessName || '').toLowerCase().includes(q) ||
    (l.email        || '').toLowerCase().includes(q) ||
    (l.phone        || '').includes(q)
  );
  renderLeadsTable(filtered);
}

function toggleSelectAll(cb) {
  document.querySelectorAll('.lead-cb').forEach(el => { el.checked = cb.checked; });
}

function bulkOutreach() {
  const selected = [...document.querySelectorAll('.lead-cb:checked')].map(el => el.dataset.id);
  if (!selected.length) { toast('Select at least one lead', 'warn'); return; }
  navigateTo('outreach');
  toast(`${selected.length} leads queued for outreach`, 'info');
}

function showLeadDetail(idx) {
  const lead = App.leads[idx];
  if (!lead) return;
  document.getElementById('leadDetailBody').innerHTML = `
    <table class="detail-table">
      <tr><td>Business Name</td><td><strong>${esc(lead.businessName || '—')}</strong></td></tr>
      <tr><td>Email</td><td>${lead.email || '—'}</td></tr>
      <tr><td>Phone</td><td>${lead.phone || '—'}</td></tr>
      <tr><td>WA Verified</td><td>${lead.waVerified ? 'Yes' : 'No'}</td></tr>
      <tr><td>Status</td><td>${lead.status || 'pending'}</td></tr>
      <tr><td>Social Links</td><td>${(lead.socialUrls || []).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join('<br>')}</td></tr>
      <tr><td>Added</td><td>${formatDate(lead.createdAt)}</td></tr>
    </table>
  `;
  openModal('leadDetailModal');
}

async function exportLeads(format) {
  if (!App.leads.length) { toast('No leads to export', 'warn'); return; }
  const headers = ['Business Name', 'Email', 'Phone', 'WA Verified', 'Status', 'Social Links'];
  const rows    = App.leads.map(l => [
    l.businessName, l.email, l.phone,
    l.waVerified ? 'Yes' : 'No',
    l.status,
    (l.socialUrls || []).join(' | '),
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${(v || '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadFile(`leads_export_${Date.now()}.csv`, 'text/csv', csv);
  toast('CSV downloaded', 'success');
}

// ═══════════════════════════════════════════════════
// 7. WHATSAPP SESSION (Socket.io)
// ═══════════════════════════════════════════════════
function generateQR() {
  if (!App.socket?.connected) { toast('Server connection not available — add backend URL in Settings', 'error'); return; }
  setWAStatus('connecting');
  App.socket.emit('wa_init');
  document.getElementById('qrPlaceholder').style.display  = 'none';
  document.getElementById('qrImageWrap').style.display    = 'none';
  toast('Requesting QR code...', 'info');
}

function showQRCode(dataUrl) {
  document.getElementById('qrImage').src                  = dataUrl;
  document.getElementById('qrPlaceholder').style.display  = 'none';
  document.getElementById('qrImageWrap').style.display    = 'block';
  document.getElementById('waConnectedState').style.display = 'none';
  startQRCountdown(60);
}

let qrTimer;
function startQRCountdown(seconds) {
  clearInterval(qrTimer);
  let s = seconds;
  document.getElementById('qrTimer').textContent = s;
  qrTimer = setInterval(() => {
    s--;
    document.getElementById('qrTimer').textContent = s;
    if (s <= 0) {
      clearInterval(qrTimer);
      document.getElementById('qrImageWrap').style.display = 'none';
      document.getElementById('qrPlaceholder').style.display = 'block';
      setWAStatus('disconnected');
      toast('QR code expired. Generate a new one.', 'warn');
    }
  }, 1000);
}

function setWAConnected(connected, info = {}) {
  App.waConnected = connected;
  clearInterval(qrTimer);

  const badge     = document.getElementById('waStatusBadge');
  const dot       = badge.querySelector('.status-dot');
  const text      = document.getElementById('waStatusText');
  const navStatus = document.getElementById('waStatus');

  if (connected) {
    dot.className  = 'status-dot connected';
    text.textContent = 'Connected';
    navStatus.className   = 'nav-status online';
    navStatus.textContent = '●';
    document.getElementById('qrPlaceholder').style.display   = 'none';
    document.getElementById('qrImageWrap').style.display     = 'none';
    document.getElementById('waConnectedState').style.display = 'flex';
    document.getElementById('generateQrBtn').style.display   = 'none';
    document.getElementById('disconnectWaBtn').style.display = 'block';
    document.getElementById('waConnectedName').textContent   = info.name  || 'Connected';
    document.getElementById('waConnectedPhone').textContent  = info.phone || '';
  } else {
    setWAStatus('disconnected');
    document.getElementById('waConnectedState').style.display = 'none';
    document.getElementById('qrPlaceholder').style.display   = 'block';
    document.getElementById('generateQrBtn').style.display   = 'block';
    document.getElementById('disconnectWaBtn').style.display = 'none';
  }
}

function setWAStatus(status) {
  const badge  = document.getElementById('waStatusBadge');
  const dot    = badge?.querySelector('.status-dot');
  const text   = document.getElementById('waStatusText');
  const nav    = document.getElementById('waStatus');
  const labels = { disconnected: 'Disconnected', connecting: 'Connecting...', connected: 'Connected' };
  if (dot)  dot.className    = `status-dot ${status}`;
  if (text) text.textContent = labels[status];
  if (nav)  { nav.className = `nav-status${status === 'connected' ? ' online' : ''}`; nav.textContent = '●'; }
}

async function disconnectWA() {
  if (App.socket?.connected) {
    App.socket.emit('wa_disconnect');
  }
  setWAConnected(false);
  toast('WhatsApp disconnected', 'info');
}

function setBroadcastSource(src) {
  App.broadcastSource = src;
  document.getElementById('toggleCampaign').classList.toggle('active', src === 'campaign');
  document.getElementById('toggleContacts').classList.toggle('active', src === 'contacts');
  document.getElementById('broadcastCampaignWrap').style.display = src === 'campaign' ? 'block' : 'none';
}

function populateBroadcastCampaignSelect() {
  const sel = document.getElementById('broadcastCampaignSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">Choose campaign...</option>' +
    App.campaigns.map(c => `<option value="${esc(c.id)}">${esc(c.niche)} (${c.leadsCount || 0} leads)</option>`).join('');
}

function insertVar(v) {
  const ta  = document.getElementById('waMessage');
  if (!ta)  return;
  const pos = ta.selectionStart;
  ta.value  = ta.value.slice(0, pos) + v + ta.value.slice(pos);
  ta.focus();
}

async function startWABroadcast() {
  if (!App.waConnected) { toast('Connect WhatsApp first', 'warn'); return; }
  const message    = document.getElementById('waMessage').value.trim();
  const campaignId = document.getElementById('broadcastCampaignSelect').value;
  const minDelay   = parseInt(document.querySelector('#page-whatsapp .delay-range input:first-of-type')?.value || 60);
  const maxDelay   = parseInt(document.querySelector('#page-whatsapp .delay-range input:last-of-type')?.value  || 180);
  if (!message) { toast('Please write a message', 'warn'); return; }
  if (App.broadcastSource === 'campaign' && !campaignId) { toast('Select a campaign', 'warn'); return; }

  const log = document.getElementById('broadcastLog');
  log.style.display = 'block';
  log.innerHTML     = '';

  if (!App.socket?.connected) { toast('Backend server required for WhatsApp broadcast', 'error'); return; }

  try {
    App.socket.emit('start_broadcast', { campaignId, message, minDelay, maxDelay, source: App.broadcastSource });
    toast('Broadcast started!', 'success');
  } catch (err) {
    toast('Broadcast failed: ' + err.message, 'error');
  }
}

function appendBroadcastLog(text, type = 'info') {
  const log = document.getElementById('broadcastLog');
  if (!log) return;
  const line       = document.createElement('div');
  line.className   = `log-line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  log.appendChild(line);
  log.scrollTop    = log.scrollHeight;
}

// ═══════════════════════════════════════════════════
// 8. EMAIL OUTREACH — Brevo REST API (browser-side, no backend needed)
// ═══════════════════════════════════════════════════
function populateEmailCampaignSelect() {
  const sel = document.getElementById('emailCampaignSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">Choose campaign...</option>' +
    App.campaigns.map(c => `<option value="${esc(c.id)}">${esc(c.niche)} (${c.leadsCount || 0} leads)</option>`).join('');
}

function insertEmailVar(v) {
  const ta  = document.getElementById('emailBody');
  if (!ta)  return;
  const pos = ta.selectionStart;
  ta.value  = ta.value.slice(0, pos) + v + ta.value.slice(pos);
  ta.focus();
}

function previewEmail() {
  const body    = document.getElementById('emailBody').value;
  const subject = document.getElementById('emailSubject').value;
  const profile = App.userProfile;
  const logoUrl = document.getElementById('brandLogoUrl')?.value || '';
  const html    = buildEmailHTML({ body, subject, logoUrl, phone: profile.phone, company: profile.company, businessName: 'Sample Business', niche: 'Your Niche' });
  document.getElementById('emailPreviewIframe').srcdoc = html;
  openModal('emailPreviewModal');
}

function buildEmailHTML({ body, subject, logoUrl, phone, company, businessName, niche }) {
  const filled = body
    .replace(/{businessName}/g, businessName || '')
    .replace(/{niche}/g,        niche        || '')
    .replace(/{yourName}/g,     App.userProfile.name    || 'Your Name')
    .replace(/{yourCompany}/g,  company                  || 'Your Company');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>body{font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333}
    .logo{text-align:center;margin-bottom:20px}.content{line-height:1.6}
    .footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;font-size:12px;color:#666}</style>
  </head><body>
    ${logoUrl ? `<div class="logo"><img src="${esc(logoUrl)}" alt="Logo" style="max-height:60px"></div>` : ''}
    <div class="content">${filled.replace(/\n/g, '<br>')}</div>
    <div class="footer">${company || ''}${phone ? ` · ${phone}` : ''}</div>
  </body></html>`;
}

// ── Get best available Brevo key ──────────────────────────────────────────────
function getBrevoKey() {
  return App.userProfile.brevo_key
    || App.userProfile.brevoApiKey
    || App.userProfile.brevo_slots?.[0]?.key
    || '';
}

async function sendTestEmail() {
  const profile  = App.userProfile;
  const email    = profile.email;
  if (!email) { toast('Set your email in Settings first', 'warn'); return; }

  const brevoKey = getBrevoKey();
  if (!brevoKey) { toast('Add your Brevo API key in Settings → API Keys first', 'warn'); return; }

  const body    = document.getElementById('emailBody').value;
  const subject = document.getElementById('emailSubject').value;
  const logoUrl = document.getElementById('brandLogoUrl')?.value || '';
  const html    = buildEmailHTML({ body, subject, logoUrl, phone: profile.phone, company: profile.company, businessName: 'Test Business', niche: 'Test Niche' });

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': brevoKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender:      { name: profile.name || 'LeadForge', email },
        to:          [{ email }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    toast('Test email sent to ' + email, 'success');
  } catch (err) {
    toast('Failed to send test: ' + err.message, 'error');
  }
}

async function startEmailCampaign() {
  const campaignId = document.getElementById('emailCampaignSelect').value;
  const subject    = document.getElementById('emailSubject').value.trim();
  const body       = document.getElementById('emailBody').value.trim();

  if (!campaignId) { toast('Select a campaign', 'warn'); return; }
  if (!subject || !body) { toast('Subject and body are required', 'warn'); return; }

  const brevoKey = getBrevoKey();
  if (!brevoKey) { toast('Add your Brevo API key in Settings → API Keys first', 'warn'); return; }

  const profile   = App.userProfile;
  const senderEmail = profile.email;
  if (!senderEmail) { toast('Set your email in Settings first', 'warn'); return; }

  // Load leads from Supabase
  const sb = getSupabase();
  if (!sb) { toast('Supabase not available — check your anon key in index.html', 'error'); return; }
  const { data: leadsData } = await sb
    .from('leads')
    .select('*')
    .eq('campaign_id', campaignId)
    .not('email', 'is', null)
    .neq('status', 'optout');

  if (!leadsData?.length) { toast('No leads with email in this campaign', 'warn'); return; }

  const pendingIds = App._pendingLeadIds?.length ? App._pendingLeadIds : null;
  const targets    = pendingIds ? leadsData.filter(l => pendingIds.includes(l.id)) : leadsData;
  const campaign   = App.campaigns.find(c => c.id === campaignId);
  const logoUrl    = document.getElementById('brandLogoUrl')?.value || profile.logo_url || '';
  const includeLogo  = document.getElementById('includeLogo')?.checked;
  const includePhone = document.getElementById('includePhone')?.checked;

  toast(`Sending to ${targets.length} leads...`, 'info');
  let sent = 0;

  for (const lead of targets) {
    if (!lead.email) continue;
    const html = buildEmailHTML({
      body, subject,
      logoUrl: includeLogo ? logoUrl : '',
      phone:   includePhone ? profile.phone : '',
      company: profile.company,
      businessName: lead.business_name || '',
      niche:        campaign?.niche || '',
    });

    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': brevoKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender:      { name: profile.name || 'LeadForge', email: senderEmail },
          to:          [{ email: lead.email, name: lead.business_name || '' }],
          subject,
          htmlContent: html,
        }),
      });
      if (res.ok) {
        sent++;
        // Mark lead as contacted in Supabase
        await sb.from('leads').update({ status: 'contacted' }).eq('id', lead.id);
      }
    } catch (_) { /* continue to next lead */ }

    // Small delay to respect rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  // Update campaign email count in Supabase
  await sb.from('campaigns')
    .update({ emails_sent: (campaign?.emailsSent || 0) + sent })
    .eq('id', campaignId);

  App._pendingLeadIds = [];
  toast(`Email campaign done — ${sent} of ${targets.length} sent`, 'success');
  loadCampaigns(); // refresh counts
}

function setPreviewMode(mode) {
  const frame = document.getElementById('emailPreviewIframe');
  document.querySelectorAll('.preview-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  if (mode === 'mobile') { frame.style.width = '375px'; frame.style.margin = '0 auto'; }
  else { frame.style.width = '100%'; frame.style.margin = ''; }
}

// ═══════════════════════════════════════════════════
// 9. SETTINGS — Supabase direct
// ═══════════════════════════════════════════════════
document.querySelectorAll('.settings-nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.settings-tab').forEach(t  => t.classList.remove('active'));
    btn.classList.add('active');
    const tab = document.getElementById(`settings-${btn.dataset.settingsTab}`);
    if (tab) tab.classList.add('active');
    if (btn.dataset.settingsTab === 'apikeys' && typeof loadBrevoSlots === 'function') loadBrevoSlots();
  });
});

async function saveProfile() {
  App.userProfile = {
    ...App.userProfile,
    name:    document.getElementById('profileName').value,
    email:   document.getElementById('profileEmail').value,
    company: document.getElementById('profileCompany').value,
    phone:   document.getElementById('profilePhone').value,
    desc:    document.getElementById('profileDesc').value,
  };
  localStorage.setItem('lf_profile', JSON.stringify(App.userProfile));
  _updateLocalNameUI(App.userProfile.name);

  try {
    const sb  = getSupabase();
    const uid = getCurrentUserId();
    if (sb && uid) {
      await sb.from('profiles').upsert({
        id:      uid,
        name:    App.userProfile.name,
        email:   App.userProfile.email,
        company: App.userProfile.company,
        phone:   App.userProfile.phone,
        desc:    App.userProfile.desc,
      }, { onConflict: 'id' });
    }
    toast('Profile saved', 'success');
  } catch (err) {
    toast('Error saving profile: ' + err.message, 'error');
  }
}

async function saveBranding() {
  const logoUrl = document.getElementById('brandLogoUrl')?.value  || App.userProfile.logo_url      || '';
  const sigUrl  = document.getElementById('brandSigUrl')?.value   || App.userProfile.signature_url  || '';
  const color   = document.getElementById('brandColor')?.value    || '#dc2626';

  App.userProfile.logo_url      = logoUrl;
  App.userProfile.signature_url = sigUrl;
  App.userProfile.brand_color   = color;
  localStorage.setItem('lf_profile', JSON.stringify(App.userProfile));

  try {
    const sb  = getSupabase();
    const uid = getCurrentUserId();
    if (sb && uid) {
      await sb.from('profiles').upsert({
        id:            uid,
        logo_url:      logoUrl,
        signature_url: sigUrl,
        brand_color:   color,
      }, { onConflict: 'id' });
    }
    toast('Branding saved', 'success');
  } catch (err) {
    toast('Error saving: ' + err.message, 'error');
  }
}

async function saveApiKeys() {
  if (!App.isPremium) { showPremiumModal(); return; }

  const updates = {};
  const brevo  = document.getElementById('brevoApiKey')?.value.trim();
  const sg     = document.getElementById('sendgridApiKey')?.value.trim();
  const mg     = document.getElementById('mailgunApiKey')?.value.trim();
  const mgd    = document.getElementById('mailgunDomain')?.value.trim();
  const groq   = document.getElementById('groqApiKey')?.value.trim();

  if (brevo) updates.brevo_key      = brevo;
  if (sg)    updates.sendgrid_key   = sg;
  if (mg)    updates.mailgun_key    = mg;
  if (mgd)   updates.mailgun_domain = mgd;
  if (groq)  updates.groq_key       = groq;

  Object.assign(App.userProfile, updates);
  localStorage.setItem('lf_profile', JSON.stringify(App.userProfile));

  try {
    const sb  = getSupabase();
    const uid = getCurrentUserId();
    if (sb && uid) {
      await sb.from('profiles').upsert({ id: uid, ...updates }, { onConflict: 'id' });
    }
    toast('API keys saved securely', 'success');
  } catch (err) {
    toast('Error saving keys: ' + err.message, 'error');
  }
}

function saveNotifications() { toast('Preferences saved', 'success'); }

function previewLogo(url) {
  const container = document.getElementById('logoPreview');
  if (!container) return;
  if (!url) { container.innerHTML = 'Preview'; return; }
  const img   = document.createElement('img');
  img.src     = url; img.alt = 'Logo'; img.style = 'width:100%;height:100%;object-fit:contain';
  img.onerror = function() { container.innerHTML = 'Invalid'; };
  container.innerHTML = ''; container.appendChild(img);
}

function toggleVisibility(id) {
  const input  = document.getElementById(id);
  input.type   = input.type === 'password' ? 'text' : 'password';
}

function loadProfileIntoForm() {
  const p = App.userProfile;
  if (p.name)    document.getElementById('profileName').value    = p.name;
  if (p.email)   document.getElementById('profileEmail').value   = p.email;
  if (p.company) document.getElementById('profileCompany').value = p.company;
  if (p.phone)   document.getElementById('profilePhone').value   = p.phone;
  if (p.desc)    document.getElementById('profileDesc').value    = p.desc;
  const logoUrl = p.logo_url || p.logoUrl;
  if (logoUrl) {
    const el = document.getElementById('brandLogoUrl');
    if (el) el.value = logoUrl;
    previewLogo(logoUrl);
    const nm = document.getElementById('brandLogoName');
    if (nm) nm.textContent = 'Current logo loaded';
  }
  if (p.signature_url) {
    const el = document.getElementById('brandSigUrl');
    if (el) el.value = p.signature_url;
    const prev = document.getElementById('sigPreview');
    if (prev) prev.innerHTML = `<img src="${p.signature_url}" alt="Signature" style="max-width:200px">`;
    const nm = document.getElementById('brandSigName');
    if (nm) nm.textContent = 'Current signature loaded';
  }
  if (p.brand_color || p.brandColor) {
    const el = document.getElementById('brandColor');
    if (el) el.value = p.brand_color || p.brandColor;
  }
}

function _updateLocalNameUI(name) {
  if (!name) return;
  const nameEl   = document.getElementById('userName');
  const avatarEl = document.getElementById('userAvatar');
  if (nameEl)   nameEl.textContent   = name;
  if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
}

// ═══════════════════════════════════════════════════
// 10. DASHBOARD
// ═══════════════════════════════════════════════════
function updateDashboardStats() {
  const totalLeads = App.campaigns.reduce((sum, c) => sum + (c.leadsCount || 0), 0);
  const totalSent  = App.campaigns.reduce((sum, c) => sum + (c.emailsSent || 0), 0);
  const running    = App.campaigns.filter(c => c.status === 'running').length;
  const statLeads  = document.getElementById('statTotalLeads');
  const statSent   = document.getElementById('statEmailsSent');
  const statCamp   = document.getElementById('statCampaigns');
  if (statLeads) statLeads.textContent = totalLeads;
  if (statSent)  statSent.textContent  = totalSent;
  if (statCamp)  statCamp.textContent  = App.campaigns.length;
  const runEl = document.querySelector('.stat-sub-campaigns');
  if (runEl) runEl.textContent = `${running} running`;
}

// ═══════════════════════════════════════════════════
// 11. MODALS
// ═══════════════════════════════════════════════════
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
});

// ═══════════════════════════════════════════════════
// 12. TOAST
// ═══════════════════════════════════════════════════
function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el        = document.createElement('div');
  el.className    = `toast ${type}`;
  const icons     = { success: '✓', error: '✕', warn: '⚠', info: 'ℹ' };
  el.innerHTML    = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 300); }, 3500);
}

// ═══════════════════════════════════════════════════
// 13. BADGES
// ═══════════════════════════════════════════════════
function updateBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent    = count;
  el.style.display  = count ? 'inline-flex' : 'none';
}

// ═══════════════════════════════════════════════════
// 14. UTILITIES
// ═══════════════════════════════════════════════════
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

function downloadFile(filename, mimeType, content) {
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob([content], { type: mimeType }));
  a.download = filename;
  a.click();
}

// ═══════════════════════════════════════════════════
// 15. INIT
// ═══════════════════════════════════════════════════
function onAuthReady(user) {
  renderCountries(COUNTRIES);
  loadProfileIntoForm();
  try { initSocket(); } catch (e) { console.warn('Socket.io init failed:', e.message); }
  loadCampaigns().catch(e => console.warn('loadCampaigns failed:', e.message));
  (window._lfAuthHooks || []).forEach(fn => { try { fn(user); } catch(e) { console.warn('[hook]', e); } });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  const colorPicker = document.getElementById('brandColor');
  const colorHex    = document.getElementById('brandColorHex');
  if (colorPicker && colorHex) {
    colorPicker.addEventListener('input', () => { colorHex.value   = colorPicker.value; });
    colorHex.addEventListener('input',   () => {
      if (/^#[0-9a-f]{6}$/i.test(colorHex.value)) colorPicker.value = colorHex.value;
    });
  }

  navigateTo('dashboard');
  console.log('[LeadForge] App initialized');
});
