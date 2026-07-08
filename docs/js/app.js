/**
 * app.js — LeadForge Frontend Application
 * Handles: Navigation, Wizard, Campaign management,
 *          WhatsApp session (Socket.io), Email outreach, Settings
 */

// ═══════════════════════════════════════════════════
// 1. GLOBAL STATE
// ═══════════════════════════════════════════════════
const App = {
  currentPage:    'dashboard',
  wizardStep:     1,
  selectedChannels: new Set(['email', 'whatsapp', 'website']),
  selectedCountries: [],
  campaigns:      [],
  leads:          [],
  socket:         null,
  waConnected:    false,
  broadcastSource:'campaign',
  userProfile:    JSON.parse(localStorage.getItem('lf_profile') || '{}'),
};

// ═══════════════════════════════════════════════════
// 2. SOCKET.IO INITIALISATION
// ═══════════════════════════════════════════════════
function initSocket() {
  const serverUrl = window.location.origin;

  // In dev mode (DEV_AUTH=true on server), pass userId in handshake auth.
  // In production, pass the Firebase ID token — server verifies it and
  // derives userId server-side; the client never controls its own identity.
  const authPayload = window.__firebaseIdToken
    ? { token: window.__firebaseIdToken }         // production
    : { userId: getCurrentUserId() };             // local dev only

  App.socket = io(serverUrl, {
    transports: ['websocket'],
    auth: authPayload,
  });

  App.socket.on('connect', () => {
    console.log('[WS] Connected:', App.socket.id);
  });

  App.socket.on('qr', (qrDataUrl) => {
    showQRCode(qrDataUrl);
  });

  App.socket.on('wa_connected', (info) => {
    setWAConnected(true, info);
    toast('WhatsApp connected!', 'success');
  });

  App.socket.on('wa_disconnected', () => {
    setWAConnected(false);
    toast('WhatsApp disconnected', 'warn');
  });

  App.socket.on('scrape_log', (msg) => {
    appendScrapeLog(msg.text, msg.type || 'info');
  });

  App.socket.on('scrape_progress', (data) => {
    updateScrapeProgress(data);
  });

  App.socket.on('scrape_complete', (data) => {
    onScrapeComplete(data);
  });

  App.socket.on('broadcast_log', (msg) => {
    appendBroadcastLog(msg.text, msg.type || 'info');
  });
}

// ═══════════════════════════════════════════════════
// 3. NAVIGATION
// ═══════════════════════════════════════════════════
function navigateTo(page) {
  // Deactivate all
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));

  // Activate target
  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  // Update titles
  const titles = {
    dashboard: ['Dashboard', 'Overview'],
    campaigns: ['Campaigns', 'All scraping campaigns'],
    scraper:   ['Lead Scraper', 'Wizard — configure & launch'],
    leads:     ['Leads', 'Browse and manage leads'],
    whatsapp:  ['WhatsApp', 'Session manager & broadcast'],
    outreach:  ['Send Outreach', 'Email campaign builder'],
    analytics: ['Analytics', 'Performance metrics'],
    settings:  ['Settings', 'Account & configuration'],
  };
  if (titles[page]) {
    document.getElementById('pageTitle').textContent    = titles[page][0];
    document.getElementById('breadcrumb').textContent   = titles[page][1];
  }

  App.currentPage = page;

  // Page-specific init
  if (page === 'campaigns') renderCampaignsTable();
  if (page === 'leads')     populateCampaignFilter();
  if (page === 'outreach')  populateEmailCampaignSelect();
  if (page === 'whatsapp')  populateBroadcastCampaignSelect();
}

// Delegate goto clicks everywhere
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-goto], [data-page]');
  if (!target) return;
  const page = target.dataset.goto || target.dataset.page;
  if (page) { e.preventDefault(); navigateTo(page); }
});

// ═══════════════════════════════════════════════════
// 4. WIZARD
// ═══════════════════════════════════════════════════
function wizardNext() {
  if (App.wizardStep === 2 && !document.getElementById('nicheInput').value.trim()) {
    toast('Please enter a niche/industry', 'warn'); return;
  }
  if (App.wizardStep === 3 && App.selectedCountries.length === 0) {
    toast('Please select at least one country', 'warn'); return;
  }
  setWizardStep(App.wizardStep + 1);
}

function wizardPrev() { setWizardStep(App.wizardStep - 1); }

function setWizardStep(n) {
  const total = 4;
  if (n < 1 || n > total) return;

  document.querySelectorAll('.wizard-panel').forEach((el, i) => {
    el.classList.toggle('active', i + 1 === n);
  });

  document.querySelectorAll('.step').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i + 1 === n) el.classList.add('active');
    if (i + 1 < n)  el.classList.add('done');
  });

  App.wizardStep = n;
  if (n === 4) buildCampaignSummary();
}

// ─── Channel Selection ───────────────────────────
document.querySelectorAll('.channel-checkbox').forEach(label => {
  label.addEventListener('click', () => {
    const input = label.querySelector('input');
    input.checked = !input.checked;
    label.classList.toggle('checked', input.checked);
    if (input.checked) App.selectedChannels.add(input.value);
    else               App.selectedChannels.delete(input.value);
    document.getElementById('channelCount').textContent = App.selectedChannels.size;
  });
});

// ─── Niche Quick Select ──────────────────────────
function setNiche(name) {
  document.getElementById('nicheInput').value = name;
  document.querySelectorAll('.niche-tag').forEach(t =>
    t.classList.toggle('active', t.textContent === name)
  );
}

// ─── Countries ───────────────────────────────────
function renderCountries(list) {
  const grid = document.getElementById('countriesGrid');
  grid.innerHTML = list.map(c => `
    <div class="country-item${App.selectedCountries.find(s => s.code === c.code) ? ' selected' : ''}"
         onclick="toggleCountry('${c.code}', '${c.name}', '${c.flag}')">
      <span class="country-flag">${c.flag}</span>
      <span class="country-name">${c.name}</span>
    </div>
  `).join('');
}

function filterCountries(q) {
  const filtered = q
    ? COUNTRIES.filter(c => c.name.toLowerCase().includes(q.toLowerCase()))
    : COUNTRIES;
  renderCountries(filtered);
}

function toggleCountry(code, name, flag) {
  const idx = App.selectedCountries.findIndex(c => c.code === code);
  if (idx > -1) {
    App.selectedCountries.splice(idx, 1);
  } else {
    const country = COUNTRIES.find(c => c.code === code);
    App.selectedCountries.push({ code, name, flag, states: country.states, selectedStates: [] });
  }
  renderCountries(COUNTRIES);
  renderSelectedRegions();
}

function renderSelectedRegions() {
  const container = document.getElementById('selectedRegions');
  if (App.selectedCountries.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = App.selectedCountries.map(c => `
    <div class="region-block" style="width:100%; margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:18px">${c.flag}</span>
        <strong style="font-size:13px;">${c.name}</strong>
        <button onclick="toggleCountry('${c.code}')" style="margin-left:auto;background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;">✕</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${c.states.map(s => `
          <label class="niche-tag" style="cursor:pointer;${c.selectedStates.includes(s) ? 'border-color:var(--indigo);color:var(--indigo-light);' : ''}">
            <input type="checkbox" style="display:none" ${c.selectedStates.includes(s) ? 'checked' : ''}
              onchange="toggleState('${c.code}','${s.replace(/'/g,"\\'")}')" />
            ${s}
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function toggleState(code, state) {
  const country = App.selectedCountries.find(c => c.code === code);
  if (!country) return;
  const idx = country.selectedStates.indexOf(state);
  if (idx > -1) country.selectedStates.splice(idx, 1);
  else country.selectedStates.push(state);
  renderSelectedRegions();
}

// ─── Campaign Summary ────────────────────────────
function buildCampaignSummary() {
  const niche     = document.getElementById('nicheInput').value || 'Not set';
  const channels  = [...App.selectedChannels].join(', ') || 'None';
  const countries = App.selectedCountries.map(c => `${c.flag} ${c.name}`).join(', ') || 'None';
  const depth     = document.getElementById('scrapeDepth').value;
  const ts        = Date.now();
  const autoName  = `${niche.split(' ')[0]}_${new Date(ts).toISOString().slice(0,10)}`;

  document.getElementById('campaignSummary').innerHTML = `
    <div class="summary-item"><label>Niche</label><strong>${niche}</strong></div>
    <div class="summary-item"><label>Channels (${App.selectedChannels.size})</label><strong>${channels}</strong></div>
    <div class="summary-item"><label>Countries</label><strong>${countries}</strong></div>
    <div class="summary-item"><label>Scrape Depth</label><strong>Level ${depth}</strong></div>
  `;
  document.getElementById('campaignName').value = autoName;
}

// ─── Launch Campaign ─────────────────────────────
async function launchCampaign() {
  const name    = document.getElementById('campaignName').value.trim();
  const niche   = document.getElementById('nicheInput').value.trim();
  const depth   = parseInt(document.getElementById('scrapeDepth').value);
  const channels= [...App.selectedChannels];
  const locations = App.selectedCountries.map(c => ({
    country: c.name,
    states: c.selectedStates.length ? c.selectedStates : c.states.slice(0, 3),
  }));

  if (!name || !niche) { toast('Campaign name and niche are required', 'warn'); return; }

  const btn = document.getElementById('launchBtn');
  btn.disabled = true;
  btn.textContent = 'Launching...';

  const progress = document.getElementById('scrapeProgress');
  progress.style.display = 'block';
  document.getElementById('scrapeLog').innerHTML = '';

  try {
    const res = await apiFetch('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name, niche, depth, channels, locations }),
    });

    if (res.campaignId) {
      App.campaigns.unshift(res);
      updateBadge('campaignBadge', App.campaigns.length);
      toast(`Campaign "${name}" started!`, 'success');
    }
  } catch (err) {
    toast('Failed to launch campaign: ' + err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5,3 19,12 5,21 5,3"/></svg> Launch Scrape`;
  }
}

function updateScrapeProgress({ percent, found, processed, waVerified, status }) {
  document.getElementById('scrapeProgressBar').style.width = `${percent}%`;
  document.getElementById('scrapeStatusText').textContent  = status || 'Scraping...';
  if (found     !== undefined) document.getElementById('foundCount').textContent       = found;
  if (processed !== undefined) document.getElementById('processedCount').textContent   = processed;
  if (waVerified !== undefined) document.getElementById('waVerifiedCount').textContent = waVerified;
}

function onScrapeComplete(data) {
  document.getElementById('scrapeProgressBar').style.width = '100%';
  document.getElementById('scrapeStatusText').textContent  = '✓ Scrape complete!';
  document.getElementById('launchBtn').disabled = false;
  document.getElementById('launchBtn').innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5,3 19,12 5,21 5,3"/></svg> Launch Scrape`;
  appendScrapeLog(`✓ Done! Found ${data.totalLeads} leads.`, 'success');
  updateBadge('leadsBadge', data.totalLeads);
  toast(`Scrape complete — ${data.totalLeads} leads found`, 'success');
}

function appendScrapeLog(text, type = 'info') {
  const log  = document.getElementById('scrapeLog');
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

// ═══════════════════════════════════════════════════
// 5. CAMPAIGNS TABLE
// ═══════════════════════════════════════════════════
async function loadCampaigns() {
  try {
    const data = await apiFetch('/api/campaigns');
    App.campaigns = data.campaigns || [];
    updateBadge('campaignBadge', App.campaigns.length);
    renderCampaignsTable();
    updateDashboardStats();
  } catch (err) {
    console.error('Failed to load campaigns:', err);
  }
}

function renderCampaignsTable(list) {
  const rows   = list || App.campaigns;
  const tbody  = document.getElementById('campaignsBody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">
      <div class="table-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
        <p>No campaigns yet. <a href="#" data-goto="scraper">Start your first scrape →</a></p>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(c => `
    <tr>
      <td><code style="font-family:var(--font-mono);font-size:11px;color:var(--indigo-light)">${c.campaignId || c.id || '—'}</code></td>
      <td><strong>${c.niche}</strong></td>
      <td>${(c.locations || []).map(l => l.country).join(', ') || '—'}</td>
      <td>
        ${(c.channels || []).slice(0,4).map(ch => `<span class="badge badge-muted" style="margin-right:3px">${ch}</span>`).join('')}
        ${(c.channels || []).length > 4 ? `<span class="badge badge-muted">+${c.channels.length - 4}</span>` : ''}
      </td>
      <td><strong>${c.leadsCount || 0}</strong></td>
      <td><span class="badge ${statusBadge(c.status)}">${c.status || 'pending'}</span></td>
      <td style="color:var(--text-muted);font-size:12px">${formatDate(c.createdAt)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="viewCampaignLeads('${c.campaignId || c.id}')">View Leads</button>
          <button class="btn btn-primary btn-sm" onclick="outreachForCampaign('${c.campaignId || c.id}')">Outreach</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterCampaigns(q) {
  const filtered = App.campaigns.filter(c =>
    c.niche?.toLowerCase().includes(q.toLowerCase()) ||
    (c.campaignId || '').toLowerCase().includes(q.toLowerCase())
  );
  renderCampaignsTable(filtered);
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
// 6. LEADS TABLE
// ═══════════════════════════════════════════════════
async function loadLeadsForCampaign(campaignId) {
  if (!campaignId) return;
  try {
    const data = await apiFetch(`/api/campaigns/${campaignId}/leads`);
    App.leads = data.leads || [];
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
    App.campaigns.map(c => `<option value="${c.campaignId || c.id}">${c.niche} — ${formatDate(c.createdAt)}</option>`).join('');
}

function renderLeadsTable(list) {
  const rows  = list || App.leads;
  const tbody = document.getElementById('leadsBody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="table-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
      <p>No leads found. Select a campaign above.</p>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((lead, i) => `
    <tr>
      <td><input type="checkbox" class="lead-cb" data-id="${lead.leadId || i}" /></td>
      <td><strong>${lead.businessName || '—'}</strong></td>
      <td>
        ${lead.email
          ? `<a href="mailto:${lead.email}" style="color:var(--indigo-light)">${lead.email}</a>`
          : '<span style="color:var(--text-muted)">—</span>'
        }
      </td>
      <td>${lead.phone || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>
        ${(lead.socialUrls || []).slice(0,3).map(u => `
          <a href="${u}" target="_blank" style="font-size:11px;margin-right:4px;color:var(--text-muted)">
            ${getDomain(u)}
          </a>
        `).join('')}
        ${(lead.socialUrls || []).length > 3 ? `<span style="font-size:11px;color:var(--text-muted)">+${lead.socialUrls.length - 3}</span>` : ''}
      </td>
      <td>
        <span class="badge ${lead.waVerified ? 'badge-success' : 'badge-muted'}">
          ${lead.waVerified ? '✓ Yes' : 'No'}
        </span>
      </td>
      <td><span class="badge ${statusBadge(lead.status)}">${lead.status || 'pending'}</span></td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="showLeadDetail(${i})">Details</button>
          ${lead.status !== 'optout' ? `<button class="btn btn-primary btn-sm" onclick="sendToLead(${i})">Send</button>` : ''}
        </div>
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
    (l.email || '').toLowerCase().includes(q) ||
    (l.phone || '').includes(q)
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
    <div style="display:grid;gap:12px">
      <div><label class="form-label">Business Name</label><p><strong>${lead.businessName || '—'}</strong></p></div>
      <div><label class="form-label">Email</label><p>${lead.email || '—'}</p></div>
      <div><label class="form-label">Phone</label><p>${lead.phone || '—'}</p></div>
      <div><label class="form-label">WA Verified</label><p><span class="badge ${lead.waVerified ? 'badge-success' : 'badge-muted'}">${lead.waVerified ? 'Yes' : 'No'}</span></p></div>
      <div><label class="form-label">Status</label><p><span class="badge ${statusBadge(lead.status)}">${lead.status || 'pending'}</span></p></div>
      <div>
        <label class="form-label">Social Links</label>
        <div style="display:flex;flex-direction:column;gap:4px;margin-top:4px">
          ${(lead.socialUrls || []).map(u => `<a href="${u}" target="_blank" style="font-size:12px;color:var(--indigo-light)">${u}</a>`).join('') || '—'}
        </div>
      </div>
      <div><label class="form-label">Found</label><p style="color:var(--text-muted);font-size:12px">${formatDate(lead.createdAt)}</p></div>
    </div>
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
  const csv = [headers, ...rows].map(r => r.map(v => `"${(v||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadFile(`leads_export_${Date.now()}.csv`, 'text/csv', csv);
  toast('CSV downloaded', 'success');
}

// ═══════════════════════════════════════════════════
// 7. WHATSAPP SESSION
// ═══════════════════════════════════════════════════
function generateQR() {
  if (!App.socket) { toast('Server connection not available', 'error'); return; }
  setWAStatus('connecting');
  // No userId sent — server derives it from the verified socket token
  App.socket.emit('wa_init');
  document.getElementById('qrPlaceholder').style.display = 'none';
  document.getElementById('qrImageWrap').style.display   = 'none';
  toast('Requesting QR code...', 'info');
}

function showQRCode(dataUrl) {
  document.getElementById('qrImage').src                 = dataUrl;
  document.getElementById('qrPlaceholder').style.display = 'none';
  document.getElementById('qrImageWrap').style.display   = 'block';
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
      document.getElementById('qrImageWrap').style.display   = 'none';
      document.getElementById('qrPlaceholder').style.display = 'block';
      setWAStatus('disconnected');
      toast('QR code expired. Generate a new one.', 'warn');
    }
  }, 1000);
}

function setWAConnected(connected, info = {}) {
  App.waConnected = connected;
  clearInterval(qrTimer);

  const badge    = document.getElementById('waStatusBadge');
  const dot      = badge.querySelector('.status-dot');
  const text     = document.getElementById('waStatusText');
  const navStatus= document.getElementById('waStatus');

  if (connected) {
    dot.className   = 'status-dot connected';
    text.textContent = 'Connected';
    navStatus.className = 'nav-status online';
    navStatus.textContent = '●';

    document.getElementById('qrPlaceholder').style.display    = 'none';
    document.getElementById('qrImageWrap').style.display      = 'none';
    document.getElementById('waConnectedState').style.display  = 'flex';
    document.getElementById('generateQrBtn').style.display    = 'none';
    document.getElementById('disconnectWaBtn').style.display  = 'block';

    document.getElementById('waConnectedName').textContent  = info.name  || 'Connected';
    document.getElementById('waConnectedPhone').textContent = info.phone || '';
  } else {
    setWAStatus('disconnected');
    document.getElementById('waConnectedState').style.display  = 'none';
    document.getElementById('qrPlaceholder').style.display    = 'block';
    document.getElementById('generateQrBtn').style.display    = 'block';
    document.getElementById('disconnectWaBtn').style.display  = 'none';
  }
}

function setWAStatus(status) {
  const badge = document.getElementById('waStatusBadge');
  const dot   = badge?.querySelector('.status-dot');
  const text  = document.getElementById('waStatusText');
  const nav   = document.getElementById('waStatus');
  const labels = { disconnected: 'Disconnected', connecting: 'Connecting...', connected: 'Connected' };
  if (dot)  dot.className = `status-dot ${status}`;
  if (text) text.textContent = labels[status];
  if (nav)  { nav.className = `nav-status${status==='connected' ? ' online' : ''}`; nav.textContent = '●'; }
}

async function disconnectWA() {
  try {
    await apiFetch('/api/whatsapp/disconnect', { method: 'POST', body: JSON.stringify({ userId: getCurrentUserId() }) });
    setWAConnected(false);
    toast('WhatsApp disconnected', 'info');
  } catch (err) {
    toast('Failed to disconnect: ' + err.message, 'error');
  }
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
    App.campaigns.map(c => `<option value="${c.campaignId || c.id}">${c.niche} (${c.leadsCount || 0} leads)</option>`).join('');
}

function insertVar(v) {
  const ta = document.getElementById('waMessage');
  if (!ta) return;
  const pos = ta.selectionStart;
  ta.value = ta.value.slice(0, pos) + v + ta.value.slice(pos);
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
  log.innerHTML = '';

  try {
    await apiFetch('/api/whatsapp/broadcast', {
      method: 'POST',
      body: JSON.stringify({ userId: getCurrentUserId(), campaignId, message, minDelay, maxDelay, source: App.broadcastSource }),
    });
    toast('Broadcast started!', 'success');
  } catch (err) {
    toast('Broadcast failed: ' + err.message, 'error');
  }
}

function appendBroadcastLog(text, type = 'info') {
  const log  = document.getElementById('broadcastLog');
  if (!log) return;
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

// ═══════════════════════════════════════════════════
// 8. EMAIL OUTREACH
// ═══════════════════════════════════════════════════
function populateEmailCampaignSelect() {
  const sel = document.getElementById('emailCampaignSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">Choose campaign...</option>' +
    App.campaigns.map(c => `<option value="${c.campaignId || c.id}">${c.niche} (${c.leadsCount || 0} leads)</option>`).join('');
}

function insertEmailVar(v) {
  const ta = document.getElementById('emailBody');
  if (!ta) return;
  const pos = ta.selectionStart;
  ta.value = ta.value.slice(0, pos) + v + ta.value.slice(pos);
  ta.focus();
}

function previewEmail() {
  const body     = document.getElementById('emailBody').value;
  const subject  = document.getElementById('emailSubject').value;
  const profile  = App.userProfile;
  const logoUrl  = document.getElementById('brandLogoUrl')?.value || '';
  const phone    = profile.phone || '';
  const company  = profile.company || 'Your Company';

  const html = buildEmailHTML({ body, subject, logoUrl, phone, company, businessName: 'Sample Business', niche: 'Your Niche' });
  document.getElementById('emailPreviewIframe').srcdoc = html;
  openModal('emailPreviewModal');
}

function buildEmailHTML({ body, subject, logoUrl, phone, company, businessName, niche }) {
  const filled = body
    .replace(/{businessName}/g, businessName)
    .replace(/{niche}/g, niche)
    .replace(/{yourName}/g, App.userProfile.name || 'Your Name')
    .replace(/{yourCompany}/g, company);

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body{margin:0;background:#f4f4f7;font-family:'Helvetica Neue',Arial,sans-serif;}
  .wrap{max-width:600px;margin:30px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.12);}
  .header{background:#6366f1;padding:28px 36px;text-align:center;}
  .header img{max-height:50px;max-width:200px;}
  .header h1{color:#fff;font-size:20px;margin:12px 0 0;font-weight:700;}
  .body{padding:32px 36px;color:#333;line-height:1.7;font-size:15px;}
  .footer{background:#f9f9fb;padding:20px 36px;font-size:12px;color:#999;border-top:1px solid #eee;text-align:center;}
  a{color:#6366f1;}
</style></head>
<body>
<div class="wrap">
  <div class="header">
    ${logoUrl ? `<img src="${logoUrl}" alt="${company} Logo" />` : ''}
    <h1>${subject || 'Partnership Opportunity'}</h1>
  </div>
  <div class="body">
    ${filled.replace(/\n/g, '<br>')}
  </div>
  <div class="footer">
    <p>${company}${phone ? ` · ${phone}` : ''}</p>
    <p>Reply <strong>STOP</strong> to opt out of future messages.</p>
  </div>
</div>
</body></html>`;
}

async function sendTestEmail() {
  const email  = App.userProfile.email;
  if (!email) { toast('Set your email in Settings first', 'warn'); return; }
  try {
    const body    = document.getElementById('emailBody').value;
    const subject = document.getElementById('emailSubject').value;
    const profile = App.userProfile;
    const logoUrl = document.getElementById('brandLogoUrl')?.value || '';
    const html    = buildEmailHTML({ body, subject, logoUrl, phone: profile.phone, company: profile.company, businessName: 'Test Business', niche: 'Test Niche' });
    await apiFetch('/api/outreach/test-email', {
      method: 'POST',
      body: JSON.stringify({ to: email, subject, html }),
    });
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

  try {
    const res = await apiFetch('/api/outreach/email', {
      method: 'POST',
      body: JSON.stringify({
        campaignId,
        subject,
        body,
        includeLogo:  document.getElementById('includeLogo').checked,
        includePhone: document.getElementById('includePhone').checked,
        logoUrl: document.getElementById('brandLogoUrl')?.value || '',
      }),
    });
    toast(`Email campaign started — ${res.queued || 0} messages queued`, 'success');
  } catch (err) {
    toast('Failed to start campaign: ' + err.message, 'error');
  }
}

function setPreviewMode(mode) {
  const frame = document.getElementById('emailPreviewIframe');
  document.querySelectorAll('.preview-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  if (mode === 'mobile') { frame.style.width = '375px'; frame.style.margin = '0 auto'; }
  else                   { frame.style.width = '100%';  frame.style.margin = ''; }
}

// ═══════════════════════════════════════════════════
// 9. SETTINGS
// ═══════════════════════════════════════════════════
document.querySelectorAll('.settings-nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const tab = document.getElementById(`settings-${btn.dataset.settingsTab}`);
    if (tab) tab.classList.add('active');
  });
});

function saveProfile() {
  App.userProfile = {
    ...App.userProfile,
    name:    document.getElementById('profileName').value,
    email:   document.getElementById('profileEmail').value,
    company: document.getElementById('profileCompany').value,
    phone:   document.getElementById('profilePhone').value,
    desc:    document.getElementById('profileDesc').value,
  };
  localStorage.setItem('lf_profile', JSON.stringify(App.userProfile));
  updateUserUI();
  apiFetch('/api/user/profile', { method: 'PUT', body: JSON.stringify(App.userProfile) })
    .catch(() => {});
  toast('Profile saved', 'success');
}

function saveBranding() {
  const logoUrl   = document.getElementById('brandLogoUrl').value;
  const color     = document.getElementById('brandColor').value;
  App.userProfile.logoUrl    = logoUrl;
  App.userProfile.brandColor = color;
  localStorage.setItem('lf_profile', JSON.stringify(App.userProfile));
  apiFetch('/api/user/profile', { method: 'PUT', body: JSON.stringify(App.userProfile) }).catch(() => {});
  toast('Branding saved', 'success');
}

function saveApiKeys() {
  const brevoKey = document.getElementById('brevoApiKey').value;
  if (brevoKey) {
    apiFetch('/api/user/apikeys', { method: 'PUT', body: JSON.stringify({ brevoApiKey: brevoKey }) })
      .then(() => toast('API keys saved securely', 'success'))
      .catch(err => toast('Error saving keys: ' + err.message, 'error'));
  }
}

function saveNotifications() { toast('Preferences saved', 'success'); }

function previewLogo(url) {
  const container = document.getElementById('logoPreview');
  if (!url) { container.innerHTML = '<span>Preview</span>'; return; }
  container.innerHTML = `<img src="${url}" alt="Logo" onerror="this.parentElement.innerHTML='<span>Invalid URL</span>'" />`;
}

function toggleVisibility(id) {
  const input = document.getElementById(id);
  input.type  = input.type === 'password' ? 'text' : 'password';
}

function loadProfileIntoForm() {
  const p = App.userProfile;
  if (p.name)    document.getElementById('profileName').value    = p.name;
  if (p.email)   document.getElementById('profileEmail').value   = p.email;
  if (p.company) document.getElementById('profileCompany').value = p.company;
  if (p.phone)   document.getElementById('profilePhone').value   = p.phone;
  if (p.desc)    document.getElementById('profileDesc').value    = p.desc;
  if (p.logoUrl) { document.getElementById('brandLogoUrl').value = p.logoUrl; previewLogo(p.logoUrl); }
  if (p.brandColor) document.getElementById('brandColor').value  = p.brandColor;
}

function updateUserUI() {
  const p = App.userProfile;
  if (p.name) {
    document.getElementById('userName').textContent = p.name;
    document.getElementById('userAvatar').textContent = p.name.charAt(0).toUpperCase();
  }
}

// ═══════════════════════════════════════════════════
// 10. DASHBOARD
// ═══════════════════════════════════════════════════
function updateDashboardStats() {
  const totalLeads = App.campaigns.reduce((sum, c) => sum + (c.leadsCount || 0), 0);
  document.getElementById('statTotalLeads').textContent = totalLeads;
  document.getElementById('statCampaigns').textContent  = App.campaigns.length;
}

// ═══════════════════════════════════════════════════
// 11. MODALS
// ═══════════════════════════════════════════════════
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
// Close on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ═══════════════════════════════════════════════════
// 12. TOAST
// ═══════════════════════════════════════════════════
function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el        = document.createElement('div');
  el.className    = `toast ${type}`;
  const icons     = { success: '✓', error: '✕', warn: '⚠', info: 'ℹ' };
  el.innerHTML    = `<span>${icons[type] || 'ℹ'}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ═══════════════════════════════════════════════════
// 13. API HELPER
// ═══════════════════════════════════════════════════
async function apiFetch(url, options = {}) {
  const defaults = {
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id':    getCurrentUserId(),
    },
  };
  const res  = await fetch(url, { ...defaults, ...options, headers: { ...defaults.headers, ...(options.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ═══════════════════════════════════════════════════
// 14. UTILITY HELPERS
// ═══════════════════════════════════════════════════
function getCurrentUserId() {
  let id = localStorage.getItem('lf_uid');
  if (!id) { id = 'user_' + Math.random().toString(36).slice(2, 10); localStorage.setItem('lf_uid', id); }
  return id;
}

function updateBadge(id, count) {
  const el = document.getElementById(id);
  if (el) el.textContent = count;
}

function statusBadge(status) {
  const map = { running: 'badge-indigo', complete: 'badge-success', error: 'badge-error', optout: 'badge-error', verified: 'badge-success', pending: 'badge-warn' };
  return map[status] || 'badge-muted';
}

function formatDate(ts) {
  if (!ts) return '—';
  try { return new Date(ts._seconds ? ts._seconds * 1000 : ts).toLocaleDateString(); } catch { return '—'; }
}

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', '').split('.')[0]; } catch { return url.slice(0, 12); }
}

function downloadFile(filename, mimeType, content) {
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([content], { type: mimeType }));
  a.download = filename;
  a.click();
}

// ═══════════════════════════════════════════════════
// 15. INIT
// ═══════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  renderCountries(COUNTRIES);
  loadProfileIntoForm();
  updateUserUI();

  // Try to connect socket — graceful fallback if server not running
  try { initSocket(); } catch (e) { console.warn('Socket.io not available — running in demo mode'); }

  // Load initial data
  loadCampaigns().catch(() => console.warn('API not available — running in demo mode'));

  // Sidebar toggle on mobile
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Color picker sync
  const colorPicker = document.getElementById('brandColor');
  const colorHex    = document.getElementById('brandColorHex');
  if (colorPicker && colorHex) {
    colorPicker.addEventListener('input', () => { colorHex.value = colorPicker.value; });
    colorHex.addEventListener('input', () => {
      if (/^#[0-9a-f]{6}$/i.test(colorHex.value)) colorPicker.value = colorHex.value;
    });
  }

  // Initial page
  navigateTo('dashboard');

  console.log('[LeadForge] App initialized');
});
