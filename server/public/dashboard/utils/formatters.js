/* ═══════════════════════════════════════════════════════════════
   utils/formatters.js — pure text/score/badge formatting helpers
   ═══════════════════════════════════════════════════════════════ */


function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function scoreColor(n) {
  if (n >= 8) return 'var(--brand)';
  if (n >= 6) return '#60a5fa';
  if (n >= 4) return 'var(--amber)';
  return 'var(--red)';
}

function scoreBar(n) {
  const col = scoreColor(n);
  return `<div class="score-row">
    <span class="score-num" style="color:${col}">${n}</span>
    <div class="score-track"><div class="score-fill" style="width:${n*10}%;background:${col}"></div></div>
  </div>`;
}

function badgeStatus(s) { return `<span class="badge badge-${s}">${s}</span>`; }

function tierBadge(t)   { return `<span class="tier-badge tier-${t}">${t}</span>`; }

function confidenceBadge(c) {
  const map = { high: 'badge-qualified', medium: 'badge-contacted', low: 'badge-lost' };
  return `<span class="badge ${map[c]||'badge-new'}">${c}</span>`;
}

function getScoreLabelClient(score) {
  if (score >= 90) return 'Hot';
  if (score >= 70) return 'Warm';
  if (score >= 40) return 'Mild';
  return 'Cold';
}

export {
  esc, scoreColor, scoreBar, badgeStatus, tierBadge, confidenceBadge,
  getScoreLabelClient,
};
