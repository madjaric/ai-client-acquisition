/* ═══════════════════════════════════════════════════════════════
   modules/leads.js — leads table, CRUD UI, filtering, AI scoring,
      lead-intelligence panel
   ═══════════════════════════════════════════════════════════════ */

import { state } from '../core/state.js';
import { navigate } from '../app.js';
import { apiFetch } from '../core/api.js';
import { loadPipelineAnalytics } from './analytics.js';
import { quickOutreach } from './outreach.js';
import { generateWebsiteForLead } from './website.js';
import { setBtn, toast } from '../utils/dom.js';
import { badgeStatus, esc, getScoreLabelClient, scoreBar, scoreColor, tierBadge } from '../utils/formatters.js';

async function loadLeads() {
  const d = await apiFetch('GET', '/api/leads?limit=200');
  state.allLeads = d.data || [];
  renderLeads(state.allLeads);
  updateStats(state.allLeads);
  refreshSelects();
  const badge = document.getElementById('sb-leads-count');
  if (badge) badge.textContent = state.allLeads.length || '—';
  loadPipelineAnalytics();
  // Restore preview state from lead notes on every page load
  window._leadPreviewReady = window._leadPreviewReady || {};
  window._leadPreviewUrls  = window._leadPreviewUrls  || {};
  state.allLeads.forEach(l => {
    const notes = l.notes || '';
    if (notes.includes('[WEBSITE_PREVIEW_GENERATED]')) {
      window._leadPreviewReady[l.id] = true;
    }
    const m = notes.match(/\[PREVIEW_URL:([^\]]+)\]/);
    if (m) window._leadPreviewUrls[l.id] = m[1];
  });
}

function updateStats(leads) {
  document.getElementById('stat-total').textContent     = leads.length;
  document.getElementById('stat-new').textContent       = leads.filter(l => l.status === 'new').length;
  document.getElementById('stat-active').textContent    = leads.filter(l => ['contacted','qualified'].includes(l.status)).length;
  document.getElementById('stat-converted').textContent = leads.filter(l => l.status === 'converted').length;

  // Contact coverage counters
  const withEmail   = leads.filter(l => l.email   && l.email.trim()).length;
  const withPhone   = leads.filter(l => l.phone   && l.phone.trim()).length;
  const withWebsite = leads.filter(l => l.website && l.website.trim()).length;
  const emailEl   = document.getElementById('cc-email-count');
  const phoneEl   = document.getElementById('cc-phone-count');
  const websiteEl = document.getElementById('cc-website-count');
  if (emailEl)   emailEl.textContent   = withEmail;
  if (phoneEl)   phoneEl.textContent   = withPhone;
  if (websiteEl) websiteEl.textContent = withWebsite;
}

function renderLeads(list) {
  const el = document.getElementById('leads-list');
  if (!list.length) {
    el.innerHTML = `<div class="empty">
      <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
      <div class="empty-title">No leads found</div>
      <div class="empty-desc">Add one using the form, or import from Discovery.</div>
      <button class="btn btn-brand btn-sm" onclick="navigate('discovery')">Find leads →</button>
    </div>`;
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th>Business</th>
      <th>Contact</th>
      <th>Industry</th>
      <th>Location</th>
      <th>Status</th>
      <th>Score</th>
      <th></th>
    </tr></thead>
    <tbody>${list.map(l => {
      const hasEmail   = !!(l.email   && l.email.trim());
      const hasPhone   = !!(l.phone   && l.phone.trim());
      const hasWebsite = !!(l.website && l.website.trim());
      const hasAll     = hasEmail && hasPhone;

      // Contact cell
      const contactCell = `
        <div style="display:flex;flex-direction:column;gap:3px;min-width:160px">
          ${hasPhone
            ? `<a href="tel:${esc(l.phone_normalized||l.phone)}" style="display:inline-flex;align-items:center;gap:5px;font-family:var(--fm);font-size:11px;color:var(--brand);text-decoration:none" title="${esc(l.phone)}">
                <span style="font-size:10px">📞</span>${esc(l.phone)}
               </a>`
            : `<span style="font-family:var(--fm);font-size:10px;color:var(--text-3)">📞 —</span>`}
          ${hasEmail
            ? `<a href="mailto:${esc(l.email)}" style="display:inline-flex;align-items:center;gap:5px;font-family:var(--fm);font-size:11px;color:#60a5fa;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px" title="${esc(l.email)}">
                <span style="font-size:10px">✉</span>${esc(l.email)}
                ${l.email_source ? `<span style="font-family:var(--fm);font-size:8px;background:var(--blue-dim);border:1px solid var(--blue-mid);color:var(--blue);padding:1px 4px;border-radius:2px;flex-shrink:0">${esc(l.email_source)}</span>` : ''}
               </a>`
            : `<span style="display:inline-flex;align-items:center;gap:5px;font-family:var(--fm);font-size:10px;color:var(--text-3)">✉ —
                <button onclick="promptLeadEmail('${l.id}')" style="font-family:var(--fm);font-size:9px;background:var(--blue-dim);border:1px solid var(--blue-mid);color:var(--blue);padding:1px 6px;border-radius:3px;cursor:pointer">+ Add</button>
               </span>`}
          ${hasWebsite
            ? `<a href="${esc(l.website)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:5px;font-family:var(--fm);font-size:10px;color:var(--text-3);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px" title="${esc(l.website)}">
                <span style="font-size:10px">🌐</span>${esc(l.website.replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,'').slice(0,26))}
               </a>`
            : `<span style="font-family:var(--fm);font-size:10px;color:var(--text-3)">🌐 —</span>`}
        </div>`;

      return `
      <tr style="${hasAll ? 'background:rgba(34,197,94,.03);' : ''}">
        <td>
          <strong style="font-size:13px;cursor:pointer;color:var(--text)" onclick="openLeadIntelligence('${l.id}')" title="Open intelligence panel">${esc(l.business_name||l.name)}</strong>
          ${l.rating ? `<div style="font-family:var(--fm);font-size:10px;color:var(--amber);margin-top:2px">★ ${l.rating}${l.review_count ? ` · ${l.review_count} reviews` : ''}</div>` : ''}
          ${!hasWebsite ? `<span style="font-family:var(--fm);font-size:9px;color:var(--amber);background:var(--amber-dim);padding:1px 5px;border-radius:3px;display:inline-block;margin-top:2px">No website</span>` : ''}
        </td>
        <td>${contactCell}</td>
        <td style="color:var(--text-2)">${esc(l.industry||'—')}</td>
        <td style="color:var(--text-2);font-size:12px">${esc(l.location||'—')}</td>
        <td>${badgeStatus(l.status)}</td>
        <td>${l.score ? scoreBar(l.score) : `<span style="color:var(--text-3);font-family:var(--fm);font-size:11px">—</span>`}</td>
        <td>
          <div style="display:flex;gap:4px;align-items:center;flex-wrap:nowrap">
            <button onclick="openLeadIntelligence('${l.id}')" title="Lead Intelligence"
              style="padding:3px 8px;font-size:10px;font-family:var(--fm);font-weight:700;border-radius:var(--radius);border:1.5px solid var(--blue-mid);background:var(--blue-dim);color:#60a5fa;cursor:pointer;white-space:nowrap;line-height:1.4">ⓘ Intel</button>
            <button class="btn btn-amber btn-xs" onclick="quickScore('${l.id}')">Score</button>
            <button class="btn btn-blue btn-xs" onclick="quickOutreach('${l.id}')">Outreach</button>
            ${(!l.website || !l.website.trim()) ? `<button onclick="generateWebsiteForLead('${l.id}','${esc(l.business_name||l.name)}','${esc(l.industry||'')}','${esc(l.location||'')}')" title="Generate website"
              style="padding:3px 8px;font-size:10px;font-family:var(--fm);font-weight:700;border-radius:var(--radius);border:1.5px solid var(--amber-mid);background:var(--amber-dim);color:var(--amber);cursor:pointer;white-space:nowrap;line-height:1.4">⚡ Site</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('')}
    </tbody>
  </table></div>`;
}

function filterLeads() {
  const q       = document.getElementById('lead-search').value.toLowerCase();
  const contact = document.getElementById('contact-filter')?.value || '';

  let filtered = state.allLeads;

  if (q) {
    filtered = filtered.filter(l =>
      (l.business_name||l.name||'').toLowerCase().includes(q) ||
      (l.industry||'').toLowerCase().includes(q) ||
      (l.location||'').toLowerCase().includes(q) ||
      (l.email||'').toLowerCase().includes(q) ||
      (l.phone||'').toLowerCase().includes(q)
    );
  }

  if (contact === 'email')   filtered = filtered.filter(l => l.email   && l.email.trim());
  if (contact === 'phone')   filtered = filtered.filter(l => l.phone   && l.phone.trim());
  if (contact === 'website') filtered = filtered.filter(l => l.website && l.website.trim());
  if (contact === 'none')    filtered = filtered.filter(l =>
    !(l.email && l.email.trim()) && !(l.phone && l.phone.trim()) && !(l.website && l.website.trim())
  );

  renderLeads(filtered);
}

/** Set contact filter from badge click and re-filter */

function setContactFilter(value) {
  const sel = document.getElementById('contact-filter');
  if (!sel) return;
  // Toggle: clicking active filter clears it
  sel.value = (sel.value === value) ? '' : value;
  filterLeads();
}

/**
 * promptLeadEmail(leadId)
 * Inline prompt to add/edit an email address on a lead directly from the table.
 */

async function promptLeadEmail(leadId) {
  const lead = state.allLeads.find(l => String(l.id) === String(leadId));
  if (!lead) return;
  const current = lead.email || '';
  const input = window.prompt(`Email address for "${lead.business_name || lead.name}":`, current);
  if (input === null) return; // cancelled
  const email = input.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast('Please enter a valid email address.', 'error'); return;
  }
  const d = await apiFetch('PATCH', `/api/leads/${leadId}`, { email: email || null });
  if (d.success) {
    toast(email ? `Email saved for ${lead.business_name||lead.name}.` : 'Email removed.', 'success');
    loadLeads();
  } else {
    toast(d.message || 'Failed to save email.', 'error');
  }
}

async function addLead() {
  const name     = document.getElementById('f-name').value.trim();
  const industry = document.getElementById('f-industry').value.trim();
  const location = document.getElementById('f-location').value.trim();
  const website  = document.getElementById('f-website').value.trim();
  const email    = document.getElementById('f-email')?.value.trim() || '';
  const notes    = document.getElementById('f-notes').value.trim();

  if (!name || !industry || !location) {
    toast('Business name, industry, and location are required.', 'error'); return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast('Please enter a valid email address.', 'error'); return;
  }

  setBtn('btn-add-lead', true, 'Adding…');
  const d = await apiFetch('POST', '/api/leads', {
    business_name: name, industry, location,
    website: website || undefined,
    email:   email   || undefined,
    notes:   notes   || undefined,
  });
  setBtn('btn-add-lead', false, '+ Add Lead');

  if (d.success) {
    toast(`"${name}" added to pipeline.`, 'success');
    clearForm(); loadLeads();
    // Mark onboarding step 1 done (leads imported)
    const s1 = document.getElementById('obs-1');
    if (s1) s1.classList.add('done');
  } else {
    const errMsg = d.errors ? Object.values(d.errors).flat().join(' · ') : d.message || 'Failed to add lead.';
    toast(errMsg, 'error');
  }
}

function clearForm() {
  ['f-name','f-industry','f-location','f-website','f-email','f-notes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
}

function refreshSelects() {
  const opts = '<option value="">— choose a lead —</option>' +
    state.allLeads.map(l => `<option value="${l.id}">${esc(l.business_name||l.name)} · ${esc(l.location||'')}${l.score ? ` · ${l.score}/10` : ''}</option>`).join('');
  ['score-select','out-select'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { const v = el.value; el.innerHTML = opts; el.value = v; }
  });
}

/* ─── Scoring ────────────────────────────────── */

async function scoreLead() {
  const leadId = document.getElementById('score-select').value;
  if (!leadId) { toast('Select a lead first.', 'error'); return; }

  setBtn('btn-score', true, 'Analyzing…');
  const d = await apiFetch('POST', '/api/score-lead', { lead_id: leadId });
  setBtn('btn-score', false, `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8L12 15l-5 3.4 1.9-5.8L4 9h6.1z"/></svg> Run AI Score`);

  if (!d.success) { toast(d.message || 'Scoring failed.', 'error'); return; }

  const s = d.data.score;
  state.lastScoredId = leadId;
  renderScoreResult(s);
  loadLeads(); loadScoredLeads();
  toast(`Scored: Tier ${s.tier} · ${s.lead_score}/10`, 'success');

  // Mark onboarding step 2 done
  const s2 = document.getElementById('obs-2');
  if (s2) s2.classList.add('done');
}

function renderScoreResult(s) {
  const panel = document.getElementById('score-result');
  panel.classList.add('visible');

  const score100 = s.score !== undefined ? s.score : (s.lead_score ? s.lead_score * 10 : 0);
  const score10  = s.lead_score || Math.round(score100 / 10);
  const label    = s.score_label || (score100 >= 80 ? 'Hot' : score100 >= 60 ? 'Warm' : score100 >= 40 ? 'Mild' : 'Cold');
  const col      = score100 >= 80 ? 'var(--red)' : score100 >= 60 ? 'var(--amber)' : score100 >= 40 ? '#60a5fa' : 'var(--text-3)';

  const setEl  = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const showEl = (id, show) => { const el = document.getElementById(id); if (el) el.style.display = show ? '' : 'none'; };

  document.getElementById('res-score-num').textContent = score100 || score10;
  document.getElementById('res-score-num').style.color = col;
  const labelEl = document.getElementById('res-score-label');
  if (labelEl) { labelEl.textContent = label; labelEl.style.color = col; }
  document.getElementById('res-tier').innerHTML = tierBadge(s.tier);
  setEl('res-value', s.estimated_value_range || '—');

  // Revenue potential
  const potEl = document.getElementById('res-revenue-potential');
  if (potEl) {
    potEl.textContent = s.revenue_potential || '—';
    potEl.style.color = s.revenue_potential === 'High' ? 'var(--brand)' : s.revenue_potential === 'Medium' ? 'var(--amber)' : 'var(--text-3)';
  }
  setEl('res-revenue-reason', s.revenue_potential_reason || '');

  // Opportunity summary
  setEl('res-reasoning', s.opportunity_summary || s.reasoning || '—');

  // Digital Presence Audit
  const auditEl = document.getElementById('res-audit');
  if (auditEl) {
    const audit = s.digital_presence_audit || [];
    if (audit.length) {
      auditEl.innerHTML = audit.map(line => {
        const isGood = line.startsWith('✅'), isBad = line.startsWith('❌');
        const color  = isGood ? 'var(--brand)' : isBad ? 'var(--red)' : 'var(--text-3)';
        return `<div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12.5px;line-height:1.4">
          <span style="color:${color};flex-shrink:0">${line.slice(0,2)}</span>
          <span style="color:var(--text-2)">${esc(line.slice(2).trim())}</span>
        </div>`;
      }).join('');
    } else {
      auditEl.innerHTML = '<div style="font-size:12px;color:var(--text-3)">No audit data available.</div>';
    }
  }

  // Website Opportunity
  const woEl = document.getElementById('res-website-opportunity');
  if (woEl && s.website_opportunity) { woEl.textContent = s.website_opportunity; showEl('res-wo-wrap', true); }
  else { showEl('res-wo-wrap', false); }

  // Outreach Angle
  const angleEl = document.getElementById('res-outreach-angle');
  if (angleEl && s.outreach_angle) { angleEl.textContent = '"' + s.outreach_angle + '"'; showEl('res-angle-wrap', true); }
  else { showEl('res-angle-wrap', false); }

  // AI Outreach Message
  const msgEl = document.getElementById('res-outreach-message');
  if (msgEl && s.outreach_message) { msgEl.textContent = s.outreach_message; showEl('res-msg-wrap', true); }
  else { showEl('res-msg-wrap', false); }

  // Red Flags
  const flags = Array.isArray(s.red_flags) ? s.red_flags
    : (typeof s.red_flags === 'string' ? (() => { try { return JSON.parse(s.red_flags); } catch { return []; } })() : []);
  const flagWrap = document.getElementById('res-red-flags-wrap');
  if (flagWrap) {
    if (flags.length) {
      document.getElementById('res-red-flags').innerHTML = flags.map(f => `<span class="red-flag">⚠ ${esc(f)}</span>`).join('');
    } else {
      flagWrap.innerHTML = `<div class="section-title">Red Flags</div><span style="font-size:12px;color:var(--brand)">✓ None identified</span>`;
    }
  }

  setEl('res-action', s.recommended_action || '—');

  // ⚡ CTA for no-website leads
  const lead = state.allLeads.find(l => l.id === state.lastScoredId);
  const hasWebsite = !!(lead?.website && lead.website.trim());
  const ctaBlock = document.getElementById('res-wo-cta');
  if (ctaBlock) {
    ctaBlock.style.display = hasWebsite ? 'none' : '';
    if (!hasWebsite && lead) {
      ctaBlock.dataset.leadId   = lead.id;
      ctaBlock.dataset.leadName = lead.business_name || lead.name || '';
      ctaBlock.dataset.industry = lead.industry || '';
      ctaBlock.dataset.location = lead.location || '';
    }
    showEl('res-preview-ready', false);
    showEl('res-btn-gen-outreach', false);
    window._scoredLeadPreviewHtml = null;
  }
}

async function loadScoredLeads() {
  const tier = document.getElementById('tier-filter')?.value || '';
  const url  = '/api/score-lead/ranked?limit=100' + (tier ? `&tier=${tier}` : '');
  const d    = await apiFetch('GET', url);
  const list = d.data || [];

  const tbody = document.getElementById('scored-tbody');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty">
      <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8L12 15l-5 3.4 1.9-5.8L4 9h6.1z"/></svg></div>
      <div class="empty-title">No scored leads yet</div>
      <div class="empty-desc">Select a lead and run AI Score to see results here.</div>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(s => `
    <tr style="cursor:pointer" onclick="showScoredDetail('${s.score_id||s.id}')">
      <td><strong>${esc(s.business_name)}</strong><div style="font-size:11px;color:var(--text-3)">${esc(s.industry||'')} · ${esc(s.location||'')}</div></td>
      <td>${tierBadge(s.tier)}</td>
      <td>${scoreBar(s.lead_score)}</td>
      <td style="font-family:var(--fm);font-size:11px;color:var(--brand);font-weight:600">${esc(s.estimated_value_range)}</td>
    </tr>`).join('');
}

async function showScoredDetail(scoreId) {
  const d = await apiFetch('GET', `/api/score-lead/${scoreId}`);
  if (!d.success) return;
  renderScoreResult(d.data);
  document.getElementById('score-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function quickScore(leadId) {
  navigate('scoring');
  setTimeout(() => { const sel = document.getElementById('score-select'); if (sel) sel.value = leadId; scoreLead(); }, 100);
}

/* ─── Outreach ───────────────────────────────── */

let _currentLiLeadId = null;

function openLeadIntelligence(leadId) {
  if (!leadId) return;
  _currentLiLeadId = leadId;
  document.getElementById('li-overlay').classList.add('open');
  document.getElementById('li-panel').classList.add('open');
  document.body.style.overflow = 'hidden';
  loadLeadIntelligence(leadId);
}

function closeLeadIntelligence() {
  document.getElementById('li-overlay').classList.remove('open');
  document.getElementById('li-panel').classList.remove('open');
  document.body.style.overflow = '';
  _currentLiLeadId = null;
}

async function loadLeadIntelligence(leadId) {
  const body = document.getElementById('li-panel-body');
  body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:60px 0;color:var(--text-3)">
    <span class="spinner"></span>&nbsp;Loading intelligence…
  </div>`;

  const d = await apiFetch('GET', '/api/lead-intelligence/' + leadId);
  if (!d.success) {
    body.innerHTML = `<div class="empty" style="padding:40px 0"><div class="empty-title">Error</div><div class="empty-desc">${esc(d.message || 'Failed to load.')}</div></div>`;
    return;
  }

  const { lead, score, latest_message, revenue_projection, has_website } = d.data;

  document.getElementById('li-panel-title').textContent = lead.business_name || 'Lead Intelligence';

  // ── Score color & label ───────────────────────────────────────────────
  const scoreVal = score ? (score.score !== undefined ? score.score : (score.lead_score ? score.lead_score * 10 : 0)) : 0;
  const scoreLabel = score ? (score.score_label || getScoreLabelClient(scoreVal)) : 'Unscored';
  const scoreColor = scoreVal >= 90 ? 'var(--red)' : scoreVal >= 70 ? 'var(--amber)' : scoreVal >= 40 ? '#60a5fa' : 'var(--text-3)';

  // ── Score breakdown bars ──────────────────────────────────────────────
  const breakdown = score?.score_breakdown || {};
  const breakdownHtml = Object.entries(breakdown).length ? `
    <div class="li-section-title">Score Breakdown</div>
    <div class="li-breakdown-bar">
      ${Object.entries(breakdown).map(([k, v]) => {
        const label = k.replace(/_/g, ' ');
        const maxVal = 20;
        const pct = Math.min(100, Math.round((Number(v) / maxVal) * 100));
        return `<div class="li-bar-row">
          <div class="li-bar-lbl">${esc(label)}</div>
          <div class="li-bar-track"><div class="li-bar-fill" style="width:${pct}%"></div></div>
          <div class="li-bar-val">${v}</div>
        </div>`;
      }).join('')}
    </div>` : '';

  // ── Website Opportunity Block ─────────────────────────────────────────
  const woHtml = (!has_website && score) ? `
    <div style="background:var(--amber-dim);border:1px solid var(--amber-mid);border-radius:var(--radius-lg);padding:14px">
      <div class="li-section-title" style="color:var(--amber)">⚡ Website Opportunity</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">
        ${score.website_opportunity_score != null ? `<div style="display:flex;justify-content:space-between"><span style="font-size:12px;color:var(--text-2)">Opportunity Score</span><span style="font-family:var(--fm);font-size:13px;font-weight:700;color:var(--amber)">${score.website_opportunity_score}/100</span></div>` : ''}
        ${score.website_revenue_potential  ? `<div style="display:flex;justify-content:space-between"><span style="font-size:12px;color:var(--text-2)">Revenue Potential</span><span style="font-family:var(--fm);font-size:12px;font-weight:600;color:var(--brand)">${esc(score.website_revenue_potential)}</span></div>` : ''}
        ${score.recommended_website_type   ? `<div style="display:flex;justify-content:space-between"><span style="font-size:12px;color:var(--text-2)">Recommended Site</span><span style="font-size:12px;color:var(--text)">${esc(score.recommended_website_type)}</span></div>` : ''}
        ${score.recommended_pages          ? `<div style="display:flex;justify-content:space-between"><span style="font-size:12px;color:var(--text-2)">Pages</span><span style="font-family:var(--fm);font-size:12px;color:var(--text)">${score.recommended_pages}</span></div>` : ''}
        ${score.recommended_cta            ? `<div style="display:flex;justify-content:space-between"><span style="font-size:12px;color:var(--text-2)">Primary CTA</span><span style="font-size:12px;color:var(--text)">${esc(score.recommended_cta)}</span></div>` : ''}
        ${score.recommended_conversion_strategy ? `<div style="margin-top:4px;font-size:12px;color:var(--text-2);line-height:1.5">${esc(score.recommended_conversion_strategy)}</div>` : ''}
      </div>
      <button class="btn btn-amber btn-sm" style="margin-top:12px;width:100%" onclick="closeLeadIntelligence();navigate('wopp')">
        ⚡ Generate Website for this Lead →
      </button>
    </div>` : '';

  // ── Email preview ─────────────────────────────────────────────────────
  const emailHtml = latest_message ? `
    <div>
      <div class="li-section-title">Personalized Email Preview</div>
      <div style="margin-bottom:8px">
        <div style="font-family:var(--fm);font-size:10px;color:var(--text-3);margin-bottom:4px">SUBJECT</div>
        <div style="font-size:13px;font-weight:600;color:var(--blue)">${esc(latest_message.subject_line || '—')}</div>
      </div>
      <div class="li-followup-tab" id="li-tab-group">
        <button class="active" onclick="liShowEmail('main', this)">Email</button>
        <button onclick="liShowEmail('day3', this)">Day 3</button>
        <button onclick="liShowEmail('day7', this)">Day 7</button>
        <button onclick="liShowEmail('day14', this)">Day 14</button>
      </div>
      <div class="li-email-preview" id="li-email-main">${esc(latest_message.email_body || '—')}</div>
      <div class="li-email-preview" id="li-email-day3" style="display:none">${esc(latest_message.follow_up_day3 || 'No Day 3 follow-up. Regenerate outreach to get full sequence.')}</div>
      <div class="li-email-preview" id="li-email-day7" style="display:none">${esc(latest_message.follow_up_day7 || 'No Day 7 follow-up. Regenerate outreach to get full sequence.')}</div>
      <div class="li-email-preview" id="li-email-day14" style="display:none">${esc(latest_message.follow_up_day14 || 'No Day 14 follow-up. Regenerate outreach to get full sequence.')}</div>
      <button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="copyLiEmail()">Copy Email</button>
    </div>` : `
    <div>
      <div class="li-section-title">Personalized Email Preview</div>
      <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);padding:16px;text-align:center">
        <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">No outreach generated yet</div>
        <button class="btn btn-brand btn-sm" onclick="closeLeadIntelligence();quickOutreach('${lead.id}')">Generate Outreach →</button>
      </div>
    </div>`;

  // ── Red flags ─────────────────────────────────────────────────────────
  const flags = score?.red_flags || [];
  const flagsHtml = flags.length ? `
    <div>
      <div class="li-section-title">⚠ Red Flags</div>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${flags.map(f => `<div style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--text-2);background:var(--red-dim);border:1px solid var(--red-mid);border-radius:var(--radius);padding:7px 10px"><span style="color:var(--red);flex-shrink:0">⚠</span>${esc(f)}</div>`).join('')}
      </div>
    </div>` : '';

  // ── Revenue projection ────────────────────────────────────────────────
  const revHtml = revenue_projection ? `
    <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);padding:12px">
      <div class="li-section-title">Revenue Potential</div>
      <div style="display:flex;justify-content:space-between;margin-top:6px">
        <span style="font-size:12px;color:var(--text-2)">Est. Value Range</span>
        <span style="font-family:var(--fm);font-size:12px;font-weight:600;color:var(--brand)">${esc(revenue_projection.estimated_value_range || '—')}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px">
        <span style="font-size:12px;color:var(--text-2)">Conversion Probability</span>
        <span style="font-family:var(--fm);font-size:12px;font-weight:600;color:var(--amber)">${esc(revenue_projection.conversion_probability || '—')}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px">
        <span style="font-size:12px;color:var(--text-2)">Model Used</span>
        <span style="font-family:var(--fm);font-size:11px;color:var(--text-3)">Model ${esc(revenue_projection.model_used || '?')} — ${revenue_projection.model_used === 'B' ? 'Website Opp.' : 'Lead Gen'}</span>
      </div>
    </div>` : '';

  // ── Recommended action ────────────────────────────────────────────────
  const actionHtml = score?.recommended_action ? `
    <div style="background:var(--brand-dim);border:1px solid var(--brand-mid);border-radius:var(--radius);padding:12px">
      <div class="li-section-title" style="color:var(--brand)">Recommended Next Action</div>
      <div style="font-size:13px;color:var(--text);line-height:1.5;margin-top:6px">${esc(score.recommended_action)}</div>
    </div>` : '';

  // ── CTA Buttons ───────────────────────────────────────────────────────
  const ctaHtml = `
    <div style="display:flex;flex-direction:column;gap:7px;padding-bottom:8px">
      <button class="btn btn-brand" onclick="closeLeadIntelligence();quickScore('${lead.id}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8L12 15l-5 3.4 1.9-5.8L4 9h6.1z"/></svg>
        ${score ? 'Re-Score with AI' : 'Score with AI'}
      </button>
      <button class="btn btn-blue" onclick="closeLeadIntelligence();quickOutreach('${lead.id}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        ${latest_message ? 'Regenerate Outreach' : 'Generate Outreach'}
      </button>
      ${!has_website ? `<button class="btn btn-amber" onclick="closeLeadIntelligence();navigate('wopp')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
        Generate Website
      </button>` : ''}
    </div>`;

  // ── Assemble panel ────────────────────────────────────────────────────
  const modelBadge = has_website
    ? `<span style="font-family:var(--fm);font-size:9px;background:var(--blue-dim);color:var(--blue);padding:2px 7px;border-radius:3px;border:1px solid var(--blue-mid)">MODEL A · LEAD GEN</span>`
    : `<span style="font-family:var(--fm);font-size:9px;background:var(--amber-dim);color:var(--amber);padding:2px 7px;border-radius:3px;border:1px solid var(--amber-mid)">MODEL B · WEBSITE OPP</span>`;

  body.innerHTML = `
    
    <div style="display:flex;align-items:center;gap:14px;padding:14px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-lg)">
      <div class="li-score-ring" style="background:${scoreVal ? `conic-gradient(${scoreColor} ${scoreVal}%, var(--bg-3) 0)` : 'var(--bg-3)'}">
        <div style="width:56px;height:56px;border-radius:50%;background:var(--bg-1);display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div class="li-score-ring-num" style="color:${scoreColor}">${scoreVal || '—'}</div>
          <div class="li-score-sub" style="color:${scoreColor}">${scoreLabel}</div>
        </div>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--fd);font-size:15px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(lead.business_name)}</div>
        <div style="font-size:12px;color:var(--text-2);margin-top:2px">${esc(lead.industry || '—')} · ${esc(lead.location || '—')}</div>
        <div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap">
          ${modelBadge}
          ${badgeStatus(lead.status)}
        </div>
      </div>
    </div>

    ${score ? `
    
    <div>
      <div class="li-section-title">AI Score Reasoning</div>
      <div style="font-size:12.5px;color:var(--text-2);line-height:1.65;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);padding:12px">${esc(score.reasoning || 'No reasoning available.')}</div>
    </div>
    ` : `
    <div style="background:var(--brand-dim);border:1px solid var(--brand-mid);border-radius:var(--radius);padding:12px;text-align:center">
      <div style="font-size:12px;color:var(--text-2);margin-bottom:10px">This lead hasn't been AI scored yet</div>
      <button class="btn btn-brand btn-sm" onclick="closeLeadIntelligence();quickScore('${lead.id}')">Run AI Score →</button>
    </div>`}

    ${breakdownHtml}
    ${woHtml}
    ${flagsHtml}
    ${revHtml}
    ${actionHtml}
    ${emailHtml}
    ${ctaHtml}
  `;
}

function liShowEmail(tab, btn) {
  ['main','day3','day7','day14'].forEach(t => {
    const el = document.getElementById('li-email-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('#li-tab-group button').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function copyLiEmail() {
  const activeEl = document.querySelector('.li-email-preview:not([style*="display:none"])') ||
                   document.getElementById('li-email-main');
  if (!activeEl) return;
  navigator.clipboard.writeText(activeEl.textContent).then(() => toast('Email copied!', 'success')).catch(() => toast('Copy failed.', 'error'));
}

/* Lead-intelligence keyboard shortcut — Escape closes the panel.
   (Originally a top-level document.addEventListener registered after getScoreLabelClient.) */
function initLeadIntelligence() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _currentLiLeadId) closeLeadIntelligence();
  });
}

export {
  loadLeads, updateStats, renderLeads, filterLeads, setContactFilter, promptLeadEmail,
  addLead, clearForm, refreshSelects, scoreLead, renderScoreResult, loadScoredLeads,
  showScoredDetail, quickScore, _currentLiLeadId, openLeadIntelligence, closeLeadIntelligence, loadLeadIntelligence,
  liShowEmail, copyLiEmail, initLeadIntelligence,
};
