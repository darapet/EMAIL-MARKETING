/**
 * features.js — Extended features for LeadForge
 * Select All, AI Generate, Templates, Admin, Premium gates, Scraped preview
 */

// ── Supabase Backend URL ──────────────────────────────────────────────────────
// Change this when you deploy your backend server
const API_BASE = window.__LF_API_BASE || '';

// ── SELECT ALL CHANNELS ───────────────────────────────────────────────────────
function selectAllChannels() {
  const all = document.querySelectorAll('.channel-checkbox');
  const anyUnchecked = [...all].some(l => !l.classList.contains('checked'));
  all.forEach(label => {
    const input = label.querySelector('input');
    if (anyUnchecked) {
      input.checked = true;
      label.classList.add('checked');
      App.selectedChannels.add(input.value);
    } else {
      input.checked = false;
      label.classList.remove('checked');
      App.selectedChannels.delete(input.value);
    }
  });
  document.getElementById('channelCount').textContent = App.selectedChannels.size;
  const btn = document.getElementById('selectAllChannelsBtn');
  if (btn) btn.textContent = anyUnchecked ? '✓ Deselect All' : 'Select All';
}

// ── SELECT ALL STATES ─────────────────────────────────────────────────────────
function selectAllStates(countryCode) {
  const country = App.selectedCountries.find(c => c.code === countryCode);
  if (!country) return;
  const anyUnselected = country.states.some(s => !country.selectedStates.includes(s));
  country.selectedStates = anyUnselected ? [...country.states] : [];
  renderSelectedRegions();
}

// ── EMAIL COUNT ───────────────────────────────────────────────────────────────
function getEmailCount() {
  const el = document.getElementById('emailCountInput');
  return el ? parseInt(el.value) || 50 : 50;
}

// ── SCRAPED LEADS PREVIEW (before sending) ────────────────────────────────────
// Called after scrape completes — shows leads with checkboxes so user picks who to email
App._scrapedCampaignId = null;

function showScrapedPreview(campaignId, totalLeads) {
  App._scrapedCampaignId = campaignId;
  // Navigate to preview modal
  openModal('scrapedPreviewModal');
  loadScrapedLeadsPreview(campaignId);
}

async function loadScrapedLeadsPreview(campaignId) {
  const body = document.getElementById('scrapedPreviewBody');
  if (!body) return;
  body.innerHTML = '<div class="loading-spinner">Loading scraped leads...</div>';

  try {
    const data = await apiFetch(`${API_BASE}/api/campaigns/${campaignId}`);
    const leads = data.leads || [];

    if (!leads.length) {
      body.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px">No leads found in this campaign.</p>';
      return;
    }

    body.innerHTML = `
      <div class="preview-toolbar">
        <label class="checkbox-label" style="font-weight:600">
          <input type="checkbox" id="selectAllScraped" onchange="toggleSelectAllScraped(this)" />
          Select All (${leads.length} leads)
        </label>
        <span style="color:var(--text-muted);font-size:12px">${leads.filter(l=>l.email).length} with email · ${leads.filter(l=>l.phone).length} with phone</span>
      </div>
      <div class="scraped-leads-list">
        ${leads.map((lead, i) => `
          <label class="scraped-lead-row ${!lead.email ? 'no-email' : ''}">
            <input type="checkbox" class="scraped-cb" value="${lead.id}" ${lead.email ? 'checked' : ''} ${!lead.email ? 'disabled' : ''} />
            <div class="lead-info">
              <strong>${lead.business_name || 'Unknown Business'}</strong>
              <span class="lead-email">${lead.email || '<em>no email</em>'}</span>
            </div>
            <div class="lead-meta">
              ${lead.phone ? `<span class="badge badge-muted">📱 ${lead.phone}</span>` : ''}
              ${lead.social_urls && Object.keys(lead.social_urls).length ? `<span class="badge badge-muted">🔗 socials</span>` : ''}
            </div>
          </label>
        `).join('')}
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<p style="color:var(--red);padding:20px">Error: ${err.message}</p>`;
  }
}

function toggleSelectAllScraped(cb) {
  document.querySelectorAll('.scraped-cb:not(:disabled)').forEach(el => { el.checked = cb.checked; });
}

function getSelectedScrapedLeads() {
  return [...document.querySelectorAll('.scraped-cb:checked')].map(el => el.value);
}

function proceedToSendScraped() {
  const leadIds = getSelectedScrapedLeads();
  if (!leadIds.length) { toast('Select at least one lead to email', 'warn'); return; }
  closeModal('scrapedPreviewModal');
  // Pre-fill the outreach form
  App._pendingLeadIds = leadIds;
  App._pendingCampaignId = App._scrapedCampaignId;
  navigateTo('outreach');
  const sel = document.getElementById('emailCampaignSelect');
  if (sel) sel.value = App._scrapedCampaignId;
  toast(`${leadIds.length} leads selected for outreach`, 'success');
}

// ── AI GENERATE ───────────────────────────────────────────────────────────────
async function aiGenerateEmail() {
  const niche    = document.getElementById('nicheInput')?.value ||
                   document.getElementById('emailCampaignSelect')?.selectedOptions[0]?.text || 'Business';
  const btn      = document.getElementById('aiGenerateBtn');
  const toneEl   = document.getElementById('aiToneSelect');
  const goalEl   = document.getElementById('aiGoalSelect');
  const tone     = toneEl?.value || 'professional';
  const goal     = goalEl?.value || 'service_offer';

  if (btn) { btn.disabled = true; btn.textContent = '✨ Generating...'; }

  try {
    const res = await apiFetch(`${API_BASE}/api/ai/generate-email`, {
      method: 'POST',
      body: JSON.stringify({ niche, tone, goal }),
    });
    if (res.subject) document.getElementById('emailSubject').value = res.subject;
    if (res.body)    document.getElementById('emailBody').value    = res.body;
    toast('AI draft generated!', 'success');
  } catch (err) {
    toast('AI generation failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ AI Generate'; }
  }
}

async function aiGenerateWA() {
  const niche    = document.getElementById('broadcastCampaignSelect')?.selectedOptions[0]?.text || 'Business';
  const btn      = document.getElementById('aiGenerateWABtn');

  if (btn) { btn.disabled = true; btn.textContent = '✨ Generating...'; }
  try {
    const res = await apiFetch(`${API_BASE}/api/ai/generate-whatsapp`, {
      method: 'POST',
      body: JSON.stringify({ niche, tone: 'friendly' }),
    });
    if (res.message) document.getElementById('waMessage').value = res.message;
    toast('WA draft generated!', 'success');
  } catch (err) {
    toast('AI generation failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ AI Generate'; }
  }
}

// ── SMTP PROVIDER SELECTION ───────────────────────────────────────────────────
function setEmailProvider(provider) {
  App.emailProvider = provider;
  document.querySelectorAll('.provider-btn').forEach(b => b.classList.toggle('active', b.dataset.provider === provider));
  const providerBadge = document.getElementById('providerBadge');
  const labels = { system: 'System SMTP (Brevo)', brevo: 'Your Brevo Key', sendgrid: 'Your SendGrid', mailgun: 'Your Mailgun', smtp: 'Custom SMTP' };
  if (providerBadge) providerBadge.textContent = 'via ' + (labels[provider] || provider);

  // Premium gate — own SMTP
  if (provider !== 'system' && !App.isPremium) {
    toast('Custom SMTP is a premium feature. Upgrade to use your own keys.', 'warn');
    showPremiumModal();
    setEmailProvider('system');
  }
}

// ── EMAIL TEMPLATES ───────────────────────────────────────────────────────────
let _templates = [];

async function loadTemplates() {
  try {
    const data = await apiFetch(`${API_BASE}/api/templates`);
    _templates = data.templates || [];
    renderTemplatesList();
    populateTemplateSelect();
  } catch (err) {
    console.error('Failed to load templates:', err);
  }
}

function renderTemplatesList() {
  const container = document.getElementById('templatesGrid');
  if (!container) return;

  if (!_templates.length) {
    container.innerHTML = `
      <div class="empty-state-sm" style="grid-column:1/-1;padding:60px 20px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;color:var(--text-muted)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
        <p style="color:var(--text-muted);margin-top:12px">No templates yet. Create your first one below.</p>
      </div>
    `;
    return;
  }

  // esc() defined in app.js (loaded before features.js renders)
  const e = typeof esc === 'function' ? esc : s => String(s ?? '').replace(/[<>"'&]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;','&':'&amp;'}[c]));
  container.innerHTML = _templates.map(t => `
    <div class="template-card ${t.is_default ? 'is-default' : ''}">
      <div class="template-card-header">
        <strong>${e(t.name)}</strong>
        ${t.is_default ? '<span class="badge badge-success">Default</span>' : ''}
      </div>
      ${t.logo_url ? `<img src="${e(t.logo_url)}" class="template-logo" alt="logo" />` : ''}
      <p class="template-subject">${e(t.subject || '—')}</p>
      <p class="template-preview">${e((t.body || '').substring(0, 100))}...</p>
      <div class="template-actions">
        ${!t.is_default ? `<button class="btn btn-ghost btn-sm" onclick="setDefaultTemplate('${e(t.id)}')">Set Default</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="editTemplate('${e(t.id)}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTemplate('${e(t.id)}')">Delete</button>
      </div>
    </div>
  `).join('');
}

function populateTemplateSelect() {
  const sel = document.getElementById('templateSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">No template (write custom)</option>' +
    _templates.map(t => `<option value="${t.id}"${t.is_default?' selected':''}>${t.name}</option>`).join('');
}

async function saveTemplate() {
  const name      = document.getElementById('tplName').value.trim();
  const subject   = document.getElementById('tplSubject').value.trim();
  const body      = document.getElementById('tplBody').value.trim();
  const logoUrl   = document.getElementById('tplLogoUrl').value.trim();
  const sigUrl    = document.getElementById('tplSignatureUrl').value.trim();
  const editingId = document.getElementById('tplEditingId')?.value;

  if (!name || !subject || !body) { toast('Name, subject and body are required', 'warn'); return; }
  if (_templates.length >= 5 && !editingId) { toast('Maximum 5 templates allowed', 'warn'); return; }

  try {
    const payload = { name, subject, body, logo_url: logoUrl, signature_url: sigUrl };
    if (editingId) {
      await apiFetch(`${API_BASE}/api/templates/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Template updated', 'success');
    } else {
      await apiFetch(`${API_BASE}/api/templates`, { method: 'POST', body: JSON.stringify(payload) });
      toast('Template saved', 'success');
    }
    clearTemplateForm();
    await loadTemplates();
  } catch (err) {
    toast('Error saving template: ' + err.message, 'error');
  }
}

function editTemplate(id) {
  const t = _templates.find(t => t.id === id);
  if (!t) return;
  document.getElementById('tplName').value      = t.name;
  document.getElementById('tplSubject').value   = t.subject || '';
  document.getElementById('tplBody').value      = t.body || '';
  document.getElementById('tplLogoUrl').value   = t.logo_url || '';
  document.getElementById('tplSignatureUrl').value = t.signature_url || '';
  const eid = document.getElementById('tplEditingId');
  if (eid) eid.value = id;
  document.getElementById('tplFormTitle').textContent = 'Edit Template';
  document.getElementById('tplForm').scrollIntoView({ behavior: 'smooth' });
}

function clearTemplateForm() {
  ['tplName','tplSubject','tplBody','tplLogoUrl','tplSignatureUrl'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const eid = document.getElementById('tplEditingId');
  if (eid) eid.value = '';
  const title = document.getElementById('tplFormTitle');
  if (title) title.textContent = 'New Template';
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  try {
    await apiFetch(`${API_BASE}/api/templates/${id}`, { method: 'DELETE' });
    toast('Template deleted', 'success');
    await loadTemplates();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function setDefaultTemplate(id) {
  try {
    await apiFetch(`${API_BASE}/api/templates/${id}/default`, { method: 'PUT' });
    toast('Default template set', 'success');
    await loadTemplates();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

function loadTemplateIntoComposer(templateId) {
  const t = _templates.find(t => t.id === templateId);
  if (!t) return;
  if (t.subject) document.getElementById('emailSubject').value = t.subject;
  if (t.body)    document.getElementById('emailBody').value    = t.body;
  toast(`Template "${t.name}" loaded`, 'info');
}

// ── ADMIN PANEL ───────────────────────────────────────────────────────────────
async function loadAdminDashboard() {
  try {
    const [stats, users] = await Promise.all([
      apiFetch(`${API_BASE}/api/admin/stats`),
      apiFetch(`${API_BASE}/api/admin/users`),
    ]);
    renderAdminStats(stats);
    renderAdminUsers(users.users || []);
  } catch (err) {
    if (err.message.includes('403')) {
      toast('Admin access required', 'error');
      navigateTo('dashboard');
    }
  }
}

function renderAdminStats(stats) {
  const s = stats.stats || stats;
  document.getElementById('adminStatUsers').textContent    = s.total_users || 0;
  document.getElementById('adminStatPremium').textContent  = s.premium_users || 0;
  document.getElementById('adminStatCampaigns').textContent = s.total_campaigns || 0;
  document.getElementById('adminStatEmails').textContent   = s.total_emails_sent || 0;
}

function renderAdminUsers(users) {
  const tbody = document.getElementById('adminUsersBody');
  if (!tbody) return;
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">No users yet</td></tr>';
    return;
  }
  const e2 = typeof esc === 'function' ? esc : s => String(s ?? '').replace(/[<>"'&]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;','&':'&amp;'}[c]));
  tbody.innerHTML = users.map(u => `
    <tr>
      <td><strong>${e2(u.name || (u.email || '').split('@')[0])}</strong><br><small style="color:var(--text-muted)">${e2(u.email || '')}</small></td>
      <td><span class="badge ${u.plan === 'premium' ? 'badge-success' : 'badge-muted'}">${e2(u.plan || 'free')}</span></td>
      <td>${u.is_admin ? '<span class="badge badge-warn">Admin</span>' : '—'}</td>
      <td style="color:var(--text-muted);font-size:12px">${u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm btn-ghost" onclick="adminTogglePlan('${e2(u.id)}','${e2(u.plan || '')}')">
            ${u.plan === 'premium' ? 'Downgrade' : '⬆ Upgrade'}
          </button>
          ${!u.is_admin ? `<button class="btn btn-sm btn-ghost" onclick="adminToggleAdmin('${e2(u.id)}')">Make Admin</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

async function adminTogglePlan(userId, currentPlan) {
  const newPlan = currentPlan === 'premium' ? 'free' : 'premium';
  try {
    await apiFetch(`${API_BASE}/api/admin/users/${userId}/plan`, {
      method: 'PUT',
      body: JSON.stringify({ plan: newPlan }),
    });
    toast(`User plan set to ${newPlan}`, 'success');
    loadAdminDashboard();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function adminToggleAdmin(userId) {
  try {
    await apiFetch(`${API_BASE}/api/admin/users/${userId}/admin`, {
      method: 'PUT',
      body: JSON.stringify({ is_admin: true }),
    });
    toast('Admin access granted', 'success');
    loadAdminDashboard();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function loadAdminActivity() {
  try {
    const data = await apiFetch(`${API_BASE}/api/admin/activity?limit=50`);
    const logs = data.logs || [];
    const tbody = document.getElementById('adminActivityBody');
    if (!tbody) return;
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px">No activity yet</td></tr>';
      return;
    }
    const e3 = typeof esc === 'function' ? esc : s => String(s ?? '').replace(/[<>"'&]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;','&':'&amp;'}[c]));
    tbody.innerHTML = logs.map(l => `
      <tr>
        <td style="font-size:12px;color:var(--text-muted)">${l.created_at ? new Date(l.created_at).toLocaleString() : '—'}</td>
        <td>${e3(l.profiles?.email || (l.user_id || '').substring(0,8))}</td>
        <td><code style="font-size:11px">${e3(l.action || '')}</code></td>
        <td style="font-size:11px;color:var(--text-muted)">${e3(l.metadata ? JSON.stringify(l.metadata).substring(0,60) : '—')}</td>
      </tr>
    `).join('');
  } catch (err) {
    toast('Failed to load activity', 'error');
  }
}

// ── UPLOAD LOGO/SIGNATURE ─────────────────────────────────────────────────────
async function uploadFile(inputId, type) {
  const input = document.getElementById(inputId);
  if (!input?.files?.[0]) return;
  const file     = input.files[0];
  const formData = new FormData();
  formData.append('file', file);

  try {
    const token = getAuthToken();
    const res   = await fetch(`${API_BASE}/api/storage/upload/${type}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Upload failed');
    toast(`${type} uploaded!`, 'success');
    return json.url;
  } catch (err) {
    toast('Upload error: ' + err.message, 'error');
    return null;
  }
}

// ── PREMIUM GATE MODAL ────────────────────────────────────────────────────────
function showPremiumModal() {
  document.getElementById('premiumModal')?.classList.add('open');
}

// ── Register auth hook via global hook array ──────────────────────────────────
// app.js (loaded after this file) owns onAuthReady and drains _lfAuthHooks.
// This avoids any wrapper-override race condition.
window._lfAuthHooks = window._lfAuthHooks || [];
window._lfAuthHooks.push(async function(user) {
  App.isPremium = App.isPremium || false;
  App.isAdmin   = App.isAdmin   || false;
  App.emailProvider = 'system';

  // Fetch fresh profile from API to get plan/admin status
  try {
    const profile = await apiFetch(`${API_BASE}/api/user/profile`);
    if (profile?.profile) {
      App.isPremium = profile.profile.plan === 'premium' || profile.profile.is_admin;
      App.isAdmin   = profile.profile.is_admin || false;
      App.userProfile = { ...App.userProfile, ...profile.profile };
      // Show admin nav
      if (App.isAdmin) {
        const adminNav = document.getElementById('adminNavItem');
        if (adminNav) adminNav.style.display = 'flex';
      }
      // Update plan badge
      const planEl = document.querySelector('.user-plan');
      if (planEl) {
        const plan = profile.profile.plan || 'free';
        planEl.textContent = plan.charAt(0).toUpperCase() + plan.slice(1) + ' Plan';
      }
    }
  } catch {}

  // Load templates on startup
  loadTemplates();
});



// ════════════════════════════════════════════════════════
// AUTOMATION / SCHEDULING
// ════════════════════════════════════════════════════════

let _scheduleType = 'email';

function setScheduleType(type) {
  _scheduleType = type;
  document.querySelectorAll('.schedule-type-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.type === type);
  });
  const subjGroup = document.getElementById('schedSubjectGroup');
  if (subjGroup) subjGroup.style.display = type === 'email' ? '' : 'none';
}

async function loadScheduledSends() {
  try {
    const data = await apiFetch(API_BASE + '/api/schedule');
    const list  = document.getElementById('scheduledList');
    if (!list) return;
    const items = data.scheduled || [];
    if (!items.length) {
      list.innerHTML = '<div class="empty-schedule"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><p>No scheduled sends yet. Create one above!</p></div>';
      return;
    }
    list.innerHTML = items.map(function(s) {
      const dt          = new Date(s.scheduled_at).toLocaleString();
      const icon        = s.type === 'whatsapp' ? '📱' : '✉️';
      const statusColor = s.status === 'pending' ? 'var(--amber)' : s.status === 'sent' ? 'var(--emerald)' : 'var(--red)';
      const cancelBtn   = s.status === 'pending'
        ? '<button class="btn btn-ghost btn-sm" data-sid="' + s.id + '" onclick="cancelSchedule(this.dataset.sid)">Cancel</button>'
        : '';
      return '<div class="schedule-card">' +
          '<div class="schedule-card-info">' +
            '<h4>' + icon + ' ' + (s.subject || s.type.toUpperCase()) + ' <span style="font-size:11px;color:' + statusColor + ';font-weight:600;margin-left:6px">' + s.status + '</span></h4>' +
            '<p>' + ((s.body || '').slice(0, 80)) + '...</p>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">' +
            '<span class="schedule-time-badge">' + dt + '</span>' +
            cancelBtn +
          '</div>' +
        '</div>';
    }).join('');
  } catch(e) { console.warn('Schedule load error:', e.message); }
}

async function cancelSchedule(id) {
  if (!confirm('Cancel this scheduled send?')) return;
  try {
    await apiFetch(API_BASE + '/api/schedule/' + id, { method: 'DELETE' });
    toast('Scheduled send cancelled', 'success');
    loadScheduledSends();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function createScheduledSend() {
  const schedAt    = document.getElementById('schedDateTime') ? document.getElementById('schedDateTime').value : '';
  const body       = document.getElementById('schedBody')     ? document.getElementById('schedBody').value.trim()    : '';
  const subject    = document.getElementById('schedSubject')  ? document.getElementById('schedSubject').value.trim() : '';
  const campEl     = document.getElementById('schedCampaign');
  const campaignId = campEl ? campEl.value : null;

  if (!schedAt) { toast('Please set a date and time', 'warn'); return; }
  if (!body)    { toast('Message body is required', 'warn');   return; }
  if (_scheduleType === 'email' && !subject) { toast('Subject is required for email', 'warn'); return; }

  const schedDate = new Date(schedAt);
  if (schedDate <= new Date()) { toast('Scheduled time must be in the future', 'warn'); return; }

  try {
    await apiFetch(API_BASE + '/api/schedule', {
      method: 'POST',
      body: JSON.stringify({ type: _scheduleType, scheduled_at: schedDate.toISOString(), campaignId: campaignId, subject: subject, body: body })
    });
    toast('Send scheduled!', 'success');
    ['schedDateTime','schedBody','schedSubject'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    loadScheduledSends();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function loadCampaignsForSchedule() {
  try {
    const data = await apiFetch(API_BASE + '/api/campaigns');
    const sel  = document.getElementById('schedCampaign');
    if (!sel) return;
    const camps = data.campaigns || [];
    sel.innerHTML = '<option value="">All leads (no specific campaign)</option>' +
      camps.map(function(c) {
        return '<option value="' + c.id + '">' + (c.name || c.niche) + '</option>';
      }).join('');
  } catch(e) {}
}

// ════════════════════════════════════════════════════════
// FILE UPLOAD helpers (brand logo & signature)
// ════════════════════════════════════════════════════════

async function handleBrandFileUpload(inputEl, type) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;
  const nameEl = document.getElementById(type === 'logo' ? 'brandLogoName' : 'brandSigName');
  if (nameEl) nameEl.textContent = file.name;
  try {
    const formData = new FormData();
    formData.append('file', file);
    const res  = await fetch(API_BASE + '/api/storage/upload/' + type, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getAuthToken() },
      body: formData,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Upload failed');
    const urlEl = document.getElementById(type === 'logo' ? 'brandLogoUrl' : 'brandSigUrl');
    if (urlEl) urlEl.value = json.url;
    if (type === 'logo') previewLogo(json.url);
    if (type === 'signature') {
      const prev = document.getElementById('sigPreview');
      if (prev) prev.innerHTML = '<img src="' + json.url + '" alt="Signature" style="width:100%;height:100%;object-fit:contain" />';
    }
    toast(type.charAt(0).toUpperCase() + type.slice(1) + ' uploaded!', 'success');
  } catch(err) { toast('Upload error: ' + err.message, 'error'); }
}

// ════════════════════════════════════════════════════════
// 5 BREVO SLOTS UI
// ════════════════════════════════════════════════════════

async function loadBrevoSlots() {
  const grid = document.getElementById('brevoSlotsGrid');
  if (!grid) return;
  try {
    const data  = await apiFetch(API_BASE + '/api/user/brevo-slots');
    const slots = data.slots || [];
    while (slots.length < 5) slots.push({ index: slots.length, label: 'Slot ' + (slots.length + 1), has_key: false, sent_today: 0 });
    grid.innerHTML = slots.map(function(s) {
      const statusClass = s.has_key ? 'active' : 'empty';
      const statusText  = s.has_key ? '✓ Active' : 'Empty';
      const clearBtn    = s.has_key ? '<button class="btn btn-ghost btn-sm" onclick="clearBrevoSlot(' + s.index + ')">✕</button>' : '';
      return '<div class="brevo-slot-row">' +
        '<span class="brevo-slot-label">Slot ' + (s.index + 1) + '</span>' +
        '<input type="password" class="form-input" id="brevoSlot' + s.index + '" placeholder="xkeysib-..." />' +
        '<input type="text" class="form-input" style="max-width:120px" id="brevoSlotLabel' + s.index + '" placeholder="Label" value="' + (s.label || '') + '" />' +
        '<span class="brevo-slot-status ' + statusClass + '">' + statusText + '</span>' +
        '<button class="btn btn-ghost btn-sm" onclick="saveBrevoSlot(' + s.index + ')">Save</button>' +
        clearBtn +
      '</div>';
    }).join('');
  } catch(e) {
    if (grid) grid.innerHTML = '<p style="color:var(--text-muted)">Premium feature — upgrade to manage slots.</p>';
  }
}

async function saveBrevoSlot(idx) {
  const keyEl   = document.getElementById('brevoSlot'      + idx);
  const labelEl = document.getElementById('brevoSlotLabel' + idx);
  const key     = keyEl   ? keyEl.value.trim()   : '';
  const label   = labelEl ? labelEl.value.trim()  : '';
  if (!key) { toast('Enter an API key for slot ' + (idx + 1), 'warn'); return; }
  try {
    await apiFetch(API_BASE + '/api/user/brevo-slots/' + idx, {
      method: 'PUT',
      body: JSON.stringify({ key: key, label: label })
    });
    toast('Brevo slot ' + (idx + 1) + ' saved!', 'success');
    loadBrevoSlots();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function clearBrevoSlot(idx) {
  if (!confirm('Clear Brevo slot ' + (idx + 1) + '?')) return;
  try {
    await apiFetch(API_BASE + '/api/user/brevo-slots/' + idx, { method: 'DELETE' });
    toast('Slot cleared', 'success');
    loadBrevoSlots();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}
