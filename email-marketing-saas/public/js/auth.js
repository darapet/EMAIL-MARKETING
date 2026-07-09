/**
 * auth.js — Supabase Authentication for LeadForge
 * Handles login, register, logout, session persistence
 */

// ── Supabase Init ─────────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://lvmvimijhlxsnnmrjvie.supabase.co';
// Anon key is intentionally public — it's the client-safe key
const SUPABASE_ANON_KEY = window.__LF_ANON_KEY || '';

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!window.supabase) { console.error('Supabase SDK not loaded'); return null; }
  _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}

// ── Auth State ────────────────────────────────────────────────────────────────
let _currentSession = null;
let _currentUser    = null;

function getAuthToken()   { return _currentSession?.access_token  || null; }
function getCurrentUserId() { return _currentUser?.id || null; }
function isLoggedIn()     { return !!_currentUser; }

// ── Session watcher ───────────────────────────────────────────────────────────
function initAuth() {
  const sb = getSupabase();
  if (!sb) return showAuthError('Supabase SDK failed to load. Check your anon key.');

  // Get existing session
  sb.auth.getSession().then(({ data }) => {
    if (data?.session) {
      _currentSession = data.session;
      _currentUser    = data.session.user;
      onSignedIn(data.session);
    } else {
      showAuthOverlay('login');
    }
  });

  // Watch for changes
  sb.auth.onAuthStateChange((event, session) => {
    _currentSession = session;
    _currentUser    = session?.user || null;

    if (event === 'SIGNED_IN' && session) {
      onSignedIn(session);
    } else if (event === 'SIGNED_OUT') {
      onSignedOut();
    } else if (event === 'TOKEN_REFRESHED' && session) {
      _currentSession = session;
    }
  });
}

function onSignedIn(session) {
  hideAuthOverlay();
  updateUserUI(session.user);
  // Trigger app init (defined in app.js)
  if (typeof onAuthReady === 'function') onAuthReady(session.user);
}

function onSignedOut() {
  showAuthOverlay('login');
  _currentSession = null;
  _currentUser    = null;
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn      = document.getElementById('loginBtn');

  if (!email || !password) return authError('loginError', 'Email and password are required.');

  setAuthLoading(btn, true);
  clearAuthError('loginError');

  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  setAuthLoading(btn, false);

  if (error) return authError('loginError', error.message);
}

// ── Register ──────────────────────────────────────────────────────────────────
async function handleRegister(e) {
  e.preventDefault();
  const name     = document.getElementById('regName').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm  = document.getElementById('regConfirm').value;
  const btn      = document.getElementById('registerBtn');

  if (!name || !email || !password) return authError('registerError', 'All fields are required.');
  if (password.length < 6)          return authError('registerError', 'Password must be at least 6 characters.');
  if (password !== confirm)         return authError('registerError', 'Passwords do not match.');

  setAuthLoading(btn, true);
  clearAuthError('registerError');

  const { data, error } = await getSupabase().auth.signUp({
    email, password,
    options: { data: { name } }
  });
  setAuthLoading(btn, false);

  if (error) return authError('registerError', error.message);

  // Supabase may require email confirmation — check
  if (data?.user && !data.session) {
    // Email confirmation required
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('confirmEmailMsg').style.display = 'block';
  }
  // If auto-confirmed (e.g. disabled email confirm in Supabase), onAuthStateChange fires
}

// ── Logout ────────────────────────────────────────────────────────────────────
async function handleLogout() {
  await getSupabase().auth.signOut();
}

// ── Password Reset ────────────────────────────────────────────────────────────
async function handleForgotPassword() {
  const email = document.getElementById('loginEmail').value.trim();
  if (!email) return authError('loginError', 'Enter your email address first, then click Forgot Password.');
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href
  });
  if (error) return authError('loginError', error.message);
  clearAuthError('loginError');
  document.getElementById('loginError').textContent = '✓ Check your email for a password reset link.';
  document.getElementById('loginError').style.color = '#10b981';
  document.getElementById('loginError').style.display = 'block';
}

// ── Overlay helpers ───────────────────────────────────────────────────────────
function showAuthOverlay(tab = 'login') {
  document.getElementById('authOverlay').classList.add('visible');
  document.getElementById('sidebar').style.display    = 'none';
  document.getElementById('mainContent').style.display = 'none';
  switchAuthTab(tab);
}

function hideAuthOverlay() {
  document.getElementById('authOverlay').classList.remove('visible');
  document.getElementById('sidebar').style.display    = '';
  document.getElementById('mainContent').style.display = '';
}

function switchAuthTab(tab) {
  document.getElementById('loginPane').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('registerPane').style.display = tab === 'register' ? 'block' : 'none';
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.auth-tab[data-tab="${tab}"]`);
  if (activeTab) activeTab.classList.add('active');
}

function showAuthError(msg) {
  console.error('[Auth]', msg);
}

function authError(fieldId, msg) {
  const el = document.getElementById(fieldId);
  if (el) { el.textContent = msg; el.style.display = 'block'; el.style.color = '#dc2626'; }
}

function clearAuthError(fieldId) {
  const el = document.getElementById(fieldId);
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

function setAuthLoading(btn, loading) {
  btn.disabled     = loading;
  btn.textContent  = loading ? 'Please wait...' : btn.dataset.label;
}

function updateUserUI(user) {
  if (!user) return;
  const name   = user.user_metadata?.name || user.email?.split('@')[0] || 'User';
  const plan   = user.user_metadata?.plan || 'Free';
  const isAdmin = user.user_metadata?.is_admin || false;

  const nameEl   = document.getElementById('userName');
  const avatarEl = document.getElementById('userAvatar');
  const planEl   = document.querySelector('.user-plan');
  const adminNav = document.getElementById('adminNavItem');

  if (nameEl)   nameEl.textContent   = name;
  if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
  if (planEl)   planEl.textContent   = plan.charAt(0).toUpperCase() + plan.slice(1) + ' Plan';
  if (adminNav && isAdmin) adminNav.style.display = 'flex';

  // Store in App state for use by app.js
  if (window.App) {
    App.userProfile = { ...App.userProfile, name, email: user.email, plan, isAdmin };
    App.isPremium = plan === 'premium' || isAdmin;
    App.isAdmin   = isAdmin;
  }
}

// ── API fetch with Supabase JWT ───────────────────────────────────────────────
// Override the apiFetch in app.js to include Authorization header
async function apiFetch(url, options = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res  = await fetch(url, { ...options, headers });
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
