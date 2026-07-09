/**
 * features.js — Extended features for LeadForge
 * Select All, AI Generate (Groq), Templates, Admin, Premium gates,
 * Scraped preview, Schedule, Brevo slots — all via Supabase direct
 */

// ── SELECT ALL CHANNELS ───────────────────────────────────────────────────────
function selectAllChannels() {
  const all        = document.querySelectorAll('.channel-checkbox');
  const anyUnchecked = [...all].some(l => !l.classList.contains('checked'));
  all.forEach(label => {
    const input = label.querySelector('input');
    if (anyUnchecked) {
      input.checked = true; label.classList.add('checked');    App.selectedChannels.add(input.value);
    } else {
      input.checked = false; label.classList.remove('checked'); App.selectedChannels.delete(input.value);
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

// ── SCRAPED LEADS PREVIEW — Supabase direct ───────────────────────────────────
App._scrapedCampaignId = null;

function showScrapedPreview(campaignId, totalLeads) {
  App._scrapedCampaignId = campaignId;
  openModal('scrapedPreviewModal');
  loadScrapedLeadsPreview(campaignId);
}

async function loadScrapedLeadsPreview(campaignId) {
  const body = document.getElementById('scrapedPreviewBody');
  if (!body) return;
  body.innerHTML = '<p style="text-align:center;padding:1rem">Loading scraped leads...</p>';

  try {
    const sb = getSupabase();
    const { data: leads, error } = await sb
      .from('leads')
      .select('id, business_name, email, phone, social_urls')
      .eq('campaign_id', campaignId);

    if (error) throw error;
    if (!leads?.length) {
      body.innerHTML = '<p style="text-align:center;color:var(--text-muted)">No leads found in this campaign.</p>';
      return;
    }

    body.innerHTML = `
      <div style="margin-bottom:1rem;display:flex;align-items:center;gap:.5rem">
        <input type="checkbox" id="selectAllScraped" onchange="toggleSelectAllScraped(this)">
        <label for="selectAllScraped">Select All (${leads.length} leads)</label>
        <span style="margin-left:auto;font-size:.85rem;color:var(--text-muted)">
          ${leads.filter(l => l.email).length} with email · ${leads.filter(l => l.phone).length} with phone
        </span>
      </div>
      ${leads.map(lead => `
        <div class="lead-preview-row">
          <input type="checkbox" class="scraped-cb" value="${esc(lead.id)}" ${lead.email ? '' : 'disabled'}>
          <div>
            <strong>${esc(lead.business_name || 'Unknown Business')}</strong>
            ${lead.email ? `<a href="mailto:${esc(lead.email)}">${esc(lead.email)}</a>` : '<em style="color:var(--text-muted)">no email</em>'}
            ${lead.phone ? `<span>📱 ${esc(lead.phone)}</span>` : ''}
          </div>
        </div>
      `).join('')}
      <div style="margin-top:1rem;display:flex;gap:.5rem;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="closeModal('scrapedPreviewModal')">Cancel</button>
        <button class="btn btn-primary" onclick="proceedToSendScraped()">Send Outreach →</button>
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<p style="color:var(--danger)">Error: ${esc(err.message)}</p>`;
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
  App._pendingLeadIds   = leadIds;
  App._pendingCampaignId = App._scrapedCampaignId;
  navigateTo('outreach');
  const sel = document.getElementById('emailCampaignSelect');
  if (sel) sel.value = App._scrapedCampaignId;
  toast(`${leadIds.length} leads selected for outreach`, 'success');
}

// ── AI GENERATE — Groq API (browser-side, no backend needed) ──────────────────
function getGroqKey() {
  return App.userProfile.groq_key || App.userProfile.groqApiKey || '';
}

async function aiGenerateEmail() {
  const niche   = document.getElementById('nicheInput')?.value
    || document.getElementById('emailCampaignSelect')?.selectedOptions[0]?.text
    || 'Business';
  const btn    = document.getElementById('aiGenerateBtn');
  const tone   = document.getElementById('aiToneSelect')?.value  || 'professional';
  const goal   = document.getElementById('aiGoalSelect')?.value  || 'service_offer';
  const groqKey = getGroqKey();

  if (!groqKey) { toast('Add your Groq API key in Settings → API Keys to use AI generation', 'warn'); return; }

  if (btn) { btn.disabled = true; btn.textContent = '✨ Generating...'; }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          { role: 'system', content: 'You are an expert email marketing copywriter. Return only valid JSON with "subject" and "body" string fields. No markdown, no explanations.' },
          { role: 'user',   content: `Write a ${tone} cold outreach email targeting a ${niche} business. Goal: ${goal}. Make it concise, personal, and compelling. Return JSON: {"subject":"...","body":"..."}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 800,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error?.message || `HTTP ${res.status}`);
    }

    const data    = await res.json();
    const content = JSON.parse(data.choices[0].message.content);
    if (content.subject) document.getElementById('emailSubject').value = content.subject;
    if (content.body)    document.getElementById('emailBody').value    = content.body;
    toast('AI draft generated!', 'success');
  } catch (err) {
    toast('AI generation failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ AI Generate'; }
  }
}

async function aiGenerateWA() {
  const niche   = document.getElementById('nicheInput')?.value || 'Business';
  const btn     = document.getElementById('aiGenerateWaBtn');
  const groqKey = getGroqKey();

  if (!groqKey) { toast('Add your Groq API key in Settings → API Keys to use AI generation', 'warn'); return; }

  if (btn) { btn.disabled = true; btn.textContent = '✨ Generating...'; }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          { role: 'system', content: 'You are a WhatsApp marketing expert. Write short, friendly WhatsApp messages. Return only valid JSON with a "message" string field.' },
          { role: 'user',   content: `Write a WhatsApp cold outreach message targeting a ${niche} business. Keep it under 150 words, casual and friendly. Include a call to action. Return JSON: {"message":"..."}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 400,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error?.message || `HTTP ${res.status}`);
    }

    const data    = await res.json();
    const content = JSON.parse(data.choices[0].message.content);
    if (content.message) document.getElementById('waMessage').value = content.message;
    toast('AI message generated!', 'success');
  } catch (err) {
    toast('AI generation failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ AI Generate Message'; }
  }
}

// ── EMAIL TEMPLATES — Supabase direct ────────────────────────────────────────
let _editingTemplateId = null;

async function loadTemplates() {
  const sb  = getSupabase();
  const uid = getCurrentUserId();
  if (!sb || !uid) return;

  const list = document.getElementById('templateList');
  if (list) list.innerHTML = '<p style="color:var(--text-muted);padding:.5rem">Loading templates...</p>';

  try {
    const { data: templates, error } = await sb
      .from('templates')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!templates?.length) {
      if (list) list.innerHTML = '<p style="color:var(--text-muted);padding:.5rem">No templates yet. Create one below.</p>';
      return;
    }

    if (list) {
      list.innerHTML = templates.map(t => `
        <div class="template-card ${t.is_default ? 'is-default' : ''}" id="tmpl-${esc(t.id)}">
          <div class="template-card-header">
            <strong>${esc(t.name)}</strong>
            ${t.is_default ? '<span class="badge">Default</span>' : ''}
          </div>
          <div class="template-card-sub">${esc(t.subject)}</div>
          <div class="template-card-actions">
            <button class="btn-link" onclick="editTemplate('${esc(t.id)}')">Edit</button>
            ${!t.is_default ? `<button class="btn-link" onclick="setDefaultTemplate('${esc(t.id)}')">Set Default</button>` : ''}
            <button class="btn-link danger" onclick="deleteTemplate('${esc(t.id)}')">Delete</button>
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    if (list) list.innerHTML = `<p style="color:var(--danger)">Error loading templates: ${esc(err.message)}</p>`;
  }
}

function editTemplate(id) {
  const sb  = getSupabase();
  const uid = getCurrentUserId();
  if (!sb || !uid) return;

  sb.from('templates').select('*').eq('id', id).eq('user_id', uid).single().then(({ data: t }) => {
    if (!t) return;
    _editingTemplateId = id;
    const nm = document.getElementById('templateName');    if (nm) nm.value = t.name    || '';
    const su = document.getElementById('templateSubject'); if (su) su.value = t.subject || '';
    const bo = document.getElementById('templateBody');    if (bo) bo.value = t.body    || '';
    const lo = document.getElementById('templateLogoUrl'); if (lo) lo.value = t.logo_url || '';
    const si = document.getElementById('templateSigUrl');  if (si) si.value = t.signature_url || '';
    const saveBtn = document.getElementById('saveTemplateBtn');
    if (saveBtn) saveBtn.textContent = 'Update Template';
  });
}

function clearTemplateForm() {
  _editingTemplateId = null;
  ['templateName','templateSubject','templateBody','templateLogoUrl','templateSigUrl'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const saveBtn = document.getElementById('saveTemplateBtn');
  if (saveBtn) saveBtn.textContent = 'Save Template';
}

async function saveTemplate() {
  const sb  = getSupabase();
  const uid = getCurrentUserId();
  if (!sb || !uid) return;

  const payload = {
    user_id:       uid,
    name:          document.getElementById('templateName')?.value.trim()    || '',
    subject:       document.getElementById('templateSubject')?.value.trim() || '',
    body:          document.getElementById('templateBody')?.value.trim()    || '',
    logo_url:      document.getElementById('templateLogoUrl')?.value.trim() || '',
    signature_url: document.getElementById('templateSigUrl')?.value.trim()  || '',
  };

  if (!payload.name || !payload.subject) { toast('Template name and subject are required', 'warn'); return; }

  try {
    if (_editingTemplateId) {
      const { error } = await sb.from('templates').update(payload).eq('id', _editingTemplateId).eq('user_id', uid);
      if (error) throw error;
      toast('Template updated!', 'success');
    } else {
      const { error } = await sb.from('templates').insert(payload);
      if (error) throw error;
      toast('Template saved!', 'success');
    }
    clearTemplateForm();
    loadTemplates();
  } catch (err) {
    toast('Error saving template: ' + err.message, 'error');
  }
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  const sb  = getSupabase();
  const uid = getCurrentUserId();
  if (!sb || !uid) return;

  try {
    const { error } = await sb.from('templates').delete().eq('id', id).eq('user_id', uid);
    if (error) throw error;
    toast('Template deleted', 'success');
    loadTemplates();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function setDefaultTemplate(id) {
  const sb  = getSupabase();
  const uid = getCurrentUserId();
  if (!sb || !uid) return;

  try {
    // Clear existing default
    await sb.from('templates').update({ is_default: false }).eq('user_id', uid).eq('is_default', true);
    // Set new default
    await sb.from('templates').update({ is_default: true }).eq('id', id).eq('user_id', uid);
    toast('Default template set!', 'success');
    loadTemplates();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

// ── ADMIN DASHBOARD — Supabase direct ────────────────────────────────────────
async function loadAdminDashboard() {
  if (!App.isAdmin) return;

  try {
    const sb = getSupabase();

    // Run all queries in parallel
    const [usersRes, campaignsRes, leadsRes] = await Promise.all([
      sb.from('profiles').select('id, plan', { count: 'exact' }),
      sb.from('campaigns').select('id', { count: 'exact' }),
      sb.from('leads').select('id', { count: 'exact' }),
    ]);

    const totalUsers    = usersRes.count   || 0;
    const premiumUsers  = (usersRes.data   || []).filter(u => u.plan === 'premium').length;
    const totalCampaigns = campaignsRes.count || 0;

    const selectors = {
      '.admin-stat-users':    totalUsers,
      '.admin-stat-premium':  premiumUsers,
      '.admin-stat-campaigns': totalCampaigns,
      '.admin-stat-emails':   '—',
    };
    Object.entries(selectors).forEach(([sel, val]) => {
      const el = document.querySelector(sel); if (el) el.textContent = val;
    });

    loadAdminUsers();
  } catch (err) {
    console.error('Admin dashboard error:', err);
  }
}

async function loadAdminUsers() {
  const sb  = getSupabase();
  const uid = getCurrentUserId();
  if (!sb) return;

  const tbody = document.getElementById('adminUsersBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';

  try {
    const { data: users, error } = await sb
      .from('profiles')
      .select('id, name, email, plan, is_admin, created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    tbody.innerHTML = (users || []).map(u => `
      <tr>
        <td>${esc(u.name || u.email || u.id)}<br><small style="color:var(--text-muted)">${esc(u.email || '')}</small></td>
        <td><span class="badge">${esc(u.plan || 'free')}</span></td>
        <td>${u.is_admin ? '✓ Admin' : '—'}</td>
        <td>${formatDate(u.created_at)}</td>
        <td>
          <button class="btn-icon" onclick="updateUserPlan('${esc(u.id)}', '${u.plan === 'premium' ? 'free' : 'premium'}')">
            ${u.plan === 'premium' ? 'Downgrade' : 'Upgrade'}
          </button>
          <button class="btn-icon" onclick="toggleUserAdmin('${esc(u.id)}', ${!u.is_admin})">
            ${u.is_admin ? 'Remove Admin' : 'Make Admin'}
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--danger)">Error: ${esc(err.message)}</td></tr>`;
  }
}

async function updateUserPlan(userId, newPlan) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { error } = await sb.from('profiles').update({ plan: newPlan }).eq('id', userId);
    if (error) throw error;
    toast(`User plan updated to ${newPlan}`, 'success');
    loadAdminUsers();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function toggleUserAdmin(userId, isAdmin) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { error } = await sb.from('profiles').update({ is_admin: isAdmin }).eq('id', userId);
    if (error) throw error;
    toast(`Admin status ${isAdmin ? 'granted' : 'revoked'}`, 'success');
    loadAdminUsers();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function loadAdminActivity() {
  const sb = getSupabase();
  if (!sb) return;

  const tbody = document.getElementById('adminActivityBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';

  try {
    const { data: logs, error } = await sb
      .from('activity_logs')
      .select('created_at, user_id, action, details')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    tbody.innerHTML = (logs || []).map(l => `
      <tr>
        <td>${formatDate(l.created_at)}</td>
        <td>${esc(l.user_id?.slice(0, 8) || '—')}…</td>
        <td>${esc(l.action || '—')}</td>
        <td>${esc(typeof l.details === 'object' ? JSON.stringify(l.details) : l.details || '—')}</td>
      </tr>
    `).join('') || '<tr><td colspan="4" style="text-align:center">No activity yet</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4">Activity log not available</td></tr>`;
  }
}

// ── PROFILE SETTINGS (settings page load) — Supabase direct ──────────────────
async function loadProfileSettings() {
  const sb  = getSupabase();
  const uid = getCurrentUserId();
  if (!sb || !uid) return;

  try {
    const { data: profile, error } = await sb
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .single();

    if (error || !profile) return;

    // Merge into App state
    Object.assign(App.userProfile, profile);
    localStorage.setItem('lf_profile', JSON.stringify(App.userProfile));
    loadProfileIntoForm();
  } catch (err) {
    console.warn('Could not load profile settings:', err.message);
  }
}

// ── AUTOMATION / SCHEDULE — Supabase direct ───────────────────────────────────
async function loadSchedules() {
  const sb  = getSupabase();
  const uid = getCurrentUserId();
  if (!sb || !uid) return;

  const tbody = document.getElementById('scheduleList') || document.getElementById('scheduleBody');
  if (!tbody) return;
  tbody.innerHTML = '<p style="color:var(--text-muted)">Loading...</p>';

  try {
    const { data: schedules, error } = await sb
      .from('schedules')
      .select('*, campaigns(name, niche)')
      .eq('user_id', uid)
      .order('send_at', { ascending: true });

    if (error) throw error;

    if (!schedules?.length) {
      tbody.innerHTML = '<p style="color:var(--text-muted)">No scheduled sends yet.</p>';
      return;
    }

    tbody.innerHTML = schedules.map(s => `
      <div class="schedule-row">
        <div>
          <strong>${esc(s.type === 'email' ? '✉ Email' : '📱 WhatsApp')}</strong>
          — ${esc(s.campaigns?.niche || s.campaign_id || '—')}
        </div>
        <div>${formatDate(s.send_at)}</div>
        <div><span class="badge badge-${s.status || 'pending'}">${esc(s.status || 'pending')}</span></div>
        <div>${esc(s.subject || s.message?.slice(0, 40) || '—')}</div>
        <div>
          <button class="btn-icon danger" onclick="deleteSchedule('${esc(s.id)}')">✕ Remove</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<p style="color:var(--danger)">Error: ${esc(err.message)}</p>`;
  }
}

async function deleteSchedule(id) {
  if (!confirm('Remove this scheduled send?')) return;
  const sb  = getSupabase();
  const uid = getCurrentUserId();
  if (!sb || !uid) return;

  try {
    const { error } = await sb.from('schedules').delete().eq('id', id).eq('user_id', uid);
    if (error) throw error;
    toast('Schedule removed', 'success');
    loadSchedules();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function addSchedule() {
  const sb  = getSupabase();
  const uid = getCurrentUserId();
  if (!sb || !uid) return;

  const campaignId = document.getElementById('scheduleCampaignSelect')?.value;
  const type       = document.getElementById('scheduleType')?.value       || 'email';
  const sendAt     = document.getElementById('scheduleSendAt')?.value;
  const subject    = document.getElementById('scheduleSubject')?.value?.trim();
  const message    = document.getElementById('scheduleMessage')?.value?.trim();

  if (!campaignId || !sendAt) { toast('Select a campaign and send time', 'warn'); return; }
  if (!message && !subject)   { toast('Enter a subject or message', 'warn'); return; }

  try {
    const { error } = await sb.from('schedules').insert({
      user_id:     uid,
      campaign_id: campaignId,
      type,
      send_at:     new Date(sendAt).toISOString(),
      subject:     subject || '',
      message:     message || '',
      status:      'pending',
    });
    if (error) throw error;
    toast('Scheduled!', 'success');
    loadSchedules();
  } catch (err) {
    toast('Error scheduling: ' + err.message, 'error');
  }
}

function populateScheduleCampaignSelect() {
  const sel = document.getElementById('scheduleCampaignSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">Choose campaign...</option>' +
    App.campaigns.map(c => `<option value="${esc(c.id)}">${esc(c.niche)} (${c.leadsCount || 0} leads)</option>`).join('');
}

// ── BREVO MULTI-SLOT MANAGEMENT — Supabase direct ────────────────────────────
// Brevo slots are stored as JSONB in profiles.brevo_slots:
// [{ index: 0, key: "xkeysib-...", label: "Main", has_key: true }, ...]

async function loadBrevoSlots() {
  const sb  = getSupabase();
  const uid = getCurrentUserId();
  if (!sb || !uid) return;

  const grid = document.getElementById('brevoSlotsGrid');
  if (!grid) return;

  try {
    const { data: profile, error } = await sb
      .from('profiles')
      .select('brevo_slots, plan')
      .eq('id', uid)
      .single();

    if (error) throw error;

    const isPremium = profile?.plan === 'premium' || App.isAdmin;
    if (!isPremium) {
      grid.innerHTML = '<p style="color:var(--text-muted)">Premium feature — upgrade to manage multiple Brevo slots.</p>';
      return;
    }

    // Normalise to 5 slots
    const savedSlots = profile?.brevo_slots || [];
    const slots = Array.from({ length: 5 }, (_, i) => {
      const saved = savedSlots.find(s => s.index === i) || {};
      return { index: i, key: '', label: '', ...saved, has_key: !!(saved.key) };
    });

    grid.innerHTML = slots.map(s => `
      <div class="brevo-slot ${s.has_key ? 'active' : 'empty'}">
        <div class="brevo-slot-header">
          <span>Slot ${s.index + 1}</span>
          <span class="badge ${s.has_key ? 'badge-success' : ''}">${s.has_key ? '✓ Active' : 'Empty'}</span>
        </div>
        <input id="brevoSlotLabel${s.index}" type="text"  placeholder="Label (e.g. Main)" value="${esc(s.label || '')}">
        <input id="brevoSlot${s.index}"      type="password" placeholder="Brevo API key" value="${esc(s.key || '')}">
        <div style="display:flex;gap:.5rem;margin-top:.5rem">
          <button class="btn btn-primary btn-sm" onclick="saveBrevoSlot(${s.index})">Save</button>
          ${s.has_key ? `<button class="btn btn-secondary btn-sm" onclick="clearBrevoSlot(${s.index})">✕ Clear</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch (err) {
    if (grid) grid.innerHTML = '<p style="color:var(--text-muted)">Premium feature — upgrade to manage slots.</p>';
  }
}

async function saveBrevoSlot(idx) {
  const keyEl   = document.getElementById(`brevoSlot${idx}`);
  const labelEl = document.getElementById(`brevoSlotLabel${idx}`);
  const key     = keyEl   ? keyEl.value.trim()   : '';
  const label   = labelEl ? labelEl.value.trim() : '';
  if (!key) { toast(`Enter an API key for slot ${idx + 1}`, 'warn'); return; }

  const sb  = getSupabase();
  const uid = getCurrentUserId();
  if (!sb || !uid) return;

  try {
    // Read current slots, update the one at idx, write back
    const { data: profile } = await sb.from('profiles').select('brevo_slots').eq('id', uid).single();
    const slots = profile?.brevo_slots || [];
    const existing = slots.findIndex(s => s.index === idx);
    const updated  = { index: idx, key, label, has_key: true };
    if (existing >= 0) slots[existing] = updated;
    else slots.push(updated);

    const { error } = await sb.from('profiles').update({ brevo_slots: slots }).eq('id', uid);
    if (error) throw error;

    // Update local profile cache
    App.userProfile.brevo_slots = slots;
    if (idx === 0) App.userProfile.brevo_key = key; // keep primary key in sync
    localStorage.setItem('lf_profile', JSON.stringify(App.userProfile));

    toast(`Brevo slot ${idx + 1} saved!`, 'success');
    loadBrevoSlots();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function clearBrevoSlot(idx) {
  if (!confirm(`Clear Brevo slot ${idx + 1}?`)) return;

  const sb  = getSupabase();
  const uid = getCurrentUserId();
  if (!sb || !uid) return;

  try {
    const { data: profile } = await sb.from('profiles').select('brevo_slots').eq('id', uid).single();
    const slots   = (profile?.brevo_slots || []).filter(s => s.index !== idx);
    const { error } = await sb.from('profiles').update({ brevo_slots: slots }).eq('id', uid);
    if (error) throw error;

    App.userProfile.brevo_slots = slots;
    if (idx === 0) App.userProfile.brevo_key = '';
    localStorage.setItem('lf_profile', JSON.stringify(App.userProfile));

    toast('Slot cleared', 'success');
    loadBrevoSlots();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

// ── REGISTER AUTH HOOK (runs after Supabase session confirmed) ────────────────
window._lfAuthHooks = window._lfAuthHooks || [];
window._lfAuthHooks.push(function(user) {
  // Pre-fill schedule campaign select when it exists
  const schedSel = document.getElementById('scheduleCampaignSelect');
  if (schedSel) populateScheduleCampaignSelect();
  // Load profile settings fresh from Supabase
  loadProfileSettings();
});
