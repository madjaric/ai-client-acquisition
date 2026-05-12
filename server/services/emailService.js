/**
 * services/emailService.js
 *
 * Nodemailer-based email sending service.
 * Transport: Gmail SMTP (port 465 SSL or 587 STARTTLS).
 *
 * Features:
 *   - Singleton transporter with keep-alive pooling
 *   - Connection verification on first use
 *   - Retry logic (up to 3 attempts with backoff)
 *   - Full DB logging of every send attempt
 *   - HTML + plaintext fallback support
 *   - Optional reply-to, cc, attachments
 *
 * Required .env variables:
 *   GMAIL_USER        your.address@gmail.com
 *   GMAIL_APP_PASSWORD  16-char Google App Password (NOT your Gmail login password)
 *
 * Optional .env variables:
 *   GMAIL_FROM_NAME   Displayed sender name (default: "AI Acquisition System")
 *   EMAIL_MAX_RETRIES Number of retry attempts (default: 3)
 *   EMAIL_RETRY_DELAY_MS  Base backoff ms (default: 1000)
 */

"use strict";

const nodemailer = require("nodemailer");
const { getDb }      = require("../db/connection");
const { v4: uuidv4 } = require("uuid");

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────
const MAX_RETRIES      = parseInt(process.env.EMAIL_MAX_RETRIES   || "3",    10);
const RETRY_DELAY_MS   = parseInt(process.env.EMAIL_RETRY_DELAY_MS || "1000", 10);
const FROM_NAME        = process.env.GMAIL_FROM_NAME || "AI Acquisition System";

// ─────────────────────────────────────────────
//  TRANSPORTER SINGLETON
//  Created lazily on first send. Pooled for reuse.
// ─────────────────────────────────────────────
let _transporter = null;
let _verified    = false;

function getTransporter() {
  const user     = process.env.GMAIL_USER;
  const password = process.env.GMAIL_APP_PASSWORD;

  if (!user || !password) {
    throw new ConfigurationError(
      "Email is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in your .env file.\n" +
      "See: https://myaccount.google.com/apppasswords"
    );
  }

  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host   : "smtp.gmail.com",
      port   : 465,
      secure : true,            // SSL — use port 587 + starttls if needed
      auth   : { user, pass: password },
      pool   : true,            // keep connections alive between sends
      maxConnections : 3,
      maxMessages    : 100,
      rateDelta      : 1000,    // max N messages per rateDelta ms
      rateLimit      : 5,       // max 5 emails/second (well within Gmail limits)
    });
  }

  return _transporter;
}

/**
 * Verify the SMTP connection is healthy.
 * Called automatically before first send; cached after success.
 * @returns {Promise<void>}
 */
async function verifyConnection() {
  if (_verified) return;
  const transporter = getTransporter();
  await transporter.verify();   // throws if credentials are wrong
  _verified = true;
  console.log("  ✅ Gmail SMTP connection verified.");
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

  // ── Verify connection once ──
  await verifyConnection();

  const fromAddress = `"${FROM_NAME}" <${process.env.GMAIL_USER}>`;
  const logId       = uuidv4();
  let   smtpMessageId = null;

  // ── Send with retry ──
  try {
    const info = await withRetry(async (attempt) => {
      console.log(`  📤 Sending email to ${to} (attempt ${attempt})...`);
      return getTransporter().sendMail({
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
    console.error(`  ❌ Email to ${to} failed: ${err.message}`);
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

/** Force-reset the transporter (useful after credential changes) */
function resetTransporter() {
  if (_transporter) { _transporter.close(); _transporter = null; }
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
