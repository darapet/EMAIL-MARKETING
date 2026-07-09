/**
 * supabase-api.js
 *
 * Pre-declares window.App so any top-level code in other scripts
 * that references App doesn't throw a ReferenceError before app.js loads.
 *
 * All data routing (Supabase, Brevo, Groq) is now handled directly
 * in app.js and features.js — no backend server required.
 */
window.App = window.App || {};
