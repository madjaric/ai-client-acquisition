/* ═══════════════════════════════════════════════════════════════
   modules/discovery.js — SerpAPI/Maps discovery UI + import-to-pipeline logic
   ═══════════════════════════════════════════════════════════════ */

import { state } from '../core/state.js';
import { openUpgradeModal } from '../app.js';
import { apiFetch } from '../core/api.js';
import { loadLeads } from './leads.js';
import { iwgTrigger } from './website.js';
import { toast } from '../utils/dom.js';
import { esc } from '../utils/formatters.js';

function discShowState(name) {
  ['initial','loading','error','results'].forEach(s => {
    const el = document.getElementById(`disc-state-${s}`);
    if (el) el.style.display = (s === name) ? '' : 'none';
  });
}

async function checkDiscoverySource() {
  try {
    const d     = await apiFetch('GET', '/api/discovery/source');
    const dot   = document.getElementById('disc-source-dot');
    const label = document.getElementById('disc-source-label');
    if (d.source === 'serpapi') {
      if (dot)   { dot.style.background = 'var(--brand)'; dot.style.boxShadow = '0 0 0 3px var(--brand-dim)'; }
      if (label) label.textContent = 'SerpAPI live';
    } else {
      if (dot)   dot.style.background = 'var(--amber)';
      if (label) label.textContent = 'Mock data';
    }
  } catch {}
}

function discQuickSearch(industry, location) {
  document.getElementById('disc-industry').value = industry;
  document.getElementById('disc-location').value  = location;
  discSearch();
}

async function discSearch() {
  const industry = (document.getElementById('disc-industry').value || '').trim();
  const location = (document.getElementById('disc-location').value || '').trim();
  const limit    = parseInt(document.getElementById('disc-limit').value || '20');

  if (!industry && !location) {
    document.getElementById('disc-industry').focus();
    toast('Enter a business type or location.', 'error'); return;
  }

  const keyword = [industry, location].filter(Boolean).join(' ');
  const btn = document.getElementById('disc-btn-search');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Searching…';

  document.getElementById('disc-loading-kw').textContent = `"${keyword}"`;
  discShowState('loading');
  state.discImportedIds.clear();

  state.discMsgIdx = 0;
  document.getElementById('disc-loading-msg').textContent = state.DISC_LOADING_MSGS[0];
  clearInterval(state.discMsgInterval);
  state.discMsgInterval = setInterval(() => {
    state.discMsgIdx = (state.discMsgIdx + 1) % state.DISC_LOADING_MSGS.length;
    const el = document.getElementById('disc-loading-msg');
    if (el) el.textContent = state.DISC_LOADING_MSGS[state.discMsgIdx];
  }, 900);

  const d = await apiFetch('POST', '/api/discovery/search', { keyword, limit });

  clearInterval(state.discMsgInterval);
  btn.disabled = false;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Search`;

  if (!d.success) {
    clearInterval(state.discMsgInterval);
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Search`;

    // Quota exceeded — detect by code OR by message text (server compatibility)
    const isQuota = d.code === 'QUOTA_EXCEEDED' || (d.message && d.message.toLowerCase().includes('limit reached'));
    if (isQuota) {
      openUpgradeModal(`You've used all your searches on the free plan this month.`);
      discShowState('initial'); return;
    }
    // Not authenticated
    const isAuth = d.message && d.message.toLowerCase().includes('sign in');
    if (isAuth) {
      const errEl = document.getElementById('disc-error-msg');
      if (errEl) errEl.innerHTML = `You need to <a href="/login.html" style="color:var(--brand);text-decoration:underline">sign in</a> to search for businesses.`;
      discShowState('error'); return;
    }
    const errEl = document.getElementById('disc-error-msg');
    if (errEl) errEl.textContent = d.message || 'Search failed.';
    discShowState('error'); return;
  }  state.discAllResults = d.data || [];
  document.getElementById('disc-results-title').textContent = `${state.discAllResults.length} business${state.discAllResults.length !== 1 ? 'es' : ''} found`;
  document.getElementById('disc-results-sub').innerHTML = `<strong>${d.source === 'serpapi' ? 'Google Maps (SerpAPI)' : 'Mock data'}</strong> · query: "${esc(d.keyword || keyword)}"`;
  document.getElementById('disc-import-summary').style.display = 'none';

  discClearFilters(false);
  discApplyFilters();
  discShowState('results');
}

function discApplyFilters() {
  const minRating  = parseFloat(document.getElementById('disc-filter-rating').value)  || 0;
  const website    = document.getElementById('disc-filter-website').value;
  const minReviews = 0;

  state.discFiltered = state.discAllResults.filter(b => {
    if (minRating > 0 && (b.rating === null || b.rating < minRating)) return false;
    if (website === 'yes' && !b.website) return false;
    if (website === 'no'  &&  b.website) return false;
    return true;
  });

  // No-website button — import to pipeline directly
  const noWebCount = state.discFiltered.filter(b => !b.website).length;
  const nwBtn = document.getElementById('disc-btn-import-nowebsite');
  const nwCnt = document.getElementById('disc-nowebsite-count');
  if (nwBtn && nwCnt) {
    nwCnt.textContent = noWebCount;
    nwBtn.classList.toggle('hidden', noWebCount === 0);
  }

  // Filters meta
  const meta = document.getElementById('disc-filters-meta');
  if (meta && state.discFiltered.length > 0) {
    const noWeb = state.discFiltered.filter(b => !b.website).length;
    meta.innerHTML = `${state.discFiltered.length} results · <span style="color:var(--amber)">${noWeb} no website</span> · ${state.discFiltered.length - noWeb} with website`;
  } else if (meta) meta.textContent = '';

  discRenderTable(state.discFiltered);
  discUpdateSelUI();
}

function discClearFilters(reRender = true) {
  document.getElementById('disc-filter-rating').value  = '0';
  document.getElementById('disc-filter-website').value = 'any';
  state.discFiltered = [...state.discAllResults];
  if (reRender && state.discAllResults.length) discApplyFilters();
}

function discStars(r) {
  if (r === null || r === undefined) return '<span style="color:var(--text-3);font-size:12px">—</span>';
  const full = Math.floor(r), half = (r % 1) >= .5 ? 1 : 0, empty = 5 - full - half;
  let h = '';
  for (let i=0;i<full;i++) h += '<span style="color:#f59e0b">★</span>';
  if (half) h += '<span style="color:#f59e0b;opacity:.5">★</span>';
  for (let i=0;i<empty;i++) h += '<span style="color:var(--text-3)">★</span>';
  return `<span style="display:inline-flex;align-items:center;gap:1px">${h}<span style="font-family:var(--fm);font-size:10px;color:var(--text-2);margin-left:3px">${r.toFixed(1)}</span></span>`;
}

function discRenderTable(list) {
  const tbody = document.getElementById('disc-tbody');
  const cbAll = document.getElementById('disc-cb-all');
  if (cbAll) cbAll.checked = false;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty" style="padding:32px">
      <div class="empty-title">No results match filters</div>
      <div class="empty-desc">Try loosening the filter criteria.</div>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((b, i) => {
    b._idx = i;
    const imp = state.discImportedIds.has(i);
    const site = b.website
      ? `<a href="${esc(b.website)}" target="_blank" rel="noopener" style="color:var(--blue);font-size:12px;text-decoration:none">↗ ${esc(b.website.replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,'').slice(0,28))}</a>`
      : `<span style="font-family:var(--fm);font-size:10px;font-weight:600;color:var(--amber);background:var(--amber-dim);border:1px solid var(--amber-mid);padding:2px 7px;border-radius:3px">No website</span>`;
    const srcTag = b.source === 'serpapi'
      ? `<span style="font-family:var(--fm);font-size:9px;padding:1px 5px;border-radius:3px;background:var(--brand-dim);color:var(--brand)">live</span>`
      : `<span style="font-family:var(--fm);font-size:9px;padding:1px 5px;border-radius:3px;background:var(--bg-3);color:var(--text-3)">mock</span>`;

    return `<tr id="disc-row-${i}" class="${imp ? 'imported' : ''}">
      <td><input type="checkbox" class="cb disc-row-cb" data-idx="${i}" onchange="discRowCheck()" style="accent-color:var(--brand)" ${imp ? 'disabled checked' : ''} /></td>
      <td><div style="font-weight:600;font-size:13px">${esc(b.name)}</div>${b.phone ? `<div style="font-size:11px;color:var(--text-3);font-family:var(--fm)">${esc(b.phone)}</div>` : ''}</td>
      <td style="color:var(--text-2)">${esc(b.location)}</td>
      <td>${discStars(b.rating)}</td>
      <td style="font-family:var(--fm);font-size:11px;color:var(--text-3)">${b.review_count !== null ? b.review_count.toLocaleString() : '—'}</td>
      <td>${site}</td>
      <td><span style="font-size:12px;color:var(--text-2)">${esc(b.industry)}</span> ${srcTag}</td>
      <td>${imp
        ? `<span style="font-family:var(--fm);font-size:10px;color:var(--brand);background:var(--brand-dim);border:1px solid var(--brand-mid);padding:2px 7px;border-radius:3px">✓ Imported</span>`
        : `<div style="display:flex;gap:4px;align-items:center">
             <button class="btn btn-outline btn-xs" onclick="discImportOne(${i})" id="disc-btn-row-${i}">↓ Import</button>
             ${!b.website ? `<button class="btn btn-xs" onclick="iwgTrigger(${i})" title="Generate website for this business" style="background:var(--brand-dim);border:1px solid var(--brand-mid);color:var(--brand);font-family:var(--fm);font-size:9px;font-weight:600;letter-spacing:.04em;padding:3px 8px;border-radius:3px;cursor:pointer;white-space:nowrap;transition:background .12s" onmouseover="this.style.background='rgba(34,197,94,.2)'" onmouseout="this.style.background='var(--brand-dim)'">⚡ Site</button>` : ''}
           </div>`
      }</td>
    </tr>`;
  }).join('');

  discUpdateFooter();
}

function discRowCheck() { discUpdateSelUI(); }

function discToggleAll(checked) {
  const cbs = document.querySelectorAll('.disc-row-cb:not(:disabled)');
  if (typeof checked === 'undefined') {
    const anyUnchecked = [...cbs].some(c => !c.checked);
    cbs.forEach(cb => cb.checked = anyUnchecked);
    const cbAll = document.getElementById('disc-cb-all');
    if (cbAll) cbAll.checked = anyUnchecked;
    document.getElementById('disc-btn-selectall').textContent = anyUnchecked ? 'Deselect all' : 'Select all';
  } else {
    cbs.forEach(cb => cb.checked = checked);
  }
  discUpdateSelUI();
}

function discGetSelected() {
  return Array.from(document.querySelectorAll('.disc-row-cb:checked')).map(c => parseInt(c.dataset.idx, 10));
}

function discClearSelection() {
  document.querySelectorAll('.disc-row-cb').forEach(cb => { if (!state.discImportedIds.has(parseInt(cb.dataset.idx))) cb.checked = false; });
  const cbAll = document.getElementById('disc-cb-all');
  if (cbAll) cbAll.checked = false;
  discUpdateSelUI();
}

function discUpdateSelUI() {
  const n      = discGetSelected().length;
  const selRow = document.getElementById('disc-select-row');
  const selBtn = document.getElementById('disc-btn-import-sel');
  const cntEl  = document.getElementById('disc-select-count');
  if (selRow) selRow.style.display = n > 0 ? 'flex' : 'none';
  if (selBtn) selBtn.disabled = n === 0;
  if (cntEl)  cntEl.textContent = `${n} selected`;
}

async function discImportSelected() {
  const indices = discGetSelected();
  if (!indices.length) { toast('Select at least one business.', 'error'); return; }

  // Normalize to what backend createLead() expects: business_name (not name)
  const businesses = indices.map(i => state.discFiltered[i]).filter(Boolean).map(b => ({
    business_name    : b.name,
    industry         : b.industry,
    location         : b.location,
    website          : b.website          || undefined,
    email            : b.email            || undefined,
    email_source     : b.email_source     || undefined,
    phone            : b.phone            || undefined,
    phone_normalized : b.phone_normalized || undefined,
    rating           : b.rating           ?? undefined,
    review_count     : b.review_count     ?? undefined,
    place_id         : b.place_id         || undefined,
    source           : b.source           || undefined,
    notes            : [
      b.rating       && `Rating: ${b.rating}/5`,
      b.review_count && `${b.review_count} reviews`,
      b.phone        && `Phone: ${b.phone}`,
      b.email        && `Email: ${b.email}`,
      'Imported via Discovery',
    ].filter(Boolean).join(' · '),
  }));

  const btn = document.getElementById('disc-btn-import-sel');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Importing…'; }

  const d = await apiFetch('POST', '/api/discovery/import', { businesses });

  if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg> Import Selected`; }

  if (!d.success && !d.summary) { toast(d.message || 'Import failed.', 'error'); return; }

  const s = d.summary || {};
  indices.forEach(i => state.discImportedIds.add(i));
  discRenderTable(state.discFiltered);
  discClearSelection();
  discShowImportSummary(s);
  loadLeads();

  if ((s.imported || 0) > 0) toast(`${s.imported} lead${s.imported > 1 ? 's' : ''} imported.`, 'success');
  if ((s.skipped  || 0) > 0) toast(`${s.skipped} duplicate${s.skipped > 1 ? 's' : ''} skipped.`, 'info');
}

async function discImportOne(idx) {
  const b   = state.discFiltered[idx];
  if (!b) return;
  const btn = document.getElementById(`disc-btn-row-${idx}`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner dark"></span>'; }

  const d = await apiFetch('POST', '/api/discovery/import-one', {
    business_name    : b.name,
    location         : b.location,
    industry         : b.industry,
    website          : b.website          || undefined,
    email            : b.email            || undefined,
    email_source     : b.email_source     || undefined,
    phone            : b.phone            || undefined,
    phone_normalized : b.phone_normalized || undefined,
    rating           : b.rating           ?? undefined,
    review_count     : b.review_count     ?? undefined,
    place_id         : b.place_id         || undefined,
    source           : b.source           || undefined,
    notes: [
      b.rating       && `Rating: ${b.rating}/5`,
      b.review_count && `${b.review_count} reviews`,
      b.phone        && `Phone: ${b.phone}`,
      b.email        && `Email: ${b.email}`,
      'Imported via Discovery',
    ].filter(Boolean).join(' · '),
  });

  if (d.success) {
    state.discImportedIds.add(idx);
    const row = document.getElementById(`disc-row-${idx}`);
    if (row) {
      const lastTd = row.querySelector('td:last-child');
      if (lastTd) lastTd.innerHTML = `<span style="font-family:var(--fm);font-size:10px;color:var(--brand);background:var(--brand-dim);border:1px solid var(--brand-mid);padding:2px 7px;border-radius:3px">✓ Imported</span>`;
    }
    toast(`"${esc(b.name)}" added to pipeline.`, 'success');
    loadLeads();
    discUpdateFooter();
  } else if (d.message?.includes('already exists')) {
    toast(`"${esc(b.name)}" already in leads.`, 'info');
    if (btn) { btn.disabled = true; btn.textContent = 'Duplicate'; }
  } else {
    toast(d.message || 'Import failed.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = '↓ Import'; }
  }
}

// Import ALL no-website leads directly to pipeline (no CSV)

async function discImportNoWebsite() {
  const noWebLeads = state.discFiltered.filter((b, i) => !b.website && !state.discImportedIds.has(i));
  if (!noWebLeads.length) { toast('All no-website leads already imported.', 'info'); return; }

  // Normalize field names for backend
  const businesses = noWebLeads.map(b => ({
    business_name    : b.name,
    industry         : b.industry,
    location         : b.location,
    website          : b.website          || undefined,
    email            : b.email            || undefined,
    email_source     : b.email_source     || undefined,
    phone            : b.phone            || undefined,
    phone_normalized : b.phone_normalized || undefined,
    rating           : b.rating           ?? undefined,
    review_count     : b.review_count     ?? undefined,
    place_id         : b.place_id         || undefined,
    source           : b.source           || undefined,
    notes            : [
      b.rating       && `Rating: ${b.rating}/5`,
      b.review_count && `${b.review_count} reviews`,
      b.phone        && `Phone: ${b.phone}`,
      b.email        && `Email: ${b.email}`,
      'Imported via Discovery',
    ].filter(Boolean).join(' · '),
  }));

  const btn = document.getElementById('disc-btn-import-nowebsite');
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner dark"></span> Importing ${noWebLeads.length}…`; }

  const d = await apiFetch('POST', '/api/discovery/import', { businesses });

  if (btn) {
    btn.disabled = false;
    const nwCount = document.getElementById('disc-nowebsite-count');
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg> Import without website (<span id="disc-nowebsite-count">${nwCount?.textContent||''}</span>)`;
  }

  if (!d.success && !d.summary) { toast(d.message || 'Import failed.', 'error'); return; }

  const s = d.summary || {};
  // Mark imported
  state.discFiltered.forEach((b, i) => { if (!b.website) state.discImportedIds.add(i); });
  discRenderTable(state.discFiltered);
  discShowImportSummary(s);
  loadLeads();

  if ((s.imported || 0) > 0) toast(`${s.imported} no-website lead${s.imported > 1 ? 's' : ''} imported to pipeline.`, 'success');
  if ((s.skipped  || 0) > 0) toast(`${s.skipped} duplicate${s.skipped > 1 ? 's' : ''} skipped.`, 'info');
}

function discShowImportSummary(s) {
  const el  = document.getElementById('disc-import-summary');
  const imp = s.imported || 0, skp = s.skipped || 0, fail = s.failed || 0;
  el.innerHTML = `<strong>Import complete:</strong> ${imp} imported, ${skp} duplicate${skp !== 1 ? 's' : ''} skipped${fail > 0 ? `, ${fail} failed` : ''}.`;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function discUpdateFooter() {
  const el = document.getElementById('disc-footer-right');
  if (el && state.discImportedIds.size > 0) el.textContent = `${state.discImportedIds.size} imported this session`;
}

/* Discovery keyboard shortcut — Enter in the industry/location inputs runs a search.
   (Originally a top-level document.addEventListener registered after discUpdateFooter.) */
function initDiscovery() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const id = document.activeElement?.id;
      if (id === 'disc-industry' || id === 'disc-location') discSearch();
    }
  });
}

export {
  discShowState, checkDiscoverySource, discQuickSearch, discSearch, discApplyFilters, discClearFilters,
  discStars, discRenderTable, discRowCheck, discToggleAll, discGetSelected, discClearSelection,
  discUpdateSelUI, discImportSelected, discImportOne, discImportNoWebsite, discShowImportSummary, discUpdateFooter,
  initDiscovery,
};