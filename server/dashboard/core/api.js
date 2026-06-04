/* ═══════════════════════════════════════════════════════════════
   core/api.js — API wrapper (fetch + auth headers) + connection check
   ═══════════════════════════════════════════════════════════════ */

import { state } from './state.js';

async function apiFetch(method, path, body) {
  const headers = Object.assign({}, window.LF_HEADERS || { 'Content-Type': 'application/json' });
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(state.API_BASE + path, opts);
    if (res.status === 401) {
      // Only force re-login if user had a token (session expired)
      if (window.LF_TOKEN) {
        localStorage.removeItem('lf_token');
        localStorage.removeItem('lf_user');
        window.location.replace('/login.html?reason=expired');
      }
      return { success: false, message: 'Please sign in to use this feature.' };
    }
    if (!res.ok) {
      const text = await res.text();
      try { return JSON.parse(text); } catch { return { success: false, message: 'HTTP ' + res.status }; }
    }
    return res.json();
  } catch (err) {
    console.error('[apiFetch]', method, path, err.message);
    return { success: false, message: 'Network error — is the server running?' };
  }
}

/* ─── Connection ─────────────────────────────── */

async function checkConnection() {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error('not ok');
    const d  = await res.json();
    const ok = d.status === 'healthy';
    if (dot)  dot.className  = 'status-dot ' + (ok ? 'ok' : 'err');
    if (text) text.textContent = ok ? 'Connected' : 'Degraded';
  } catch {
    if (dot)  dot.className  = 'status-dot err';
    if (text) text.textContent = 'Offline';
  }
}

const checkHealth = checkConnection;

/* ─── Toast ─────────────────────────────────── */

export {
  apiFetch, checkConnection, checkHealth,
};
