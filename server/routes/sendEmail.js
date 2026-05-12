/**
 * routes/sendEmail.js
 *
 * POST /api/send-email              Send an email (manual compose)
 * POST /api/send-email/from-message Send a previously generated AI message
 * GET  /api/send-email/logs         Paginated email log with filters
 * GET  /api/send-email/logs/stats   Delivery stats summary
 * GET  /api/send-email/logs/:id     Single log entry
 * GET  /api/send-email/verify       Test SMTP connection health
 */

"use strict";

const express      = require("express");
const router       = express.Router();
const emailService = require("../services/emailService");
const outreachGen  = require("../services/outreachGenerator");
const leadsService = require("../services/leadsService");
const { validate, rules } = require("../middleware/validate");

// ─────────────────────────────────────────────
//  Validation schemas
// ─────────────────────────────────────────────
const sendEmailSchema = {
  to: [
    rules.required("Recipient email (to) is required."),
    rules.maxLength(254),
    {
      test   : (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()),
      message: "to must be a valid email address.",
    },
  ],
  subject: [
    rules.required("subject is required."),
    rules.minLength(1, "subject cannot be empty."),
    rules.maxLength(998, "subject must be under 998 characters (RFC 5321)."),
  ],
  body: [
    rules.required("body is required."),
    rules.minLength(1, "body cannot be empty."),
    rules.maxLength(100_000, "body exceeds maximum length."),
  ],
  reply_to : [rules.maxLength(254)],
  lead_id  : [rules.maxLength(100)],
  campaign_id : [rules.maxLength(100)],
  source   : [rules.oneOf(["manual","campaign","test","outreach"], 'source must be: manual, campaign, test, or outreach.')],
};

const fromMessageSchema = {
  message_id : [rules.required("message_id is required.")],
  to         : [
    rules.required("Recipient email (to) is required."),
    rules.maxLength(254),
    {
      test   : (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()),
      message: "to must be a valid email address.",
    },
  ],
  format: [rules.oneOf(["email", "dm"], "format must be 'email' or 'dm'.")],
};

// ─────────────────────────────────────────────
//  POST /api/send-email
//  Compose and send a manual email.
// ─────────────────────────────────────────────
router.post("/", validate(sendEmailSchema), async (req, res) => {
  const {
    to, subject, body, html,
    reply_to, cc,
    lead_id, campaign_id, source = "manual",
  } = req.body;

  try {
    const logRow = await emailService.sendEmail({
      to, subject, body, html,
      replyTo    : reply_to,
      cc         : cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
      leadId     : lead_id,
      campaignId : campaign_id,
      source,
    });

    return res.status(201).json({
      success : true,
      message : `Email sent to ${to}.`,
      data    : logRow,
    });

  } catch (err) {
    const statusCode = err.code === "EMAIL_NOT_CONFIGURED" ? 503 : 502;
    return res.status(statusCode).json({
      success : false,
      message : err.message,
      code    : err.code || "EMAIL_SEND_FAILED",
    });
  }
});

// ─────────────────────────────────────────────
//  POST /api/send-email/from-message
//  Sends a previously AI-generated message by its ID.
//  Supports format: "email" (subject+body) or "dm" (short_dm as body).
// ─────────────────────────────────────────────
router.post("/from-message", validate(fromMessageSchema), async (req, res) => {
  const { message_id, to, format = "email" } = req.body;

  // Fetch the generated message
  const msg = outreachGen.getMessageById(message_id);
  if (!msg) {
    return res.status(404).json({
      success : false,
      message : `Generated message not found: ${message_id}`,
    });
  }

  // Pick subject/body based on format
  const subject = format === "dm"
    ? `Following up — ${msg.short_dm?.split("\n")[0]?.slice(0, 60) || "Quick question"}`
    : msg.subject_line;

  const body = format === "dm" ? msg.short_dm : msg.email_body;

  try {
    const logRow = await emailService.sendEmail({
      to, subject, body,
      leadId    : msg.lead_id,
      campaignId: msg.campaign_id,
      messageId : msg.id,
      source    : "outreach",
    });

    return res.status(201).json({
      success : true,
      message : `${format === "dm" ? "DM-style" : "Email"} sent to ${to} from generated message.`,
      data    : {
        email_log   : logRow,
        message_used: {
          id      : msg.id,
          subject : subject,
          format,
        },
      },
    });

  } catch (err) {
    const statusCode = err.code === "EMAIL_NOT_CONFIGURED" ? 503 : 502;
    return res.status(statusCode).json({
      success : false,
      message : err.message,
      code    : err.code || "EMAIL_SEND_FAILED",
    });
  }
});

// ─────────────────────────────────────────────
//  GET /api/send-email/verify
//  Test SMTP credentials without sending anything.
// ─────────────────────────────────────────────
router.get("/verify", async (req, res) => {
  try {
    await emailService.verifyConnection();
    return res.json({
      success : true,
      message : "Gmail SMTP connection verified successfully.",
      from    : process.env.GMAIL_USER,
    });
  } catch (err) {
    return res.status(err.code === "EMAIL_NOT_CONFIGURED" ? 503 : 502).json({
      success : false,
      message : err.message,
      code    : err.code,
    });
  }
});

// ─────────────────────────────────────────────
//  GET /api/send-email/logs/stats
//  Delivery stats — total, sent, failed, today.
//  Defined BEFORE /logs/:id to avoid route conflicts.
// ─────────────────────────────────────────────
router.get("/logs/stats", (req, res) => {
  try {
    const stats = emailService.getEmailStats();
    return res.json({ success: true, data: stats });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/send-email/logs
//  Paginated email log.
//  Query params: status (sent|failed), lead_id, campaign_id, limit, offset
// ─────────────────────────────────────────────
router.get("/logs", (req, res) => {
  try {
    const { status, lead_id, campaign_id, limit, offset } = req.query;

    const { logs, total } = emailService.getEmailLogs({
      status,
      leadId     : lead_id,
      campaignId : campaign_id,
      limit      : limit  ? Number(limit)  : 50,
      offset     : offset ? Number(offset) : 0,
    });

    return res.json({
      success : true,
      meta    : { total, count: logs.length },
      data    : logs,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/send-email/logs/:id
//  Single email log entry.
// ─────────────────────────────────────────────
router.get("/logs/:id", (req, res) => {
  try {
    const log = emailService.getEmailLogById(req.params.id);
    if (!log) return res.status(404).json({ success: false, message: "Log entry not found." });
    return res.json({ success: true, data: log });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
