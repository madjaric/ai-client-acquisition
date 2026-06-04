/* ═══════════════════════════════════════════════════════════════
   modules/website.js — website generator (IWG), editor (WSE),
      opportunities (WOPP) + inline woGen modal + shared HTML parse/validate
   ═══════════════════════════════════════════════════════════════ */

import { state } from '../core/state.js';
import { navigate } from '../app.js';
import { apiFetch } from '../core/api.js';
import { loadOutreachHistory } from './outreach.js';
import { toast } from '../utils/dom.js';
import { esc } from '../utils/formatters.js';

function parseGeneratedHtml(data) {
  if (!data) throw new Error('No response data from server');
  console.log('[parse] keys:', Object.keys(data).join(', '));

  if (data.html) return data.html;
  if (data.error) throw new Error(data.error.message || 'Server error');

  if (!data.content || !data.content.length)
    throw new Error('Response missing content array');

  const rawText = data.content.filter(c => c.type === 'text').map(c => c.text || '').join('');
  console.log('[parse] rawText length:', rawText.length);
  if (!rawText) throw new Error('Response content is empty');

  // Try JSON parse (server returns JSON envelope)
  const parsed = tryParseJson(rawText);
  if (parsed) {
    if (parsed.generated_html) return parsed.generated_html;
    if (parsed.html)           return parsed.html;
  }

  // Try extracting raw HTML from text
  const extracted = extractHtmlFromText(rawText);
  if (extracted) return extracted;

  console.warn('[parse] Unknown shape, returning raw');
  return rawText.trim();
}

function tryParseJson(text) {
  try { return JSON.parse(text.trim()); } catch(_) {}
  const stripped = text.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
  try { return JSON.parse(stripped); } catch(_) {}
  const brace = text.indexOf('{');
  if (brace !== -1) { try { return JSON.parse(text.slice(brace)); } catch(_) {} }
  return null;
}

function extractHtmlFromText(text) {
  if (!text) return null;
  const fenced = text.match(/```html\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const gfenced = text.match(/```\s*([\s\S]*?)```/);
  if (gfenced && /<!doctype|<html/i.test(gfenced[1])) return gfenced[1].trim();
  const trimmed = text.trim();
  if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return trimmed;
  const dt = text.search(/<!doctype\s+html/i);
  if (dt !== -1) return text.slice(dt).trim();
  const ht = text.search(/<html[\s>]/i);
  if (ht !== -1) return text.slice(ht).trim();
  return null;
}

function validateGeneratedHtml(html) {
  if (!html)                    return 'HTML is empty';
  if (html.length < 1000)       return `HTML too short (${html.length} chars)`;
  if (!/<!doctype|<html/i.test(html)) return 'HTML missing <html> or DOCTYPE';
  if (!/<\/html>/i.test(html))  return 'HTML missing </html>';
  if (!/<\/body>/i.test(html))  return 'HTML missing </body>';
  return null;
}

function iwgShowState(name) {
  ['idle','loading','result'].forEach(s => {
    const el = document.getElementById(`iwg-state-${s}`);
    if (el) el.style.display = s === name ? '' : 'none';
  });
  // Auto-register opportunity when website is generated
  if (name === 'result') {
    setTimeout(() => {
      if (state.iwgCurrentBiz && state.iwgGeneratedHtml && typeof woppOnGenerated === 'function') {
        woppOnGenerated(state.iwgCurrentBiz, state.iwgGeneratedHtml);
      }
    }, 600);
    // If editing/generating in WOPP context, persist the HTML back to the opportunity
    if (state.iwgWoppContextId && state.iwgGeneratedHtml) {
      wsePersistToWopp(state.iwgGeneratedHtml);
    }
  }
}

/* Called from the ⚡ Site button in discovery table rows */

function iwgTrigger(idx) {
  const b = state.discFiltered[idx];
  if (!b) return;
  if (b.website) { toast('This business already has a website.', 'info'); return; }

  state.iwgCurrentBiz    = b;
  state.iwgWoppContextId    = null; // Discovery context — not a WOPP opportunity
  state.iwgGeneratedHtml    = null;
  state.iwgEditable         = null;
  state.iwgOriginalHtml     = null;
  state.iwgOrigEditable     = null;
  state.iwgTrueOriginalHtml = null;
  state.iwgTrueOrigEditable = null;
  state.iwgDirty            = false;

  // Populate header
  document.getElementById('iwg-biz-name').textContent     = b.name     || 'Business';
  document.getElementById('iwg-biz-industry').textContent = b.industry || '—';
  document.getElementById('iwg-biz-location').textContent = b.location || '—';

  const ratingEl  = document.getElementById('iwg-biz-rating');
  const ratingDot = document.getElementById('iwg-meta-dot-rating');
  if (b.rating) {
    ratingEl.textContent        = `★ ${b.rating.toFixed(1)}${b.review_count ? ` (${b.review_count.toLocaleString()} reviews)` : ''}`;
    ratingEl.style.display      = '';
    ratingDot.style.display     = '';
  } else {
    ratingEl.style.display      = 'none';
    ratingDot.style.display     = 'none';
  }

  document.getElementById('iwg-header-sub').textContent =
    `Generating a landing page for ${b.name}`;

  // Show regen btn only if we already have a result
  document.getElementById('iwg-btn-regen').style.display = 'none';

  // Switch to idle state, show the anchor
  iwgShowState('idle');
  iwgTab('preview');

  const anchor = document.getElementById('iwg-anchor');
  anchor.style.display = 'flex';
  setTimeout(() => anchor.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}

function iwgClose() {
  document.getElementById('iwg-anchor').style.display = 'none';
  state.iwgCurrentBiz       = null;
  state.iwgWoppContextId    = null;
  state.iwgGeneratedHtml    = null;
  state.iwgEditable         = null;
  state.iwgOriginalHtml     = null;
  state.iwgOrigEditable     = null;
  state.iwgTrueOriginalHtml = null;
  state.iwgTrueOrigEditable = null;
  clearInterval(state.iwgLoadInterval);
}

async function iwgGenerate() {
  if (!state.iwgCurrentBiz) return;
  const b   = state.iwgCurrentBiz;
  const t0  = performance.now();

  iwgShowState('loading');
  document.getElementById('iwg-btn-gen').disabled = true;

  state.iwgLoadPct = 0;
  let stepIdx = 0;
  const barEl  = document.getElementById('iwg-loading-bar');
  const stepEl = document.getElementById('iwg-loading-step');
  clearInterval(state.iwgLoadInterval);
  state.iwgLoadInterval = setInterval(() => {
    state.iwgLoadPct = Math.min(state.iwgLoadPct + (100 / (state.IWG_STEPS.length * 2.5)), 92);
    if (barEl) barEl.style.width = state.iwgLoadPct + '%';
    if (stepEl && stepIdx < state.IWG_STEPS.length) stepEl.textContent = state.IWG_STEPS[stepIdx++];
  }, 800);

  const prompt = [
    `Business Name: ${b.name}`,
    `Industry: ${b.industry || 'General'}`,
    `Location: ${b.location || ''}`,
    b.phone       ? `Phone: ${b.phone}` : null,
    b.rating      ? `Rating: ${b.rating}/5 (${b.review_count || 0} reviews)` : null,
    b.description ? `Description: ${b.description}` : null,
    Array.isArray(b.services) && b.services.length
      ? `Services: ${b.services.slice(0,8).join(', ')}` : null,
  ].filter(Boolean).join('\n');

  console.log('[IWG] Generating for:', b.name, '| prompt:', prompt.length, 'chars');

  try {
    const t1  = performance.now();
    const res = await fetch('/api/generate-website', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ messages: [{ role: 'user', content: prompt }], industry: b.industry || '' })
    });
    console.log('[IWG] Fetch done in', Math.round(performance.now()-t1), 'ms — HTTP', res.status);

    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);

    const html = parseGeneratedHtml(data);
    console.log('[IWG] HTML length:', html ? html.length : 0);

    const validErr = validateGeneratedHtml(html);
    if (validErr) throw new Error(validErr);

    console.log('[IWG] Total:', Math.round(performance.now()-t0), 'ms');

    clearInterval(state.iwgLoadInterval);
    if (barEl) barEl.style.width = '100%';
    await new Promise(r => setTimeout(r, 200));

    const emptyEditable = { hero_title:'', hero_subtitle:'', call_to_action:'', about_title:'',
      about_text:'', services_title:'', services_list:[], contact_title:'', contact_instructions:'' };

    state.iwgGeneratedHtml    = html;
    state.iwgEditable         = JSON.parse(JSON.stringify(emptyEditable));
    state.iwgOriginalHtml     = html;
    state.iwgOrigEditable     = JSON.parse(JSON.stringify(emptyEditable));
    state.iwgTrueOriginalHtml = html;
    state.iwgTrueOrigEditable = JSON.parse(JSON.stringify(emptyEditable));
    state.iwgDirty            = false;

    const iframe = document.getElementById('iwg-iframe');
    if (iframe) iframe.srcdoc = html;

    const urlEl = document.getElementById('iwg-chrome-url-text');
    if (urlEl) urlEl.textContent = (b.name||'website').toLowerCase().replace(/[^a-z0-9]+/g,'-') + '.html';

    iwgPopulateEditFields();
    iwgShowState('result');
    document.getElementById('iwg-btn-regen').style.display = '';
    document.getElementById('iwg-btn-gen').disabled = false;
    toast('Website generated!', 'success');
    iwgTab('preview');

  } catch(e) {
    console.error('[IWG] Failed:', e);
    clearInterval(state.iwgLoadInterval);
    iwgShowState('idle');
    document.getElementById('iwg-btn-gen').disabled = false;
    toast('Generation failed: ' + e.message, 'error');
  }
}

function iwgRegen() {
  // Clear all generated state so the next generate() call starts fresh
  state.iwgGeneratedHtml    = null;
  state.iwgEditable         = null;
  state.iwgOriginalHtml     = null;
  state.iwgOrigEditable     = null;
  state.iwgTrueOriginalHtml = null;
  state.iwgTrueOrigEditable = null;
  state.iwgDirty            = false;
  iwgShowState('idle');
  document.getElementById('iwg-btn-regen').style.display = 'none';
}

function iwgPopulateEditFields() {
  const ec = state.iwgEditable;
  if (!ec) return;
  document.getElementById('iwge-hero-title').value           = ec.hero_title            || '';
  document.getElementById('iwge-hero-subtitle').value        = ec.hero_subtitle         || '';
  document.getElementById('iwge-cta').value                  = ec.call_to_action        || '';
  document.getElementById('iwge-about-title').value          = ec.about_title           || '';
  document.getElementById('iwge-about-text').value           = ec.about_text            || '';
  document.getElementById('iwge-services-title').value       = ec.services_title        || '';
  document.getElementById('iwge-contact-title').value        = ec.contact_title         || '';
  document.getElementById('iwge-contact-instructions').value = ec.contact_instructions  || '';
  iwgRenderEditServices();
  document.getElementById('iwg-btn-reset-edits').style.display = 'none';
  state.iwgDirty = false;
}

function iwgRenderEditServices() {
  const el = document.getElementById('iwge-services-list');
  if (!el || !state.iwgEditable) return;
  const list = state.iwgEditable.services_list || [];
  el.innerHTML = list.map((s, i) => `
    <div class="iwg-service-row">
      <div class="iwg-field">
        ${i === 0 ? '<label>Name</label>' : ''}
        <input oninput="state.iwgEditable.services_list[${i}].name=this.value;iwgMarkDirty()"
          value="${esc(s.name)}" placeholder="Service name" />
      </div>
      <div class="iwg-field">
        ${i === 0 ? '<label>Description</label>' : ''}
        <input oninput="state.iwgEditable.services_list[${i}].description=this.value;iwgMarkDirty()"
          value="${esc(s.description)}" placeholder="Brief description" />
      </div>
      <button class="iwg-btn-remove-svc" onclick="iwgRemoveEditSvc(${i})" title="Remove">×</button>
    </div>
  `).join('');
}

function iwgAddEditService() {
  if (!state.iwgEditable) return;
  state.iwgEditable.services_list.push({ name: '', description: '' });
  iwgRenderEditServices();
  iwgMarkDirty();
}

function iwgRemoveEditSvc(i) {
  if (!state.iwgEditable) return;
  state.iwgEditable.services_list.splice(i, 1);
  iwgRenderEditServices();
  iwgMarkDirty();
}

function iwgMarkDirty() {
  state.iwgDirty = true;
  document.getElementById('iwg-btn-reset-edits').style.display = '';
}

function iwgApplyEdits() {
  if (!state.iwgEditable || !state.iwgOriginalHtml) return;

  // Sync text fields to editable object
  state.iwgEditable.hero_title           = document.getElementById('iwge-hero-title').value;
  state.iwgEditable.hero_subtitle        = document.getElementById('iwge-hero-subtitle').value;
  state.iwgEditable.call_to_action       = document.getElementById('iwge-cta').value;
  state.iwgEditable.about_title          = document.getElementById('iwge-about-title').value;
  state.iwgEditable.about_text           = document.getElementById('iwge-about-text').value;
  state.iwgEditable.services_title       = document.getElementById('iwge-services-title').value;
  state.iwgEditable.contact_title        = document.getElementById('iwge-contact-title').value;
  state.iwgEditable.contact_instructions = document.getElementById('iwge-contact-instructions').value;

  // String-replace changed values in the HTML.
  // IMPORTANT: always apply against the CURRENT generated HTML (not original),
  // so that re-edits accumulate correctly instead of reverting previous changes.
  let html = state.iwgGeneratedHtml || state.iwgOriginalHtml;
  const orig = state.iwgOrigEditable;
  const curr = state.iwgEditable;

  const pairs = [
    [orig.hero_title,           curr.hero_title],
    [orig.hero_subtitle,        curr.hero_subtitle],
    [orig.call_to_action,       curr.call_to_action],
    [orig.about_title,          curr.about_title],
    [orig.about_text,           curr.about_text],
    [orig.services_title,       curr.services_title],
    [orig.contact_title,        curr.contact_title],
    [orig.contact_instructions, curr.contact_instructions],
  ];
  for (const [from, to] of pairs) {
    if (from && to && from !== to) {
      html = html.split(from).join(to);
    }
  }
  state.iwgGeneratedHtml = html;

  // After applying, update the "original" baseline to the CURRENT editable state,
  // so the next round of edits compares against what's currently in the HTML.
  state.iwgOrigEditable  = JSON.parse(JSON.stringify(curr));
  // Also update the base HTML so future string-replaces start from the right point
  state.iwgOriginalHtml  = html;

  const iframe = document.getElementById('iwg-iframe');
  if (iframe) iframe.srcdoc = html;

  // Persist edits back to state.woppOpps if this generator is in WO context
  wsePersistToWopp(html);

  state.iwgDirty = false;
  document.getElementById('iwg-btn-reset-edits').style.display = 'none';
  iwgTab('preview');
  toast('Changes applied!', 'success');
}

function iwgResetEdits() {
  if (!state.iwgTrueOrigEditable) return;
  // Reset to the AI-generated original (before any edits)
  state.iwgEditable      = JSON.parse(JSON.stringify(state.iwgTrueOrigEditable));
  state.iwgOrigEditable  = JSON.parse(JSON.stringify(state.iwgTrueOrigEditable));
  state.iwgGeneratedHtml = state.iwgTrueOriginalHtml;
  state.iwgOriginalHtml  = state.iwgTrueOriginalHtml;
  iwgPopulateEditFields();
  const iframe = document.getElementById('iwg-iframe');
  if (iframe) iframe.srcdoc = state.iwgTrueOriginalHtml;
  // Persist reset to WOPP if in that context
  wsePersistToWopp(state.iwgTrueOriginalHtml);
  state.iwgDirty = false;
  toast('Reset to original AI-generated version.', 'info');
}

function iwgTab(name) {
  ['preview','content','export'].forEach(t => {
    const btn = document.getElementById(`iwg-tab-${t}`);
    const pnl = document.getElementById(`iwg-tc-${t}`);
    const act = t === name;
    if (btn) btn.classList.toggle('active', act);
    if (pnl) pnl.classList.toggle('active', act);
  });
}

function iwgDownload() {
  if (!state.iwgGeneratedHtml) return;
  const name = (state.iwgCurrentBiz?.name || 'website').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const blob = new Blob([state.iwgGeneratedHtml], { type: 'text/html' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = name + '.html';
  a.click();
  toast(`Downloaded ${name}.html`, 'success');
}

function iwgCopyHtml() {
  if (!state.iwgGeneratedHtml) return;
  navigator.clipboard.writeText(state.iwgGeneratedHtml).then(() => {
    const btn = document.getElementById('iwg-btn-copy');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2000);
    }
    toast('HTML copied to clipboard.', 'success');
  }).catch(() => toast('Copy failed. Try downloading instead.', 'error'));
}

/* ═══════════════════════════════════════════════════
   SHARED WEBSITE EDITOR INFRASTRUCTURE
   Used by both Discovery (IWG) and Website Opportunities (WOPP).
   Single source of truth — no duplicate editor code.
═══════════════════════════════════════════════════ */

/**
 * state.iwgWoppContextId — when the editor is opened from a WOPP opportunity,
 * this is set to the opportunity ID so edits are persisted back to state.woppOpps.
 * null = Discovery context (IWG anchor widget only).
 */

function wsePersistToWopp(html) {
  if (!state.iwgWoppContextId) return;
  const opp = state.woppOpps.find(o => o.id === state.iwgWoppContextId);
  if (!opp) return;
  opp.html   = html;
  opp.status = Math.max(opp.status, 1);
  // Persist the editable content snapshot so editor can be re-opened with correct state
  if (state.iwgEditable) opp.editableContent = JSON.parse(JSON.stringify(state.iwgEditable));
  woppSave();
  woppUpdateStats();
  woppRenderTable();
  // Refresh project modal preview if it's still open for this opp
  if (state.woppCurrentId === state.iwgWoppContextId) {
    const iframe = document.getElementById('wo-project-iframe');
    if (iframe) iframe.srcdoc = html;
    const noHtml  = document.getElementById('wo-project-nohtml');
    const preview = document.getElementById('wo-project-preview');
    if (noHtml)  noHtml.style.display  = 'none';
    if (preview) preview.style.display = '';
  }
}

/**
 * wseOpenEditorForWopp(oppId)
 * Opens the shared IWG editor (the Discovery inline widget) pre-loaded with
 * the WOPP opportunity's current HTML and editable content.
 * Works by navigating to Discovery panel, scrolling the IWG anchor into view,
 * and populating it with the opportunity's data.
 */

function wseOpenEditorForWopp(oppId) {
  const opp = state.woppOpps.find(o => o.id === oppId);
  if (!opp || !opp.html) { toast('Generate a website first.', 'error'); return; }

  // Track that we are editing in WOPP context
  state.iwgWoppContextId = oppId;

  // Populate IWG state as if the website was just generated for this biz
  state.iwgCurrentBiz    = { name: opp.name, industry: opp.industry, location: opp.location,
                        id: opp.leadId || null, phone: opp.phone || null, rating: opp.rating || null };
  state.iwgGeneratedHtml = opp.html;
  state.iwgOriginalHtml  = opp.html;
  // Build a fresh editable snapshot from the stored one, or empty defaults
  const ec = opp.editableContent || {
    hero_title:'', hero_subtitle:'', call_to_action:'', about_title:'', about_text:'',
    services_title:'', services_list:[], contact_title:'', contact_instructions:''
  };
  state.iwgEditable         = JSON.parse(JSON.stringify(ec));
  state.iwgOrigEditable     = JSON.parse(JSON.stringify(ec));
  state.iwgTrueOrigEditable = JSON.parse(JSON.stringify(ec));
  state.iwgTrueOriginalHtml = opp.html;
  state.iwgDirty            = false;

  // Update IWG header labels
  const nameEl = document.getElementById('iwg-biz-name');
  const indEl  = document.getElementById('iwg-biz-industry');
  const locEl  = document.getElementById('iwg-biz-location');
  const subEl  = document.getElementById('iwg-header-sub');
  if (nameEl) nameEl.textContent = opp.name || 'Business';
  if (indEl)  indEl.textContent  = opp.industry || '—';
  if (locEl)  locEl.textContent  = opp.location || '—';
  if (subEl)  subEl.textContent  = `Editing website for ${opp.name}`;

  const regenBtn = document.getElementById('iwg-btn-regen');
  if (regenBtn) regenBtn.style.display = '';

  const ratingEl  = document.getElementById('iwg-biz-rating');
  const ratingDot = document.getElementById('iwg-meta-dot-rating');
  if (opp.rating) {
    if (ratingEl)  { ratingEl.textContent = `★ ${opp.rating.toFixed(1)}`; ratingEl.style.display = ''; }
    if (ratingDot) ratingDot.style.display = '';
  } else {
    if (ratingEl)  ratingEl.style.display  = 'none';
    if (ratingDot) ratingDot.style.display = 'none';
  }

  // Load HTML into iframe and populate edit fields
  iwgShowState('result');
  iwgPopulateEditFields();
  const iframe = document.getElementById('iwg-iframe');
  if (iframe) iframe.srcdoc = opp.html;

  // Navigate to Discovery panel and reveal the anchor
  navigate('discovery');
  const anchor = document.getElementById('iwg-anchor');
  if (anchor) {
    anchor.style.display = 'flex';
    setTimeout(() => anchor.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }

  // Show the content (edit) tab automatically so the user can start editing
  iwgTab('content');

  toast('Editor opened — make your changes and click Apply Changes.', 'info');
}

/**
 * wseRegenForWopp(oppId)
 * Regenerates the website for a WOPP opportunity using the shared IWG generator.
 * Navigates to Discovery, opens the IWG widget in idle state ready to generate.
 */

function wseRegenForWopp(oppId) {
  const opp = state.woppOpps.find(o => o.id === oppId);
  if (!opp) return;

  state.iwgWoppContextId = oppId;
  state.iwgCurrentBiz    = { name: opp.name, industry: opp.industry, location: opp.location,
                        id: opp.leadId || null, phone: opp.phone || null, rating: opp.rating || null };
  state.iwgGeneratedHtml = null;
  state.iwgEditable      = null;
  state.iwgOriginalHtml  = null;
  state.iwgOrigEditable  = null;
  state.iwgDirty         = false;

  const nameEl = document.getElementById('iwg-biz-name');
  const indEl  = document.getElementById('iwg-biz-industry');
  const locEl  = document.getElementById('iwg-biz-location');
  const subEl  = document.getElementById('iwg-header-sub');
  if (nameEl) nameEl.textContent = opp.name || 'Business';
  if (indEl)  indEl.textContent  = opp.industry || '—';
  if (locEl)  locEl.textContent  = opp.location || '—';
  if (subEl)  subEl.textContent  = `Regenerating website for ${opp.name}`;

  document.getElementById('iwg-btn-regen').style.display = 'none';
  iwgShowState('idle');

  navigate('discovery');
  const anchor = document.getElementById('iwg-anchor');
  if (anchor) {
    anchor.style.display = 'flex';
    setTimeout(() => anchor.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }
  toast('Click "Generate Website" to regenerate.', 'info');
}

/* ═══════════════════════════════════════════════════
   WEBSITE OPPORTUNITIES — WOPP
   Storage: in-memory + localStorage for persistence
═══════════════════════════════════════════════════ */

// opportunities = array of {id, name, industry, location, rating, reviewCount, status, html, activity, createdAt}
// status: 0=not generated, 1=generated, 2=sent, 3=won

function woppSave() {
  try {
    // Save without html to save space — html stored separately
    const slim = state.woppOpps.map(o => ({ ...o, html: undefined }));
    localStorage.setItem(state.WOPP_STORAGE_KEY, JSON.stringify(slim));
    // save htmls separately
    state.woppOpps.forEach(o => {
      if (o.html) {
        try { localStorage.setItem(`lf_wopp_html_${o.id}`, o.html); } catch(e) {}
      }
    });
  } catch(e) {}
}

function woppLoad() {
  try {
    const raw = localStorage.getItem(state.WOPP_STORAGE_KEY);
    if (!raw) return;
    const slim = JSON.parse(raw);
    state.woppOpps = slim.map(o => ({
      ...o,
      html: (() => { try { return localStorage.getItem(`lf_wopp_html_${o.id}`) || null; } catch(e) { return null; } })()
    }));
  } catch(e) { state.woppOpps = []; }
}

function woppInit() {
  woppLoad();
  woppUpdateStats();
  woppRenderTable();
}

/** Called when a website is generated in IWG — creates/updates an opportunity entry */

function woppOnGenerated(biz, html) {
  // Capture latest editable content from the IWG editor state if available
  const editableSnapshot = state.iwgEditable ? JSON.parse(JSON.stringify(state.iwgEditable)) : null;
  const existing = state.woppOpps.find(o => o.name === biz.name && o.location === biz.location);
  if (existing) {
    existing.html   = html;
    existing.status = Math.max(existing.status, 1);
    if (editableSnapshot) existing.editableContent = editableSnapshot;
    woppAddActivity(existing.id, 'gen', 'Website generated');
  } else {
    const id = 'wo_' + Date.now();
    const opp = {
      id, name: biz.name, industry: biz.industry || '—', location: biz.location || '—',
      rating: biz.rating, reviewCount: biz.review_count,
      status: 1, html,
      editableContent: editableSnapshot,
      activity: [{ type:'gen', text:'Website generated', time: new Date().toISOString() }],
      createdAt: new Date().toISOString()
    };
    state.woppOpps.unshift(opp);
  }
  woppSave();
  woppUpdateStats();
  woppRenderTable();

  // ── Upload HTML to server → get real URL → persist to lead ───────────────
  const leadId = biz.id || biz.leadId;
  if (leadId && leadId !== 'undefined') {
    window._leadPreviewReady = window._leadPreviewReady || {};
    window._leadPreviewUrls  = window._leadPreviewUrls  || {};
    window._leadPreviewReady[leadId] = true;

    apiFetch('POST', '/api/preview/save', { lead_id: leadId, html })
      .then(d => {
        if (d && d.success && d.preview_url) {
          window._leadPreviewUrls[leadId] = d.preview_url;
          toast('Website preview ready! URL saved to lead.', 'success');
        } else {
          // Fallback: mark in notes without URL
          apiFetch('PATCH', `/api/leads/${leadId}`, {
            notes: '[WEBSITE_PREVIEW_GENERATED]'
          }).catch(() => {});
          toast('Website preview generated!', 'success');
        }
      })
      .catch(() => {
        toast('Website preview generated!', 'success');
      });
  } else {
    toast('Website preview generated!', 'success');
  }
}

/** Sync no-website leads from state.discFiltered into opportunities (without html) */

// ── Sync no-website pipeline leads into state.woppOpps ──────────────────────────

function woppSyncFromLeads() {
  if (!state.allLeads || !state.allLeads.length) return;
  state.allLeads.forEach(l => {
    if (l.website && l.website.trim()) return;
    const name = l.business_name || l.name || '';
    if (!name) return;
    const exists = state.woppOpps.find(o => o.leadId === l.id || (o.name === name && o.location === (l.location||'')));
    if (!exists) {
      state.woppOpps.push({
        id: 'wo_lead_' + l.id, leadId: l.id, name,
        industry: l.industry || '—', location: l.location || '—',
        rating: l.rating || null, reviewCount: l.review_count || null,
        status: 0, html: null,
        activity: [{ type:'info', text:'Added from pipeline', time: new Date().toISOString() }],
        createdAt: l.created_at || new Date().toISOString(),
      });
    }
  });
  woppSave();
}

// ── ⚡ Site button in pipeline — open project modal directly ──────────────

function generateWebsiteForLead(leadId, name, industry, location) {
  const existing = state.woppOpps.find(o => o.leadId === leadId || (o.name === name && o.location === location));
  let targetId;
  if (!existing) {
    targetId = 'wo_lead_' + leadId;
    state.woppOpps.unshift({
      id: targetId, leadId, name,
      industry: industry || '—', location: location || '—',
      rating: null, reviewCount: null, status: 0, html: null,
      activity: [{ type:'info', text:'Added from pipeline', time: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
    });
    woppSave();
  } else { targetId = existing.id; }
  window._scoreToOutreachPending = { leadId, bizName: name, industry, location };
  navigate('wopp');
  setTimeout(() => {
    woppUpdateStats();
    woppRenderTable();
    autoGenerateWebsite(targetId);
  }, 300);
}

// ── Generate Website from project modal empty state ───────────────────────

function woGenerateFromModal() {
  if (!state.woppCurrentId) return;
  const opp = state.woppOpps.find(o => o.id === state.woppCurrentId);
  if (!opp) return;
  woCloseProject();
  setTimeout(() => autoGenerateWebsite(opp.id), 150);
}

// ── Generate Website from AI Score panel ─────────────────────────────────

function scoreToWebsiteAndOutreach() {
  const cta = document.getElementById('res-wo-cta');
  if (!cta) return;
  const biz = {
    id: cta.dataset.leadId, name: cta.dataset.leadName,
    industry: cta.dataset.industry, location: cta.dataset.location,
    website: null,
  };
  if (!biz.name) { toast('No lead selected.', 'error'); return; }
  window._scoreToOutreachPending = { leadId: biz.id, bizName: biz.name, industry: biz.industry, location: biz.location };
  const existing = state.woppOpps.find(o => o.leadId === biz.id || (o.name === biz.name && o.location === biz.location));
  let targetId;
  if (!existing) {
    targetId = 'wo_lead_' + biz.id;
    state.woppOpps.unshift({
      id: targetId, leadId: biz.id, name: biz.name,
      industry: biz.industry || '—', location: biz.location || '—',
      rating: null, reviewCount: null, status: 0, html: null,
      activity: [{ type:'info', text:'Added from AI Scoring', time: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
    });
    woppSave();
  } else { targetId = existing.id; }
  navigate('wopp');
  setTimeout(() => {
    woppUpdateStats();
    woppRenderTable();
    // Set state.iwgCurrentBiz so woppOnGenerated can resolve the leadId
    window.iwgCurrentBiz = biz;
    autoGenerateWebsite(targetId);
  }, 300);
}

// ── Generate Outreach after preview ready ────────────────────────────────

async function scoreToOutreachWithPreview() {
  const pending    = window._scoreToOutreachPending;
  const html       = window._scoredLeadPreviewHtml;
  if (!pending || !html) { toast('Generate the website preview first.', 'error'); return; }
  const btn = document.getElementById('res-btn-gen-outreach');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

  // Get the real server URL if available, otherwise fall back to flag only
  const previewUrl = window._leadPreviewUrls?.[pending.leadId] || null;

  const payload = {
    lead_id             : pending.leadId,
    tone_override       : 'website-preview',
    websitePreviewExists: true,
  };
  if (previewUrl) payload.preview_url = previewUrl;

  const d = await apiFetch('POST', '/api/generate-outreach', payload);
  if (btn) { btn.disabled = false; btn.style.display = 'flex'; }
  if (!d.success) { toast(d.message || 'Failed.', 'error'); return; }
  navigate('outreach');
  setTimeout(() => {
    const sel = document.getElementById('out-select');
    if (sel && pending.leadId) sel.value = pending.leadId;
    loadOutreachHistory();
    const msg = previewUrl
      ? 'Outreach generated — preview URL included in email!'
      : 'Outreach generated with website preview reference!';
    toast(msg, 'success');
  }, 200);
}

// ── Hook woppOnGenerated to update score panel after website generated ────
(function() {
  const _orig = typeof woppOnGenerated === 'function' ? woppOnGenerated : null;
  window.woppOnGenerated = function(biz, html) {
    if (_orig) _orig(biz, html);
    const pending = window._scoreToOutreachPending;
    if (!pending) return;
    if (biz.id !== pending.leadId && biz.name !== pending.bizName) return;
    window._scoredLeadPreviewHtml = html;
    const previewReady = document.getElementById('res-preview-ready');
    const outreachBtn  = document.getElementById('res-btn-gen-outreach');
    const genBtn       = document.getElementById('res-btn-gen-site');
    if (genBtn) genBtn.textContent = '✓ Website Generated';

    // Wait for /api/preview/save to complete (fired in woppOnGenerated above)
    // Poll _leadPreviewUrls for up to 5 seconds
    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      const url = window._leadPreviewUrls?.[pending.leadId];
      if (url || attempts >= 10) {
        clearInterval(check);
        if (previewReady) {
          previewReady.style.display = '';
          previewReady.textContent = url
            ? `✓ Preview ready — URL will be included in outreach email`
            : '✓ Website preview ready — outreach will reference it';
        }
        if (outreachBtn) outreachBtn.style.display = 'flex';
        navigate('scoring');
        setTimeout(() => document.getElementById('score-result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 200);
      }
    }, 500);
  };
})();

function woppSyncFromDisc() {
  if (!state.discFiltered || !state.discFiltered.length) return;
  let added = 0;
  state.discFiltered.forEach(b => {
    if (b.website) return;
    const exists = state.woppOpps.find(o => o.name === b.name && o.location === b.location);
    if (!exists) {
      state.woppOpps.push({
        id: 'wo_' + Date.now() + '_' + Math.random().toString(36).slice(2),
        name: b.name, industry: b.industry || '—', location: b.location || '—',
        rating: b.rating, reviewCount: b.review_count,
        status: 0, html: null,
        activity: [{ type:'info', text:'Found in Discovery (no website)', time: new Date().toISOString() }],
        createdAt: new Date().toISOString()
      });
      added++;
    }
  });
  if (added) {
    woppSave();
    woppUpdateStats();
    woppRenderTable();
  }
}

function woppRefresh() {
  woppSyncFromDisc();
  woppUpdateStats();
  woppRenderTable();
  toast('Opportunities refreshed.', 'success');
}

function woppFilterStage(stage) {
  state.woppActiveStage = (state.woppActiveStage === stage) ? null : stage;
  document.querySelectorAll('.wo-stage').forEach((el, i) => el.classList.toggle('active', i === state.woppActiveStage));
  const sel = document.getElementById('wo-status-filter');
  if (sel) sel.value = state.woppActiveStage !== null ? String(state.woppActiveStage) : '';
  woppRenderTable();
}

function woppUpdateStats() {
  const counts = [0,0,0,0];
  state.woppOpps.forEach(o => counts[o.status]++);
  const total = state.woppOpps.length;

  // KPI cards
  const nosite = state.woppOpps.filter(o => !o.html && o.status === 0).length;
  document.getElementById('wo-kpi-nosite').textContent = total;
  document.getElementById('wo-kpi-gen').textContent    = counts[1] + counts[2] + counts[3];
  document.getElementById('wo-kpi-sent').textContent   = counts[2] + counts[3];
  document.getElementById('wo-kpi-won').textContent    = counts[3];

  // Pipeline counts
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`wo-s-count-${i}`);
    if (el) el.textContent = counts[i];
  }

  // Overview card
  const ovNosite = document.getElementById('wo-ov-nosite');
  const ovGen    = document.getElementById('wo-ov-generated');
  const ovRev    = document.getElementById('wo-ov-revenue');
  if (ovNosite) ovNosite.textContent = total;
  if (ovGen)    ovGen.textContent    = counts[1] + counts[2] + counts[3];
  if (ovRev)    ovRev.textContent    = '$' + (total * 2000).toLocaleString();

  // Revenue panel
  const revLow  = document.getElementById('wo-rev-low');
  const revMid  = document.getElementById('wo-rev-mid');
  const revHigh = document.getElementById('wo-rev-high');
  if (revLow)  revLow.textContent  = '$' + (total * 500).toLocaleString();
  if (revMid)  revMid.textContent  = '$' + (total * 2000).toLocaleString();
  if (revHigh) revHigh.textContent = '$' + (total * 5000).toLocaleString();
}

function woppRenderTable() {
  const tbody    = document.getElementById('wo-tbody');
  if (!tbody) return;
  const filterSel = document.getElementById('wo-status-filter');
  const filterVal = filterSel ? filterSel.value : '';

  let list = filterVal !== '' ? state.woppOpps.filter(o => String(o.status) === filterVal) : state.woppOpps;

  // Footer
  const footer = document.getElementById('wo-footer-right');
  if (footer) footer.textContent = `${state.woppOpps.length} total opportunities`;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty" style="padding:40px">
        <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg></div>
        <div class="empty-title">No opportunities yet</div>
        <div class="empty-desc">Run a Discovery search, then click <strong>⚡ Site</strong> on any no-website business to create an opportunity.</div>
        <button class="btn btn-brand btn-sm" onclick="navigate('discovery')">Go to Discovery →</button>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(o => {
    const stars = o.rating
      ? `<span style="color:var(--amber);font-size:12px">★</span><span style="font-family:var(--fm);font-size:11px;color:var(--text-2);margin-left:2px">${o.rating.toFixed(1)}</span>`
      : '<span style="color:var(--text-3);font-size:12px">—</span>';
    const actions = o.html
      ? `<div style="display:flex;gap:4px">
           <button class="btn btn-outline btn-xs" onclick="woOpenProject('${o.id}')">Open Project</button>
           <button class="btn btn-xs" onclick="woQuickDownload('${o.id}')" style="background:var(--blue-dim);border:1px solid var(--blue-mid);color:var(--blue);font-family:var(--fm);font-size:9px;padding:3px 8px;border-radius:3px;cursor:pointer">Export</button>
         </div>`
      : `<button class="btn btn-brand btn-xs" onclick="woGenerateFromOpp('${o.id}')">
           <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
           Generate
         </button>`;
    return `<tr style="cursor:pointer" onclick="woOpenProject('${o.id}')">
      <td onclick="event.stopPropagation()">
        <div style="font-weight:600;font-size:13px">${esc(o.name)}</div>
        <div style="font-size:11px;color:var(--text-3)">${esc(o.location)}</div>
      </td>
      <td style="color:var(--text-2);font-size:13px">${esc(o.industry)}</td>
      <td style="font-size:12px;color:var(--text-2)">${esc(o.location)}</td>
      <td>${stars}</td>
      <td><span class="wo-status-pill wo-status-${o.status}">${state.WOPP_STATUS_LABELS[o.status]}</span></td>
      <td onclick="event.stopPropagation()">${actions}</td>
    </tr>`;
  }).join('');
}

function woOpenProject(id) {
  const opp = state.woppOpps.find(o => o.id === id);
  if (!opp) return;
  state.woppCurrentId = id;

  document.getElementById('wo-project-name').textContent = opp.name;
  document.getElementById('wo-project-status').value = String(opp.status);

  // Preview
  const noHtml = document.getElementById('wo-project-nohtml');
  const preview = document.getElementById('wo-project-preview');
  const iframe  = document.getElementById('wo-project-iframe');
  if (opp.html) {
    noHtml.style.display  = 'none';
    preview.style.display = '';
    iframe.srcdoc = opp.html;
  } else {
    noHtml.style.display  = '';
    preview.style.display = 'none';
  }

  // Activity
  const log = document.getElementById('wo-activity-log');
  if (log) {
    const acts = opp.activity || [];
    if (!acts.length) {
      log.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-3);font-size:13px">No activity yet.</div>';
    } else {
      const dotClass = { gen:'activity-dot-gen', exp:'activity-dot-exp', sent:'activity-dot-sent', won:'activity-dot-won', info:'activity-dot-info' };
      log.innerHTML = [...acts].reverse().map(a => `
        <div class="activity-item">
          <div class="activity-dot ${dotClass[a.type] || 'activity-dot-info'}"></div>
          <div class="activity-text">${esc(a.text)}</div>
          <div class="activity-time">${new Date(a.time).toLocaleString()}</div>
        </div>`).join('');
    }
  }

  pmTab('preview');
  document.getElementById('wo-project-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function woCloseProject() {
  document.getElementById('wo-project-modal').classList.remove('open');
  document.body.style.overflow = '';
  state.woppCurrentId = null;
}

/**
 * woEditWebsite() — Opens the shared IWG editor for the current WOPP opportunity.
 * Closes the project modal first, then opens the editor in Discovery panel.
 */

function woEditWebsite() {
  const id = state.woppCurrentId;
  if (!id) return;
  woCloseProject();
  wseOpenEditorForWopp(id);
}

/**
 * woRegenWebsite() — Triggers website regeneration for the current WOPP opportunity
 * using the shared IWG generator in Discovery panel.
 */

function woRegenWebsite() {
  const id = state.woppCurrentId;
  if (!id) return;
  woCloseProject();
  wseRegenForWopp(id);
}

function pmTab(name) {
  ['preview','export','activity'].forEach(t => {
    const btn = document.getElementById(`pm-tab-${t}`);
    const pnl = document.getElementById(`pm-tc-${t}`);
    if (btn) btn.classList.toggle('active', t === name);
    if (pnl) pnl.classList.toggle('active', t === name);
  });
}

function woUpdateStatus() {
  if (!state.woppCurrentId) return;
  const opp = state.woppOpps.find(o => o.id === state.woppCurrentId);
  if (!opp) return;
  const newStatus = parseInt(document.getElementById('wo-project-status').value);
  opp.status = newStatus;
  const labels = ['set to Not Generated','set to Generated','marked as Sent','marked as Won 🎉'];
  woppAddActivity(state.woppCurrentId, ['info','gen','sent','won'][newStatus], `Status ${labels[newStatus]}`);
  woppSave();
  woppUpdateStats();
  woppRenderTable();
  toast(`Status updated to ${state.WOPP_STATUS_LABELS[newStatus]}`, 'success');
}

function woMarkSent() {
  if (!state.woppCurrentId) return;
  const opp = state.woppOpps.find(o => o.id === state.woppCurrentId);
  if (!opp) return;
  opp.status = 2;
  document.getElementById('wo-project-status').value = '2';
  woppAddActivity(state.woppCurrentId, 'sent', 'Website exported and sent to prospect');
  woppSave(); woppUpdateStats(); woppRenderTable();
  toast('Marked as Sent!', 'success');
}

function woMarkWon() {
  if (!state.woppCurrentId) return;
  const opp = state.woppOpps.find(o => o.id === state.woppCurrentId);
  if (!opp) return;
  opp.status = 3;
  document.getElementById('wo-project-status').value = '3';
  woppAddActivity(state.woppCurrentId, 'won', 'Deal marked as Won! 🎉');
  woppSave(); woppUpdateStats(); woppRenderTable();
  toast('🎉 Deal marked as Won!', 'success');
}

function woDownload() {
  const opp = state.woppOpps.find(o => o.id === state.woppCurrentId);
  if (!opp || !opp.html) { toast('No website generated yet.', 'error'); return; }
  const name = opp.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const blob = new Blob([opp.html], { type: 'text/html' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = name + '.html';
  a.click();
  woppAddActivity(state.woppCurrentId, 'exp', 'Website downloaded');
  woppSave();
  toast(`Downloaded ${name}.html`, 'success');
}

function woCopyHtml() {
  const opp = state.woppOpps.find(o => o.id === state.woppCurrentId);
  if (!opp || !opp.html) { toast('No website generated yet.', 'error'); return; }
  navigator.clipboard.writeText(opp.html).then(() => {
    woppAddActivity(state.woppCurrentId, 'exp', 'HTML copied to clipboard');
    woppSave();
    toast('HTML copied!', 'success');
  }).catch(() => toast('Copy failed.', 'error'));
}

function woQuickDownload(id) {
  const opp = state.woppOpps.find(o => o.id === id);
  if (!opp || !opp.html) { toast('No website generated yet.', 'error'); return; }
  const name = opp.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const blob = new Blob([opp.html], { type: 'text/html' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = name + '.html';
  a.click();
  toast(`Exported ${name}.html`, 'success');
}

function woGenerateFromOpp(id) {
  const opp = state.woppOpps.find(o => o.id === id);
  if (!opp) return;
  // Stay on wopp page — open the inline generator modal
  woOpenGeneratorModal(id);
}

/* ── Inline generator modal for Website Opportunities ─────────── */

function autoGenerateWebsite(targetId) {
  const opp = state.woppOpps.find(o => o.id === targetId);
  if (!opp) { toast('Lead not found in opportunities.', 'error'); return; }

  // If already has HTML, just open project preview instead
  if (opp.html) {
    woOpenProject(targetId);
    return;
  }

  // Set the ID so woRunGenerate() can find it
  state.woGenCurrentId = targetId;

  // Open generator modal UI
  woOpenGeneratorModal(targetId);

  // Immediately start generating — no extra click needed
  woRunGenerate();
}

function woOpenGeneratorModal(id) {
  state.woGenCurrentId = id;
  const opp = state.woppOpps.find(o => o.id === id);
  if (!opp) return;

  document.getElementById('wo-gen-biz-name').textContent     = opp.name;
  document.getElementById('wo-gen-biz-meta').textContent     = [opp.industry, opp.location].filter(Boolean).join(' · ');
  document.getElementById('wo-gen-state-idle').style.display    = '';
  document.getElementById('wo-gen-state-loading').style.display = 'none';
  document.getElementById('wo-gen-state-result').style.display  = 'none';

  document.getElementById('wo-gen-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function woCloseGeneratorModal() {
  document.getElementById('wo-gen-modal').classList.remove('open');
  document.body.style.overflow = '';
  state.woGenCurrentId = null;
}

async function woRunGenerate() {
  const opp = state.woppOpps.find(o => o.id === state.woGenCurrentId);
  if (!opp) return;
  const t0 = performance.now();

  document.getElementById('wo-gen-state-idle').style.display    = 'none';
  document.getElementById('wo-gen-state-loading').style.display = '';
  document.getElementById('wo-gen-state-result').style.display  = 'none';

  const steps = ['Analyzing data…','Writing copy…','Designing layout…','Building sections…',
    'Generating hero…','Creating services grid…','Finalizing…'];
  let stepIdx = 0, pct = 0;
  const barEl  = document.getElementById('wo-gen-bar');
  const stepEl = document.getElementById('wo-gen-step');
  const interval = setInterval(() => {
    pct = Math.min(pct + 13, 92);
    if (barEl) barEl.style.width = pct + '%';
    if (stepEl && stepIdx < steps.length) stepEl.textContent = steps[stepIdx++];
  }, 800);

  const prompt = [
    `Business Name: ${opp.name}`,
    `Industry: ${opp.industry || 'General'}`,
    `Location: ${opp.location || ''}`,
    opp.rating ? `Rating: ${opp.rating}/5 (${opp.reviewCount || 0} reviews)` : null,
    opp.phone  ? `Phone: ${opp.phone}` : null,
  ].filter(Boolean).join('\n');

  console.log('[WO] Generating for:', opp.name);

  try {
    const t1  = performance.now();
    const res = await fetch('/api/generate-website', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ messages: [{ role: 'user', content: prompt }], industry: opp.industry || '' })
    });
    console.log('[WO] Fetch done in', Math.round(performance.now()-t1), 'ms — HTTP', res.status);

    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);

    const html = parseGeneratedHtml(data);
    console.log('[WO] HTML length:', html ? html.length : 0);

    const validErr = validateGeneratedHtml(html);
    if (validErr) throw new Error(validErr);

    console.log('[WO] Total:', Math.round(performance.now()-t0), 'ms');

    clearInterval(interval);
    if (barEl) barEl.style.width = '100%';
    await new Promise(r => setTimeout(r, 200));

    opp.html   = html;
    opp.status = Math.max(opp.status, 1);
    woppAddActivity(state.woGenCurrentId, 'gen', 'Website generated');
    woppSave(); woppUpdateStats(); woppRenderTable();

    const bizForUpload = { id: opp.leadId||null, leadId: opp.leadId||null,
      name: opp.name, industry: opp.industry, location: opp.location };
    if (typeof woppOnGenerated === 'function') woppOnGenerated(bizForUpload, html);

    const iframe = document.getElementById('wo-gen-iframe');
    if (iframe) iframe.srcdoc = html;
    document.getElementById('wo-gen-state-loading').style.display = 'none';
    document.getElementById('wo-gen-state-result').style.display  = '';
    toast('Website generated!', 'success');

  } catch(e) {
    console.error('[WO] Failed:', e);
    clearInterval(interval);
    document.getElementById('wo-gen-state-loading').style.display = 'none';
    document.getElementById('wo-gen-state-idle').style.display    = '';
    toast('Generation failed: ' + e.message, 'error');
  }
}

function woGenDownload() {
  const opp = state.woppOpps.find(o => o.id === state.woGenCurrentId);
  if (!opp || !opp.html) return;
  const name = opp.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const blob = new Blob([opp.html], { type: 'text/html' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '.html'; a.click();
  woppAddActivity(state.woGenCurrentId, 'exp', 'Website downloaded'); woppSave();
  toast(`Downloaded ${name}.html`, 'success');
}

function woGenOpenProject() {
  const id = state.woGenCurrentId;
  woCloseGeneratorModal();
  setTimeout(() => woOpenProject(id), 100);
}

function woOpenFullPreview(source) {
  // Get HTML from the right source
  let html = null;
  if (source === 'gen') {
    const opp = state.woppOpps.find(o => o.id === state.woGenCurrentId);
    html = opp?.html || null;
  } else {
    const opp = state.woppOpps.find(o => o.id === state.woppCurrentId);
    html = opp?.html || null;
  }
  if (!html) { toast('No website generated yet.', 'error'); return; }

  // Open as blob URL in a new tab — full browser viewport, no restrictions
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const tab  = window.open(url, '_blank');

  // Revoke the object URL after the tab has loaded to free memory
  if (tab) {
    tab.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    // Fallback revoke after 10s in case load event doesn't fire
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

function woppAddActivity(id, type, text) {
  const opp = state.woppOpps.find(o => o.id === id);
  if (!opp) return;
  if (!opp.activity) opp.activity = [];
  opp.activity.push({ type, text, time: new Date().toISOString() });
}

// Hook into iwgGenerate to create opportunities automatically — handled via iwgShowState patch above
/* ─────────────────────────────────────────────────────────────────────────
   PIPELINE ANALYTICS
───────────────────────────────────────────────────────────────────────── */

export {
  parseGeneratedHtml, tryParseJson, extractHtmlFromText, validateGeneratedHtml, iwgShowState, iwgTrigger,
  iwgClose, iwgGenerate, iwgRegen, iwgPopulateEditFields, iwgRenderEditServices, iwgAddEditService,
  iwgRemoveEditSvc, iwgMarkDirty, iwgApplyEdits, iwgResetEdits, iwgTab, iwgDownload,
  iwgCopyHtml, wsePersistToWopp, wseOpenEditorForWopp, wseRegenForWopp, woppSave, woppLoad,
  woppInit, woppOnGenerated, woppSyncFromLeads, generateWebsiteForLead, woGenerateFromModal, scoreToWebsiteAndOutreach,
  scoreToOutreachWithPreview, woppSyncFromDisc, woppRefresh, woppFilterStage, woppUpdateStats, woppRenderTable,
  woOpenProject, woCloseProject, woEditWebsite, woRegenWebsite, pmTab, woUpdateStatus,
  woMarkSent, woMarkWon, woDownload, woCopyHtml, woQuickDownload, woGenerateFromOpp,
  autoGenerateWebsite, woOpenGeneratorModal, woCloseGeneratorModal, woRunGenerate, woGenDownload, woGenOpenProject,
  woOpenFullPreview, woppAddActivity,
};
