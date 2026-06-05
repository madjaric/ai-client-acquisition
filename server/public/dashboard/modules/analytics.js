/* ═══════════════════════════════════════════════════════════════
   modules/analytics.js — pipeline analytics dashboard rendering
   ═══════════════════════════════════════════════════════════════ */

import { apiFetch } from '../core/api.js';
import { esc } from '../utils/formatters.js';

async function loadPipelineAnalytics() {
  const analyticsBody = document.getElementById('analytics-body');
  const refreshBtn    = document.getElementById('btn-refresh-analytics');
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.innerHTML = '<span class="spinner dark"></span>'; }

  try {
    const d = await apiFetch('GET', '/api/pipeline/analytics');

    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
    }

    // Not authenticated — show sign-in prompt instead of silent fail
    if (!d.success && d.message && d.message.includes('sign in')) {
      if (analyticsBody) {
        analyticsBody.innerHTML = `<div style="text-align:center;padding:24px 0">
          <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">Sign in to unlock pipeline analytics</div>
          <a href="/login.html" class="btn btn-brand btn-sm">Sign In →</a>
        </div>`;
      }
      return;
    }
    if (!d.success) {
      console.warn('Analytics load failed:', d.message);
      return;
    }

    const data = d.data;

    // Lead distribution
    const ld = data.lead_distribution || {};
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('ana-total',     ld.total     || 0);
    setEl('ana-contacted', ld.contacted || 0);
    setEl('ana-replied',   ld.replied   || 0);
    setEl('ana-qualified', ld.qualified || 0);
    setEl('ana-converted', ld.converted || 0);

    // Website opportunities
    const wo = data.website_opportunity_metrics || {};
    setEl('ana-with-website', wo.with_website || 0);
    setEl('ana-no-website',   wo.without_website || 0);
    setEl('ana-wo-score',     (wo.website_opportunity_score || 0) + '%');
    setEl('ana-wo-revenue',   wo.estimated_website_revenue ? '$' + Number(wo.estimated_website_revenue).toLocaleString() : '—');

    // AI Insights
    const ins = data.ai_insights || {};
    const hv  = ins.highest_value_lead;
    if (hv) {
      setEl('insight-hv-name', hv.business_name || '—');
      setEl('insight-hv-val',  hv.value_range || '');
    }
    const wo2 = ins.highest_website_opportunity;
    if (wo2) {
      setEl('insight-wo-name',  wo2.business_name || '—');
      setEl('insight-wo-score', wo2.wo_score ? wo2.wo_score + '/100' : '');
    }
    const fc = ins.fastest_conversion;
    if (fc) {
      setEl('insight-fc-name', fc.business_name || '—');
      window._fastestConversionId = fc.id;
      const btn = document.getElementById('insight-fc-btn');
      if (btn && fc.id) btn.style.display = '';
    }
    setEl('insight-industry', ins.most_responsive_industry || '—');

    // Revenue Projection
    const rev = data.revenue_projection || {};
    setEl('rev-potential', rev.potential_revenue            ? '$' + Number(rev.potential_revenue).toLocaleString()                 : '—');
    setEl('rev-monthly',   rev.monthly_recurring_opportunity ? '$' + Number(rev.monthly_recurring_opportunity).toLocaleString() + '/mo' : '—');
    setEl('rev-close',     rev.estimated_close_value        ? '$' + Number(rev.estimated_close_value).toLocaleString()            : '—');

    // Contact Coverage
    const cc = data.contact_coverage || {};
    setEl('ana-cc-email',   cc.with_email   ?? '—');
    setEl('ana-cc-phone',   cc.with_phone   ?? '—');
    setEl('ana-cc-website', cc.with_website ?? '—');

    const pct = cc.contact_coverage_pct ?? 0;
    const pctEl  = document.getElementById('cc-coverage-pct');
    const barEl  = document.getElementById('cc-coverage-bar');
    if (pctEl) pctEl.textContent = pct + '%';
    if (barEl) barEl.style.width = pct + '%';

    // Email source breakdown
    const sources = data.email_source_breakdown || [];
    const srcWrap = document.getElementById('ana-email-sources');
    const srcList = document.getElementById('ana-email-sources-list');
    if (srcList && sources.length) {
      const sourceLabels = {
        extensions      : 'Google Extensions',
        place_info      : 'Place Info',
        knowledge_graph : 'Knowledge Graph',
        description_regex: 'Description Text',
      };
      srcList.innerHTML = sources.map(s =>
        `<span style="background:var(--bg-3);border:1px solid var(--border);padding:1px 6px;border-radius:3px;font-size:9px">${esc(sourceLabels[s.email_source]||s.email_source)}: ${s.count}</span>`
      ).join('');
      if (srcWrap) srcWrap.style.display = '';
    }
  } catch(e) {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
    }
    console.warn('Analytics load failed:', e.message);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   LEAD INTELLIGENCE PANEL
───────────────────────────────────────────────────────────────────────── */

export {
  loadPipelineAnalytics,
};
