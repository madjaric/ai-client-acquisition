/* ═══════════════════════════════════════════════════════════════
   modules/outreach.js — outreach generator + email send/log workflow
   ═══════════════════════════════════════════════════════════════ */

import { state } from '../core/state.js';
import { navigate } from '../app.js';
import { apiFetch } from '../core/api.js';
import { loadLeads } from './leads.js';
import { setBtn, toast } from '../utils/dom.js';
import { esc, scoreBar } from '../utils/formatters.js';

async function generateOutreach() {
  const leadId = document.getElementById('out-select').value;
  const tone   = document.getElementById('out-tone').value;
  if (!leadId) { toast('Select a lead first.', 'error'); return; }

  // Auto-detect preview state for this lead
  const hasPreview = !!(window._leadPreviewReady?.[leadId]);
  const previewUrl = window._leadPreviewUrls?.[leadId] || null;

  setBtn('btn-generate', true, 'Generating…');
  const body = { lead_id: leadId };
  if (tone)        body.tone_override        = tone;
  if (hasPreview)  body.websitePreviewExists  = true;
  if (previewUrl)  body.preview_url           = previewUrl;
  const d = await apiFetch('POST', '/api/generate-outreach', body);
  setBtn('btn-generate', false, `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Generate All Formats`);

  if (!d.success) { toast(d.message || 'Generation failed.', 'error'); return; }

  const msg = d.data?.message || d.data || {};
  renderOutreachResult(msg);
  loadOutreachHistory();
  if (hasPreview && previewUrl) {
    toast('Email generated — website preview URL included!', 'success');
  } else if (hasPreview) {
    toast('Email generated with website preview reference!', 'success');
  } else {
    toast('Email + DM generated and saved.', 'success');
  }

  // Mark onboarding step 3 done
  const s3 = document.getElementById('obs-3');
  if (s3) s3.classList.add('done');
}

function renderOutreachResult(msg) {
  const panel = document.getElementById('out-result');
  panel.classList.add('visible');
  document.getElementById('out-subject').textContent    = msg.subject_line || '—';
  document.getElementById('out-email-body').textContent = msg.email_body   || '—';
  document.getElementById('out-dm').textContent         = msg.short_dm || msg.cta || '—';
  document.getElementById('out-notes').textContent      = msg.personalization_notes || '—';

  // Store for sendOutreachToEmail()
  panel.dataset.msgSubject = msg.subject_line || '';
  panel.dataset.msgBody    = msg.email_body   || '';
  panel.dataset.msgId      = msg.id           || '';
  panel.dataset.msgLeadId  = msg.lead_id      || '';

  // Show Call Lead button if lead has phone
  const callBtn = document.getElementById('btn-call-lead');
  if (callBtn) {
    const lead = msg.lead_id ? state.allLeads.find(l => String(l.id) === String(msg.lead_id)) : null;
    const phone = lead?.phone_normalized || lead?.phone || '';
    if (phone) {
      callBtn.href = `tel:${phone}`;
      callBtn.textContent = `📞 ${lead.phone}`;
      callBtn.style.display = 'inline-flex';
    } else {
      callBtn.style.display = 'none';
    }
  }

  // Engine badge
  const engineBadge = document.getElementById('out-engine-badge');
  if (engineBadge) {
    const engine = msg.engine || (msg.model && msg.model.includes('engine-A') ? 'A' : msg.model && msg.model.includes('engine-B') ? 'B' : null);
    if (engine) {
      engineBadge.style.display = '';
      engineBadge.textContent   = engine === 'A' ? 'Engine A · Has Website' : 'Engine B · No Website';
      engineBadge.style.background = engine === 'A' ? 'var(--blue-dim)' : 'var(--amber-dim)';
      engineBadge.style.color      = engine === 'A' ? 'var(--blue)' : 'var(--amber)';
      engineBadge.style.borderColor = engine === 'A' ? 'var(--blue-mid)' : 'var(--amber-mid)';
    } else {
      engineBadge.style.display = 'none';
    }
  }

  // Follow-up sequence
  const seqEl = document.getElementById('out-followup-sequence');
  if (seqEl) {
    const hasFollowups = msg.follow_up_day3 || msg.follow_up_day7 || msg.follow_up_day14;
    if (hasFollowups) {
      seqEl.style.display = '';
      const d3 = document.getElementById('out-seq-day3');   if (d3) d3.textContent = msg.follow_up_day3  || '—';
      const d7 = document.getElementById('out-seq-day7');   if (d7) d7.textContent = msg.follow_up_day7  || '—';
      const d14 = document.getElementById('out-seq-day14'); if (d14) d14.textContent = msg.follow_up_day14 || '—';
    } else {
      seqEl.style.display = 'none';
    }
  }
}

async function loadOutreachHistory() {
  const d    = await apiFetch('GET', '/api/generate-outreach?limit=30');
  const list = d.data || [];
  const count = d.meta?.total ?? list.length;
  document.getElementById('history-count').textContent = count ? `${count} total` : '';

  const tbody = document.getElementById('history-tbody');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty">
      <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
      <div class="empty-title">No messages yet</div>
      <div class="empty-desc">Generate your first email to see history here.</div>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(m => `
    <tr style="cursor:pointer" onclick="loadHistoricMessage('${m.id}')">
      <td><strong style="font-size:13px">${esc(m.business_name||'—')}</strong><div style="font-size:11px;color:var(--text-3)">${esc(m.industry||'')}</div></td>
      <td style="font-size:12px;color:#60a5fa;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.subject_line||'—')}</td>
      <td>${m.lead_score_at_generation ? scoreBar(m.lead_score_at_generation) : `<span style="color:var(--text-3);font-size:11px">—</span>`}</td>
      <td style="font-family:var(--fm);font-size:11px;color:var(--text-3)">${m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}</td>
    </tr>`).join('');
}

async function loadHistoricMessage(id) {
  const d = await apiFetch('GET', `/api/generate-outreach/${id}`);
  if (!d.success) return;
  renderOutreachResult(d.data);
  document.getElementById('out-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function quickOutreach(leadId) {
  navigate('outreach');
  setTimeout(() => { const sel = document.getElementById('out-select'); if (sel) sel.value = leadId; }, 120);
}

/**
 * sendOutreachToEmail()
 * Takes the currently displayed outreach message and navigates to
 * the Send Email panel with all fields pre-populated.
 */

function sendOutreachToEmail() {
  const panel   = document.getElementById('out-result');
  const subject = panel?.dataset.msgSubject || document.getElementById('out-subject')?.textContent || '';
  const body    = panel?.dataset.msgBody    || document.getElementById('out-email-body')?.textContent || '';
  const leadId  = panel?.dataset.msgLeadId  || '';

  if (!subject || subject === '—') {
    toast('Generate an outreach email first.', 'error'); return;
  }

  // Find lead email
  const lead = leadId ? state.allLeads.find(l => String(l.id) === String(leadId)) : null;
  const leadEmail = lead?.email || '';

  navigate('email');
  setTimeout(() => {
    // Pre-populate all compose fields
    const toEl      = document.getElementById('email-to');
    const subjectEl = document.getElementById('email-subject');
    const bodyEl    = document.getElementById('email-body');
    const leadSel   = document.getElementById('email-lead-id');

    if (toEl      && leadEmail) toEl.value = leadEmail;
    if (subjectEl) subjectEl.value = subject;
    if (bodyEl)    bodyEl.value    = body;
    if (leadSel && leadId) leadSel.value = leadId;

    // Highlight To field if email missing
    if (toEl && !leadEmail) {
      toEl.focus();
      toEl.style.borderColor = 'var(--amber)';
      setTimeout(() => { if (toEl) toEl.style.borderColor = ''; }, 3000);
      toast('Enter the recipient email address.', 'info');
    } else {
      toast('Email pre-filled from outreach. Review and send!', 'success');
    }
  }, 150);
}

function setOutreachLead() {
  if (!state.lastScoredId) return;
  const sel = document.getElementById('out-select');
  if (sel) sel.value = state.lastScoredId;
}

/* ─── Email panel ────────────────────────────── */

async function loadEmailStats() {
  const d = await apiFetch('GET', '/api/send-email/logs/stats');
  if (!d.success) return;
  const s = d.data;
  document.getElementById('estat-total').textContent  = s.total  ?? '—';
  document.getElementById('estat-sent').textContent   = s.sent   ?? '—';
  document.getElementById('estat-failed').textContent = s.failed ?? '—';
  document.getElementById('estat-today').textContent  = s.today  ?? '—';
}

async function loadEmailSelects() {
  if (!state.allLeads.length) await loadLeads();
  const sel = document.getElementById('email-lead-id');
  if (sel) sel.innerHTML = '<option value="">— none —</option>' +
    state.allLeads.map(l => `<option value="${l.id}">${esc(l.business_name||l.name)} (${esc(l.location||'')})</option>`).join('');

  const msgSel = document.getElementById('email-from-message');
  if (msgSel) {
    const d    = await apiFetch('GET', '/api/generate-outreach?limit=50');
    const msgs = d.data || [];
    msgSel.innerHTML = '<option value="">— select generated message —</option>' +
      msgs.map(m => {
        // Find the lead to get their email
        const lead = state.allLeads.find(l => String(l.id) === String(m.lead_id));
        const leadEmail = lead?.email || '';
        const leadId    = m.lead_id  || '';
        return `<option value="${m.id}"
          data-subject="${esc(m.subject_line)}"
          data-body="${esc(m.email_body)}"
          data-lead-id="${esc(String(leadId))}"
          data-email="${esc(leadEmail)}"
        >${esc(m.business_name||'Lead')} — ${esc(m.subject_line?.slice(0,45)||'')}${leadEmail ? ' ✉' : ''}</option>`;
      }).join('');
  }
}

function prefillFromMessage() {
  const sel = document.getElementById('email-from-message');
  const opt = sel?.options[sel.selectedIndex];
  if (!opt || !opt.value) return;
  document.getElementById('email-subject').value = opt.dataset.subject || '';
  document.getElementById('email-body').value    = opt.dataset.body?.replace(/\\n/g,'\n') || '';

  // Auto-fill recipient email if the lead has an email stored
  const leadId = opt.dataset.leadId;
  if (leadId) {
    document.getElementById('email-lead-id').value = leadId;
    const lead = state.allLeads.find(l => String(l.id) === String(leadId));
    if (lead && lead.email) {
      document.getElementById('email-to').value = lead.email;
    }
  }
}

async function doSendEmail() {
  const to      = document.getElementById('email-to').value.trim();
  const subject = document.getElementById('email-subject').value.trim();
  const body    = document.getElementById('email-body').value.trim();
  const replyTo = document.getElementById('email-reply-to').value.trim();
  const leadId  = document.getElementById('email-lead-id').value;

  if (!to || !subject || !body) { toast('To, subject, and body are required.', 'error'); return; }

  const btn = document.getElementById('btn-send-email');
  const statusMsg = document.getElementById('send-status-msg');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
  statusMsg.textContent = '';

  const payload = { to, subject, body, source: 'manual' };
  if (replyTo) payload.reply_to = replyTo;
  if (leadId)  payload.lead_id  = leadId;

  const d = await apiFetch('POST', '/api/send-email', payload);
  btn.disabled = false;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send Email`;

  if (d.success) {
    toast('Email sent successfully.', 'success');
    statusMsg.innerHTML = `<span style="color:var(--brand);font-family:var(--fm);font-size:11px">✓ Sent · ${new Date().toLocaleTimeString()}</span>`;
    clearEmailForm(); loadEmailStats(); loadEmailLogs();
  } else {
    toast(d.message || 'Send failed.', 'error');
    statusMsg.innerHTML = `<span style="color:var(--red);font-family:var(--fm);font-size:11px">✕ ${esc(d.message||'Failed')}</span>`;
  }
}

async function loadEmailLogs() {
  const status = document.getElementById('email-log-filter')?.value || '';
  const url    = '/api/send-email/logs?limit=30' + (status ? '&status=' + status : '');
  const d      = await apiFetch('GET', url);
  const logs   = d.data || [];

  const tbody = document.getElementById('email-log-body');
  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty">
      <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div>
      <div class="empty-title">No emails logged yet</div>
      <div class="empty-desc">Sent emails will appear here.</div>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = logs.map(l => `
    <tr>
      <td style="font-family:var(--fm);font-size:12px">${esc(l.to_address)}</td>
      <td style="font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.subject)}</td>
      <td>${l.status === 'sent'
        ? '<span class="status-pill pill-sent">sent</span>'
        : '<span class="status-pill pill-failed">failed</span>'}</td>
      <td><span style="font-family:var(--fm);font-size:10px;color:var(--text-3)">${esc(l.source||'manual')}</span></td>
      <td style="font-family:var(--fm);font-size:11px;color:var(--text-3)">${l.sent_at ? new Date(l.sent_at).toLocaleString() : '—'}</td>
      <td>${l.error_message ? `<span title="${esc(l.error_message)}" style="color:var(--red);font-family:var(--fm);font-size:10px;cursor:help">⚠ error</span>` : ''}</td>
    </tr>`).join('');

  loadEmailStats();
}

async function verifySMTP() {
  const btn = document.getElementById('btn-verify-smtp');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  const d = await apiFetch('GET', '/api/send-email/verify');
  btn.disabled = false; btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> Verify SMTP`;
  if (d.success) toast('SMTP connection verified. Ready to send.', 'success');
  else toast('SMTP error: ' + (d.message || 'Check your credentials.'), 'error');
}

function clearEmailForm() {
  ['email-to','email-reply-to','email-subject','email-body'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const sel1 = document.getElementById('email-lead-id');
  const sel2 = document.getElementById('email-from-message');
  if (sel1) sel1.value = ''; if (sel2) sel2.value = '';
}

/* ─── Discovery ─────────────────────────────── */

export {
  generateOutreach, renderOutreachResult, loadOutreachHistory, loadHistoricMessage, quickOutreach, sendOutreachToEmail,
  setOutreachLead, loadEmailStats, loadEmailSelects, prefillFromMessage, doSendEmail, loadEmailLogs,
  verifySMTP, clearEmailForm,
};
