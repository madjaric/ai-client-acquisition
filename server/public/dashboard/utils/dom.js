/* ═══════════════════════════════════════════════════════════════
   utils/dom.js — DOM helpers: toast, button spinner, copy, sidebar
   ═══════════════════════════════════════════════════════════════ */

import { esc } from './formatters.js';

function toast(msg, type = 'info') {
  const icons = { info: '→', success: '✓', error: '✕' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]||'→'}</span><span class="toast-msg">${esc(msg)}</span><span class="toast-close" onclick="this.parentElement.remove()">×</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el?.remove(), 5000);
}

function setBtn(id, loading, text) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<span class="spinner"></span> ${text || 'Working…'}`
    : text;
}

/* ─── Score helpers ──────────────────────────── */

async function copyText(id, btn) {
  const text = document.getElementById(id)?.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = 'Copied!'; btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
    toast('Copied to clipboard.', 'success');
  } catch { toast('Copy failed — select text manually.', 'error'); }
}

/* ─── Navigation ────────────────────────────── */

function openSidebar()  {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sbOverlay').classList.add('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sbOverlay').classList.remove('open');
}

/* ─── Onboarding banner ──────────────────────── */

export {
  toast, setBtn, copyText, openSidebar, closeSidebar,
};
