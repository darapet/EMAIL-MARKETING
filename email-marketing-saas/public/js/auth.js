/**
 * auth.js — Supabase Authentication for LeadForge
 * Handles login, register, logout, session persistence
 * NOTE: All data operations go directly to Supabase — no backend server required.
 */

// ── Supabase Init ─────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://lvmvimijhlxsnnmrjvie.supabase.co';
// Anon key is intentionally public — it's the client-safe key.
// Set window.__LF_ANON_KEY in your index.html before this script loads.
// Find it in: Supabase Dashboard → Project Settings → API → anon / public
const SUPABASE_ANON_KEY = window.__LF_ANON_KEY || '';

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!window.supabase) { console.error('Supabase SDK not loaded'); return null; }
  if (!SUPABASE_ANON_KEY) { console.error('Supabase anon key not set. Add window.__LF_ANON_KEY to index.html'); return null; }
  _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}

// ── Auth State ────────────────────────────────────────────────────────────────
let _currentSession = null;
let _currentUser    = null;

function getAuthToken()    { return _currentSession?.access_token || null; }
function getCurrentUserId(){ return _currentUser?.id || null; }
function isLoggedIn()      { return !!_currentUser; }

// ── Session watcher ───────────────────────────────────────────────────────────
function initAuth() {
  const sb = getSupabase();
  if (!sb) return showAuthError('Supabase failed to load. Check window.__LF_ANON_KEY in index.html.');

  sb.auth.getSession().then(({ data }) => {
    if (data?.session) {
      _currentSession = data.session;
      _currentUser    = data.session.user;
      onSignedIn(data.session);
    } else {
      showAuthOverlay('login');
    }
  });

  sb.auth.onAuthStateChange((event, session) => {
    _currentSession = session;
    _currentUser    = session?.user || null;
    if (event === 'SIGNED_IN' && session)  onSignedIn(session);
    else if (event === 'SIGNED_OUT')       onSignedOut();
    else if (event === 'TOKEN_REFRESHED' && session) _currentSession = session;
  });
}

async function onSignedIn(session) {
  hideAuthOverlay();
  updateUserUI(session.user);

  // Fetch real profile directly from Supabase (no backend needed)
  try {
    const sb = getSupabase();
    if (sb) {
      const { data: profile, error } = await sb
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
      if (profile && !error) applyProfile(profile);
    }
  } catch (e) {
    console.warn('[Auth] Could not fetch profile from Supabase:', e.message);
  }

  if (typeof onAuthReady === 'function') onAuthReady(session.user);
}

// applyProfile — update the whole UI from the real profiles table row
function applyProfile(profile) {
  const isAdmin = profile.is_admin === true;
  const plan    = profile.plan || 'free';
  const name    = profile.name || profile.email?.split('@')[0] || 'User';

  const nameEl    = document.getElementById('userName');
  const avatarEl  = document.getElementById('userAvatar');
  const planEl    = document.querySelector('.user-plan');
  const adminNav  = document.getElementById('adminNavItem');

  if (nameEl)   nameEl.textContent   = name;
  if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
  if (planEl)   planEl.textContent   = plan.charAt(0).toUpperCase() + plan.slice(1) + ' Plan';
  if (adminNav) adminNav.style.display = isAdmin ? 'flex' : 'none';

  if (window.App) {
    App.userProfile = Object.assign({}, App.userProfile, profile, { name, plan, isAdmin, is_admin: isAdmin });
    App.isPremium   = plan === 'premium' || isAdmin;
    App.isAdmin     = isAdmin;
  }
}

function onSignedOut() {
  showAuthOverlay('login');
  _currentSession = null;
  _currentUser    = null;
}

// ─── Password show/hide ───────────────────────────────────────────────────────
function togglePwVisibility(fieldId) {
  const input = document.getElementById(fieldId);
  if (!input) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  const btn = input.closest('.pw-wrap')?.querySelector('.pw-eye');
  if (btn) {
    btn.innerHTML = isPassword
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>';
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPassword').value;
  if (!email || !pass) { toast('Enter email and password', 'warn'); return; }

  const btn = document.getElementById('loginBtn');
  btn.disabled    = true;
  btn.textContent = 'Signing in…';

  const sb = getSupabase();
  if (!sb) { btn.disabled = false; btn.textContent = 'Sign In'; return; }

  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) {
    showAuthError(error.message);
    btn.disabled    = false;
    btn.textContent = 'Sign In';
  }
}

// ── Register ──────────────────────────────────────────────────────────────────
async function handleRegister() {
  const name  = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass  = document.getElementById('regPassword').value;
  const conf  = document.getElementById('regConfirm').value;

  if (!name || !email || !pass) { toast('All fields are required', 'warn'); return; }
  if (pass !== conf) { toast('Passwords do not match', 'warn'); return; }
  if (pass.length < 6) { toast('Password must be at least 6 characters', 'warn'); return; }

  const btn = document.getElementById('registerBtn');
  btn.disabled    = true;
  btn.textContent = 'Creating account…';

  const sb = getSupabase();
  if (!sb) { btn.disabled = false; btn.textContent = 'Create Account'; return; }

  const { data, error } = await sb.auth.signUp({
    email,
    password: pass,
    options: { data: { name } },
  });

  if (error) {
    showAuthError(error.message);
    btn.disabled    = false;
    btn.textContent = 'Create Account';
    return;
  }

  // Create profile row
  if (data?.user) {
    await sb.from('profiles').upsert({
      id:   data.user.id,
      name,
      email,
      plan: 'free',
      is_admin: false,
    }, { onConflict: 'id' });
  }

  document.getElementById('regSuccess').style.display = 'block';
  btn.disabled    = false;
  btn.textContent = 'Create Account';
}

// ── Forgot password ───────────────────────────────────────────────────────────
async function handleForgotPassword() {
  const email = document.getElementById('loginEmail').value.trim();
  if (!email) { toast('Enter your email first', 'warn'); return; }
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.resetPasswordForEmail(email);
  toast('Password reset link sent to ' + email, 'success');
}

// ── Logout ────────────────────────────────────────────────────────────────────
async function handleLogout() {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut();
  localStorage.removeItem('lf_profile');
}

// ── Auth overlay helpers ──────────────────────────────────────────────────────
function showAuthOverlay(tab = 'login') {
  const overlay = document.getElementById('authOverlay');
  if (overlay) overlay.classList.add('open');
  switchAuthTab(tab);
}

function hideAuthOverlay() {
  const overlay = document.getElementById('authOverlay');
  if (overlay) overlay.classList.remove('open');
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  const btn  = document.querySelector(`.auth-tab[data-tab="${tab}"]`);
  const form = document.getElementById(`authForm-${tab}`);
  if (btn)  btn.classList.add('active');
  if (form) form.classList.add('active');
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
  else toast(msg, 'error');
}

// ── User UI ───────────────────────────────────────────────────────────────────
function updateUserUI(user) {
  if (!user) return;
  const name  = user.user_metadata?.name || user.email?.split('@')[0] || 'User';
  const plan  = user.user_metadata?.plan || 'free';

  const nameEl   = document.getElementById('userName');
  const avatarEl = document.getElementById('userAvatar');
  const planEl   = document.querySelector('.user-plan');
  const adminNav = document.getElementById('adminNavItem');

  if (nameEl)   nameEl.textContent   = name;
  if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
  if (planEl)   planEl.textContent   = plan.charAt(0).toUpperCase() + plan.slice(1) + ' Plan';
  if (adminNav) adminNav.style.display = 'none'; // applyProfile() will set correctly

  if (window.App) {
    App.userProfile = Object.assign({}, App.userProfile, { name, email: user.email, plan });
  }
}

// ── apiFetch — Supabase JWT wrapper ──────────────────────────────────────────
// Only used for features that still need a backend. Most calls now go directly
// to Supabase. If API_BASE is empty these calls will fail gracefully.
async function apiFetch(url, options = {}) {
  const base = (window.__LF_API_BASE || '').replace(/\/$/, '');
  const fullUrl = url.startsWith('http') ? url : base + url;
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res  = await fetch(fullUrl, { ...options, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) { handleLogout(); return; }
    if (res.status === 403 && json.upgrade_required) {
      showPremiumModal();
      throw new Error('Premium feature — upgrade to access');
    }
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return json;
}

// ── Premium gate modal ────────────────────────────────────────────────────────
function showPremiumModal() {
  const modal = document.getElementById('premiumModal');
  if (modal) modal.classList.add('open');
}
