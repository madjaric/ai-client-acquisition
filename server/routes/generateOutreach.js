/**
 * routes/generateOutreach.js
 *
 * POST /api/generate-outreach            Generate + save from a saved lead
 * POST /api/generate-outreach/preview    Generate without saving (raw input)
 * GET  /api/generate-outreach            List all generated messages (paginated)
 * GET  /api/generate-outreach/lead/:id   All messages for a specific lead
 * GET  /api/generate-outreach/:id        Single message by ID
 */

"use strict";

const express             = require("express");
const router              = express.Router();
const outreachGenerator   = require("../services/outreachGenerator");
const leadScoresService   = require("../services/leadScoresService");
const leadsService        = require("../services/leadsService");
const { validate, rules } = require("../middleware/validate");

// ─────────────────────────────────────────────
//  Validation schemas
// ─────────────────────────────────────────────

// For generating from a saved lead (enriched with score data automatically)
const generateFromLeadSchema = {
  lead_id: [rules.required("lead_id is required.")],
  tone_override: [rules.oneOf(
    ["aggressive", "soft", "consultative", "casual"],
    "tone_override must be: aggressive, soft, consultative, or casual."
  )],
  campaign_id:  [rules.maxLength(100)],
};

// For preview — all fields provided manually
const previewSchema = {
  business_name   : [rules.required(), rules.maxLength(200), rules.safe()],
  industry        : [rules.required(), rules.maxLength(100), rules.safe()],
  location        : [rules.required(), rules.maxLength(200), rules.safe()],
  lead_score      : [
    rules.required("lead_score is required (integer 1–10)."),
    {
      test   : (v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 10,
      message: "lead_score must be an integer between 1 and 10.",
    },
  ],
  estimated_value : [rules.maxLength(100), rules.safe()],
  website         : [rules.url(), rules.maxLength(500)],
  notes           : [rules.maxLength(2000)],
  tone_override   : [rules.oneOf(["aggressive", "soft", "consultative", "casual"])],
};

// ─────────────────────────────────────────────
//  POST /api/generate-outreach
//  Looks up the lead, pulls its latest AI score, and generates all formats.
// ─────────────────────────────────────────────
router.post("/", validate(generateFromLeadSchema), async (req, res) => {
  const { lead_id, campaign_id, tone_override } = req.body;

  // 1. Fetch lead
  const lead = leadsService.getLeadById(lead_id);
  if (!lead) {
    return res.status(404).json({ success: false, message: `Lead not found: ${lead_id}` });
  }

  if (!lead.business_name || !lead.industry || !lead.location) {
    return res.status(422).json({
      success: false,
      message: "Lead must have business_name, industry, and location to generate outreach.",
    });
  }

  // 2. Pull latest score (if available) to enrich the prompt
  const latestScore = leadScoresService.getLatestScoreForLead(lead_id);

  const input = {
    leadId          : lead.id,
    campaignId      : campaign_id || null,
    business_name   : lead.business_name,
    industry        : lead.industry,
    location        : lead.location,
    lead_score      : latestScore?.lead_score ?? lead.score ?? 5,
    estimated_value : latestScore?.estimated_value_range ?? null,
    website         : lead.website  ?? null,
    notes           : lead.notes    ?? null,
    tone_override   : tone_override ?? null,
    saveToDb        : true,
  };

  try {
    const result = await outreachGenerator.generateOutreach(input);

    return res.status(201).json({
      success : true,
      message : `Outreach generated for "${lead.business_name}".`,
      data    : {
        message : result,
        lead    : {
          id            : lead.id,
          business_name : lead.business_name,
          industry      : lead.industry,
          location      : lead.location,
        },
        score_context: latestScore
          ? { lead_score: latestScore.lead_score, tier: latestScore.tier, estimated_value_range: latestScore.estimated_value_range }
          : null,
      },
    });
  } catch (err) {
    console.error("[generate-outreach] Error:", err.message);
    return res.status(502).json({
      success : false,
      message : "AI generation failed. Check your GEMINI_API_KEY.",
      detail  : process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

// ─────────────────────────────────────────────
//  POST /api/generate-outreach/preview
//  All fields provided manually. Result is NOT saved.
// ─────────────────────────────────────────────
router.post("/preview", validate(previewSchema), async (req, res) => {
  const {
    business_name, industry, location, lead_score,
    estimated_value, website, notes, tone_override,
  } = req.body;

  try {
    const result = await outreachGenerator.generateOutreach({
      business_name,
      industry,
      location,
      lead_score    : Number(lead_score),
      estimated_value,
      website,
      notes,
      tone_override,
      saveToDb      : false,
    });

    return res.json({
      success : true,
      message : "Preview generated (not saved).",
      data    : result,
    });
  } catch (err) {
    console.error("[generate-outreach/preview] Error:", err.message);
    return res.status(502).json({
      success : false,
      message : "AI generation failed.",
      detail  : process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

// ─────────────────────────────────────────────
//  GET /api/generate-outreach
//  List all generated messages with joined lead info
// ─────────────────────────────────────────────
router.get("/", (req, res) => {
  try {
    const { limit, offset } = req.query;
    const { messages, total } = outreachGenerator.getAllMessages({
      limit : limit  ? Number(limit)  : 50,
      offset: offset ? Number(offset) : 0,
    });

    return res.json({
      success : true,
      meta    : { total, count: messages.length },
      data    : messages,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/generate-outreach/lead/:leadId
//  All messages for one lead (newest first)
// ─────────────────────────────────────────────
router.get("/lead/:leadId", (req, res) => {
  try {
    const { limit, offset } = req.query;
    const messages = outreachGenerator.getMessagesForLead(req.params.leadId, {
      limit : limit  ? Number(limit)  : 20,
      offset: offset ? Number(offset) : 0,
    });

    return res.json({ success: true, count: messages.length, data: messages });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/generate-outreach/:id
//  Single message by ID
// ─────────────────────────────────────────────
router.get("/:id", (req, res) => {
  try {
    const message = outreachGenerator.getMessageById(req.params.id);
    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }
    return res.json({ success: true, data: message });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
