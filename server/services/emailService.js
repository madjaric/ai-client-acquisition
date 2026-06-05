/**
 * services/emailService.js
 *
 * Resend-API-based email sending service.
 * Transport: Resend HTTP API (port 443 — not blocked by Render egress policy).
 *
 * Features:
 *   - Singleton Resend client
 *   - Configuration check on first use
 *   - Retry logic (up to 3 attempts with backoff)
 *   - Full DB logging of every send attempt
 *   - HTML + plaintext fallback support
 *   - Optional reply-to, cc, attachments
 *
 * Required .env variables:
 *   RESEND_API_KEY    Resend API key (re_...)
 *   EMAIL_FROM        Verified sender, e.g. "AI Acquisition System <hi@yourdomain.com>"
 *                     (or set GMAIL_FROM_NAME + a verified EMAIL_FROM_ADDRESS)
 *
 * Optional .env variables:
 *   GMAIL_FROM_NAME     Displayed sender name (default: "AI Acquisition System")
 *   EMAIL_FROM_ADDRESS  Verified sender address if EMAIL_FROM not given
 *   EMAIL_MAX_RETRIES   Number of retry attempts (default: 3)
 *   EMAIL_RETRY_DELAY_MS  Base backoff ms (default: 1000)
 */

"use strict";

const { Resend }     = require("resend");
const { getDb }      = require("../db/connection");
const { v4: uuidv4 } = require("uuid");

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────
const MAX_RETRIES      = parseInt(process.env.EMAIL_MAX_RETRIES   || "3",    10);
const RETRY_DELAY_MS   = parseInt(process.env.EMAIL_RETRY_DELAY_MS || "1000", 10);
const FROM_NAME        = process.env.GMAIL_FROM_NAME || "AI Acquisition System";

// ─────────────────────────────────────────────
//  RESEND CLIENT SINGLETON
//  Created lazily on first send.
// ─────────────────────────────────────────────
let _client      = null;
let _verified    = false;

function getClient() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new ConfigurationError(
      "Email is not configured. Set RESEND_API_KEY in your .env file.\n" +
      "See: https://resend.com/api-keys"
    );
  }

  if (!_client) {
    console.error("[RESEND] creating client", { hasApiKey: !!apiKey });
    _client = new Resend(apiKey);
  }

  return _client;
}

/** Resolve the verified "from" address Resend will send as. */
function getFromAddress() {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  const addr = process.env.EMAIL_FROM_ADDRESS;
  if (!addr) {
    throw new ConfigurationError(
      "Sender address not configured. Set EMAIL_FROM (e.g. \"Name <hi@domain.com>\") " +
      "or EMAIL_FROM_ADDRESS to a domain verified in Resend."
    );
  }
  return `"${FROM_NAME}" <${addr}>`;
}

/**
 * Verify email is configured.
 * NOTE: Resend has no connection-test endpoint, so this confirms the API key
 * is present — it does NOT validate that the key is accepted. An invalid key
 * will only surface on the first real sendEmail() call.
 * @returns {Promise<void>}
 */
async function verifyConnection() {
  if (_verified) return;
  console.error("[RESEND] verify ENTER");
  getClient();          // throws ConfigurationError if RESEND_API_KEY missing
  getFromAddress();     // throws ConfigurationError if sender not configured
  _verified = true;
  console.error("[RESEND] verify SUCCESS (config present; key not validated until first send)");
}

// ─────────────────────────────────────────────
//  CUSTOM ERROR TYPES
// ─────────────────────────────────────────────
class ConfigurationError extends Error {
  constructor(msg) { super(msg); this.name = "ConfigurationError"; this.code = "EMAIL_NOT_CONFIGURED"; }
}
class SendError extends Error {
  constructor(msg, cause) {
    super(msg); this.name = "SendError"; this.code = "EMAIL_SEND_FAILED"; this.cause = cause;
  }
}

// ─────────────────────────────────────────────
//  RETRY HELPER
// ─────────────────────────────────────────────
async function withRetry(fn, maxRetries = MAX_RETRIES) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      // Don't retry on configuration or validation errors
      if (err.code === "EMAIL_NOT_CONFIGURED" || err.responseCode === 550) throw err;

      if (attempt < maxRetries) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // exponential backoff
        console.warn(`  ⚠️  Email attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...`);
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }
  throw new SendError(`Email failed after ${maxRetries} attempts: ${lastError.message}`, lastError);
}

// ─────────────────────────────────────────────
//  CORE SEND FUNCTION
// ─────────────────────────────────────────────

/**
 * @typedef {object} SendOptions
 * @property {string}   to              Recipient email address
 * @property {string}   subject         Email subject line
 * @property {string}   body            Plain-text body (always required)
 * @property {string}   [html]          Optional HTML body (falls back to <body> if omitted)
 * @property {string}   [replyTo]       Reply-to address
 * @property {string[]} [cc]            CC recipients
 * @property {string}   [leadId]        Lead UUID to link in email_logs
 * @property {string}   [campaignId]    Campaign UUID to link in email_logs
 * @property {string}   [messageId]     Generated-message UUID to link
 * @property {string}   [source]        Free-text source label (e.g. "manual","campaign","test")
 */

/**
 * Send an email and log the result to the database.
 *
 * @param {SendOptions} options
 * @returns {Promise<EmailLogRow>} The saved log row
 */
async function sendEmail(options) {
  const {
    to, subject, body,
    html, replyTo, cc,
    leadId, campaignId, messageId,
    source = "manual",
  } = options;

  // ── Input validation ──
  if (!to      || typeof to      !== "string") throw new TypeError("to (recipient email) is required.");
  if (!subject || typeof subject !== "string") throw new TypeError("subject is required.");
  if (!body    || typeof body    !== "string") throw new TypeError("body is required.");

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(to.trim())) {
    throw new TypeError(`Invalid recipient email address: "${to}"`);
  }

  // ── Verify configuration once ──
  await verifyConnection();

  const fromAddress = getFromAddress();
  const logId       = uuidv4();
  let   smtpMessageId = null;

  // ── Send with retry ──
  try {
    const info = await withRetry(async (attempt) => {
      console.log(`  📤 Sending email to ${to} (attempt ${attempt})...`);
      console.error("[RESEND] send ENTER");
      const { data, error } = await getClient().emails.send({
        from    : fromAddress,
        to      : to.trim(),
        subject : subject.trim(),
        text    : body,
        html    : html || plainToHtml(body),
        replyTo : replyTo || undefined,
        cc      : cc?.length ? cc : undefined,
        headers : {
          "X-ACQS-Log-ID" : logId,  // useful for tracing
        },
      });
      if (error) {
        // Normalise Resend's error object into a throwable Error for withRetry.
        const e = new Error(error.message || "Resend send failed");
        e.code = error.name || "RESEND_ERROR";
        e.statusCode = error.statusCode;
        throw e;
      }
      console.error("[RESEND] send SUCCESS", data?.id);
      return { messageId: data?.id };
    });

    smtpMessageId = info.messageId;
    console.log(`  ✅ Email sent to ${to} (${smtpMessageId})`);

    // ── Log success ──
    return logEmail({
      id              : logId,
      to, subject, body,
      status          : "sent",
      smtp_message_id : smtpMessageId,
      leadId, campaignId, messageId, source,
    });

  } catch (err) {
    // ── Log failure ──
    console.error("[RESEND] send FAILED", err);
    await logEmail({
      id              : logId,
      to, subject, body,
      status          : "failed",
      error_message   : err.message,
      leadId, campaignId, messageId, source,
    });

    throw err; // re-throw so the route can respond with 502
  }
}

// ─────────────────────────────────────────────
//  DATABASE LOGGING
// ─────────────────────────────────────────────

function logEmail({ id, to, subject, body, status, smtp_message_id, error_message, leadId, campaignId, messageId, source }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO email_logs (
      id, to_address, subject, body,
      status, smtp_message_id, error_message,
      lead_id, campaign_id, generated_message_id, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, to, subject, body,
    status,
    smtp_message_id  || null,
    error_message    || null,
    leadId           || null,
    campaignId       || null,
    messageId        || null,
    source,
  );

  return getEmailLogById(id);
}

function getEmailLogById(id) {
  return getDb().prepare("SELECT * FROM email_logs WHERE id = ?").get(id);
}

function getEmailLogs({ status, leadId, campaignId, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const conditions = [];
  const params     = [];

  if (status)     { conditions.push("status = ?");      params.push(status); }
  if (leadId)     { conditions.push("lead_id = ?");     params.push(leadId); }
  if (campaignId) { conditions.push("campaign_id = ?"); params.push(campaignId); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.prepare(
    `SELECT * FROM email_logs ${where} ORDER BY sent_at DESC LIMIT ? OFFSET ?`
  ).all(...params, Number(limit), Number(offset));

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM email_logs ${where}`)
    .get(...params);

  return { logs: rows, total };
}

function getEmailStats() {
  const db = getDb();
  return {
    total    : db.prepare("SELECT COUNT(*) AS n FROM email_logs").get().n,
    sent     : db.prepare("SELECT COUNT(*) AS n FROM email_logs WHERE status = 'sent'").get().n,
    failed   : db.prepare("SELECT COUNT(*) AS n FROM email_logs WHERE status = 'failed'").get().n,
    today    : db.prepare("SELECT COUNT(*) AS n FROM email_logs WHERE DATE(sent_at) = DATE('now')").get().n,
  };
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

/** Wrap plain text in minimal HTML for email clients that prefer HTML */
function plainToHtml(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>\n");
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:600px">${escaped}</body></html>`;
}

/** Force-reset the Resend client (useful after credential changes) */
function resetTransporter() {
  _client   = null;
  _verified = false;
}

module.exports = {
  sendEmail,
  verifyConnection,
  getEmailLogById,
  getEmailLogs,
  getEmailStats,
  resetTransporter,
  ConfigurationError,
  SendError,
};