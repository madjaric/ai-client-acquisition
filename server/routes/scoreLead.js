/**
 * routes/scoreLead.js
 *
 * POST   /api/score-lead          Score a lead by lead_id (uses saved lead data)
 * POST   /api/score-lead/preview  Score without saving (ad-hoc, no lead_id needed)
 * GET    /api/score-lead/:leadId  Get latest score for a lead
 * GET    /api/score-lead/:leadId/history  Full scoring history
 * GET    /api/score-lead/ranked   All scored leads ranked by score
 */

"use strict";

const express           = require("express");
const router            = express.Router();
const aiScoring         = require("../services/aiScoring");
const leadScoresService = require("../services/leadScoresService");
const leadsService      = require("../services/leadsService");
const { validate, rules } = require("../middleware/validate");

// ─────────────────────────────────────────────
//  Validation schemas
// ─────────────────────────────────────────────
const scoreByIdSchema = {
  lead_id: [rules.required("lead_id is required.")],
};

const previewScoreSchema = {
  business_name : [rules.required("business_name is required."), rules.maxLength(200)],
  industry      : [rules.required("industry is required."),      rules.maxLength(100)],
  location      : [rules.required("location is required."),      rules.maxLength(200)],
  website       : [rules.url(), rules.maxLength(500)],
  notes         : [rules.maxLength(2000)],
};

// ─────────────────────────────────────────────
//  POST /api/score-lead
//  Score an existing lead by lead_id and persist the result.
// ─────────────────────────────────────────────
router.post("/", validate(scoreByIdSchema), async (req, res) => {
  const { lead_id } = req.body;

  // 1. Fetch the lead
  const lead = leadsService.getLeadById(lead_id);
  if (!lead) {
    return res.status(404).json({ success: false, message: `Lead not found: ${lead_id}` });
  }

  // 2. Require the minimum fields for meaningful scoring
  if (!lead.business_name || !lead.industry || !lead.location) {
    return res.status(422).json({
      success: false,
      message: "Lead must have business_name, industry, and location before it can be scored.",
    });
  }

  try {
    // 3. Call AI
    const result = await aiScoring.scoreLead(lead);

    // 4. Persist
    const saved = leadScoresService.saveScore(lead_id, result);

    return res.status(201).json({
      success : true,
      message : `Lead scored successfully. Tier ${saved.tier} — Score ${saved.lead_score}/10.`,
      data    : {
        lead: {
          id            : lead.id,
          business_name : lead.business_name,
          industry      : lead.industry,
          location      : lead.location,
        },
        score: saved,
      },
    });
  } catch (err) {
    console.error("[score-lead] AI scoring failed:", err.message);
    return res.status(502).json({
      success : false,
      message : "AI scoring service error. Check your GEMINI_API_KEY and try again.",
      detail  : process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

// ─────────────────────────────────────────────
//  POST /api/score-lead/preview
//  Score arbitrary data without needing a saved lead. Result is NOT stored.
//  Useful for testing the prompt or UI previews.
// ─────────────────────────────────────────────
router.post("/preview", validate(previewScoreSchema), async (req, res) => {
  const { business_name, industry, location, website, notes } = req.body;

  try {
    const result = await aiScoring.scoreLead({ business_name, industry, location, website, notes });

    return res.json({
      success  : true,
      message  : "Preview score generated (not saved to database).",
      data     : result,
    });
  } catch (err) {
    console.error("[score-lead/preview] AI scoring failed:", err.message);
    return res.status(502).json({
      success : false,
      message : "AI scoring service error.",
      detail  : process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

// ─────────────────────────────────────────────
//  GET /api/score-lead/ranked
//  All scored leads ranked by score desc.
//  Query: tier, min_score, limit, offset
//  NOTE: must be defined BEFORE /:leadId to avoid route conflict
// ─────────────────────────────────────────────
router.get("/ranked", (req, res) => {
  try {
    const { tier, min_score, limit, offset } = req.query;
    const rows = leadScoresService.getRankedLeads({
      tier,
      min_score : min_score ? Number(min_score) : undefined,
      limit     : limit     ? Number(limit)     : 50,
      offset    : offset    ? Number(offset)    : 0,
    });

    return res.json({
      success : true,
      meta    : { count: rows.length },
      data    : rows,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/score-lead/:leadId
//  Latest score for a specific lead
// ─────────────────────────────────────────────
router.get("/:leadId", (req, res) => {
  try {
    const score = leadScoresService.getLatestScoreForLead(req.params.leadId);
    if (!score) {
      return res.status(404).json({
        success : false,
        message : "No score found for this lead. POST /api/score-lead to generate one.",
      });
    }
    return res.json({ success: true, data: score });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/score-lead/:leadId/history
//  All historical scores for a lead (newest first)
// ─────────────────────────────────────────────
router.get("/:leadId/history", (req, res) => {
  try {
    const history = leadScoresService.getScoreHistoryForLead(req.params.leadId);
    return res.json({
      success : true,
      meta    : { count: history.length },
      data    : history,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
