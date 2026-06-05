/* ═══════════════════════════════════════════════════════════════
   app.js — application entry point
   ───────────────────────────────────────────────────────────────
   • Navigation, onboarding banner, sidebar user block, search quota
   • Upgrade modal
   • window bridge: exposes ONLY the functions referenced by inline
     on* handlers in the HTML and in dynamically-built markup, so the
     existing inline handlers keep working unchanged under ES modules.
   • init(): the original bootstrap sequence, run on DOMContentLoaded.
   ═══════════════════════════════════════════════════════════════ */

import { state } from './core/state.js';
import { apiFetch, checkConnection } from './core/api.js';
import { loadPipelineAnalytics } from './modules/analytics.js';
import { checkDiscoverySource, discApplyFilters, discClearFilters, discClearSelection, discImportNoWebsite, discImportOne, discImportSelected, discQuickSearch, discRowCheck, discSearch, discToggleAll, initDiscovery } from './modules/discovery.js';
import { closeLeadIntelligence, copyLiEmail, filterLeads, initLeadIntelligence, liShowEmail, loadLeads, loadScoredLeads, openLeadIntelligence, promptLeadEmail, quickScore, refreshSelects, scoreLead, setContactFilter, showScoredDetail } from './modules/leads.js';
import { clearEmailForm, doSendEmail, generateOutreach, loadEmailLogs, loadEmailSelects, loadEmailStats, loadHistoricMessage, loadOutreachHistory, prefillFromMessage, quickOutreach, sendOutreachToEmail, verifySMTP } from './modules/outreach.js';
import { generateWebsiteForLead, iwgAddEditService, iwgApplyEdits, iwgClose, iwgCopyHtml, iwgDownload, iwgGenerate, iwgMarkDirty, iwgRegen, iwgRemoveEditSvc, iwgResetEdits, iwgTab, iwgTrigger, pmTab, scoreToOutreachWithPreview, scoreToWebsiteAndOutreach, woCloseGeneratorModal, woCloseProject, woCopyHtml, woDownload, woEditWebsite, woGenDownload, woGenOpenProject, woGenerateFromModal, woGenerateFromOpp, woMarkSent, woMarkWon, woOpenFullPreview, woOpenProject, woQuickDownload, woRegenWebsite, woRunGenerate, woUpdateStatus, woppFilterStage, woppInit, woppRefresh, woppRenderTable, woppSyncFromDisc, woppSyncFromLeads, woppUpdateStats } from './modules/website.js';
import { closeSidebar, copyText, openSidebar, toast } from './utils/dom.js';

/* ─── App-level UI: navigation, onboarding, user block, quota, upgrade modal ─── */
function navigate(page) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sb-item').forEach(a => a.classList.remove('active'));

  const panel = document.getElementById(`panel-${page}`);
  const navBtn = document.getElementById(`nav-${page}`);
  if (panel) panel.classList.add('active');
  if (navBtn) navBtn.classList.add('active');

  const meta = state.PAGE_META[page] || {};
  const titleEl = document.getElementById('topbar-title');
  const subEl   = document.getElementById('topbar-sub');
  if (titleEl) titleEl.textContent = meta.title || page;
  if (subEl)   subEl.textContent   = meta.sub   || '';

  window.scrollTo({ top: 0, behavior: 'smooth' });
  closeSidebar();

  if (page === 'leads')     { loadLeads(); refreshSelects(); }
  if (page === 'scoring')   { loadScoredLeads(); refreshSelects(); }
  if (page === 'outreach')  { loadOutreachHistory(); refreshSelects(); }
  if (page === 'email')     { loadEmailStats(); loadEmailLogs(); loadEmailSelects(); }
  if (page === 'discovery') { checkDiscoverySource(); }
  if (page === 'wopp')      { if (typeof woppSyncFromLeads==='function') woppSyncFromLeads(); woppSyncFromDisc(); woppUpdateStats(); woppRenderTable(); }
}

/* ─── Mobile sidebar ─────────────────────────── */

function dismissOnboarding() {
  localStorage.setItem('lf_ob_dismissed', '1');
  const el = document.getElementById('onboarding-banner');
  if (el) el.style.display = 'none';
}

function initOnboarding() {
  if (localStorage.getItem('lf_ob_dismissed')) {
    const el = document.getElementById('onboarding-banner');
    if (el) el.style.display = 'none';
  }
}

/* ─── Leads ─────────────────────────────────── */

function initUserBlock() {
  const user       = window.LF_USER;
  const signinBtn  = document.getElementById('sb-signin-btn');
  const logoutBtn  = document.getElementById('sb-logout-btn');
  const userBlock  = document.getElementById('sb-user-block');
  const upgradeBtn = document.getElementById('sb-upgrade-btn');

  if (!user) {
    // Guest — show Sign In, hide user block and logout
    if (signinBtn)  signinBtn.style.display  = 'flex';
    if (logoutBtn)  logoutBtn.style.display  = 'none';
    if (userBlock)  userBlock.style.display  = 'none';
    if (upgradeBtn) upgradeBtn.style.display = 'none';
    return;
  }

  // Logged in — hide Sign In, show user info and logout
  if (signinBtn)  signinBtn.style.display  = 'none';
  if (logoutBtn)  logoutBtn.style.display  = 'flex';
  if (userBlock)  userBlock.style.display  = '';

  const initials = (user.email || '?').substring(0, 2).toUpperCase();
  const avatarEl = document.getElementById('sb-avatar');
  const nameEl   = document.getElementById('sb-user-name');
  const planEl   = document.getElementById('sb-user-plan');
  if (avatarEl) avatarEl.textContent = initials;
  if (nameEl)   nameEl.textContent   = user.email;
  if (planEl)   planEl.textContent   = (user.plan || 'free').toUpperCase();

  if (upgradeBtn && user.plan === 'free') {
    upgradeBtn.style.display = 'flex';
    upgradeBtn.addEventListener('click', () => openUpgradeModal());
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('lf_token');
      localStorage.removeItem('lf_user');
      window.location.href = '/login.html';
    });
  }
}

/* ─── Auth: load + display search quota ─────── */

async function loadQuota() {
  try {
    const res  = await fetch('/api/discovery/quota', { headers: window.LF_HEADERS });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success || !data.quota) return;

    const { used, limit, plan } = data.quota;
    const quotaEl = document.getElementById('sb-quota');
    if (!quotaEl) return;

    if (limit === null) {
      // Unlimited (agency)
      quotaEl.textContent = `${used} searches`;
      return;
    }

    quotaEl.textContent = `${used}/${limit} searches`;
    const pct = used / limit;
    quotaEl.className = 'sb-quota' + (pct >= 1 ? ' full' : pct >= 0.8 ? ' warn' : '');

    // Also update discovery panel counter if it exists
    const discQuotaEl = document.getElementById('disc-quota-display');
    if (discQuotaEl) {
      discQuotaEl.textContent = limit === null
        ? `${used} searches used`
        : `${used} / ${limit} searches used this month`;
    }
  } catch(e) {
    console.warn('Could not load quota:', e);
  }
}

/* ─── Upgrade Modal ──────────────────────────────── */

function openUpgradeModal(reason) {
  const modal = document.getElementById('upgrade-modal');
  const sub   = document.getElementById('upgrade-modal-sub');
  if (sub) sub.textContent = reason || 'Unlock more searches, emails, and AI features.';

  // Mark current plan card
  modal.querySelectorAll('.plan-cta.free').forEach(btn => {
    const plan = window.LF_USER?.plan || 'free';
    btn.textContent = plan === 'free' ? 'Current plan' : '✓ Active';
  });

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeUpgradeModal() {
  document.getElementById('upgrade-modal').classList.remove('open');
  document.body.style.overflow = '';
}

async function handleUpgradeClick(plan) {
  const btn = document.querySelector(`.plan-cta.${plan}`);
  const labels = {
    starter: 'Upgrade to Starter →',
    pro    : 'Start Pro — 14 days free →',
    agency : 'Start Agency →',
  };
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Redirecting…'; }

  try {
    const d = await apiFetch('POST', '/api/payments/create-checkout', { plan });
    if (d.success && d.url) {
      window.location.href = d.url;
    } else {
      toast(d.message || 'Payments not configured yet. Contact support.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = labels[plan] || 'Upgrade'; }
    }
  } catch (err) {
    toast('Could not start checkout. Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = labels[plan] || 'Upgrade'; }
  }
}

/* Upgrade-modal keyboard shortcut — Escape closes it.
   (Originally a top-level document.addEventListener after closeUpgradeModal.) */
function initUpgradeModal() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeUpgradeModal();
  });
}

/* ─── Exports consumed by other modules ─── */
export { navigate, openUpgradeModal };

/* ═══════════════════════════════════════════════════════════════
   WINDOW BRIDGE
   Inline on* handlers in index/dashboard markup (static and
   dynamically generated) resolve against the global scope. ES
   modules are scoped, so we explicitly re-expose exactly the
   functions those handlers call — nothing more.
   ═══════════════════════════════════════════════════════════════ */
Object.assign(window, {
  // app.js
  closeUpgradeModal, dismissOnboarding, handleUpgradeClick, navigate,
  // modules/analytics.js
  loadPipelineAnalytics,
  // modules/discovery.js
  discApplyFilters, discClearFilters, discClearSelection, discImportNoWebsite, discImportOne, discImportSelected,
  discQuickSearch, discRowCheck, discSearch, discToggleAll,
  // modules/leads.js
  closeLeadIntelligence, copyLiEmail, filterLeads, liShowEmail, loadLeads, loadScoredLeads,
  openLeadIntelligence, promptLeadEmail, quickScore, scoreLead, setContactFilter, showScoredDetail,
  // modules/outreach.js
  clearEmailForm, doSendEmail, generateOutreach, loadEmailLogs, loadHistoricMessage, loadOutreachHistory,
  prefillFromMessage, quickOutreach, sendOutreachToEmail, verifySMTP,
  // modules/website.js
  generateWebsiteForLead, iwgAddEditService, iwgApplyEdits, iwgClose, iwgCopyHtml, iwgDownload,
  iwgGenerate, iwgMarkDirty, iwgRegen, iwgRemoveEditSvc, iwgResetEdits, iwgTab,
  iwgTrigger, pmTab, scoreToOutreachWithPreview, scoreToWebsiteAndOutreach, woCloseGeneratorModal, woCloseProject,
  woCopyHtml, woDownload, woEditWebsite, woGenDownload, woGenOpenProject, woGenerateFromModal,
  woGenerateFromOpp, woMarkSent, woMarkWon, woOpenFullPreview, woOpenProject, woQuickDownload,
  woRegenWebsite, woRunGenerate, woUpdateStatus, woppFilterStage, woppRefresh, woppRenderTable,
  // utils/dom.js
  closeSidebar, copyText, openSidebar,
});

/* ═══════════════════════════════════════════════════════════════
   BOOTSTRAP — original top-level call sequence, plus the three
   keydown listeners that were previously registered inline.
   ═══════════════════════════════════════════════════════════════ */
function init() {
  // keydown listeners (formerly standalone document.addEventListener calls)
  initUpgradeModal();
  initDiscovery();
  initLeadIntelligence();

  // original bootstrap sequence (verbatim order)
  initUserBlock();
  initOnboarding();
  checkConnection();
  setInterval(checkConnection, 30000);
  loadLeads();
  loadScoredLeads();
  loadOutreachHistory();
  loadQuota();
  woppInit();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
