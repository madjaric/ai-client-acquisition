/**
 * routes/scoreLead.js
 *
 * POST /api/score-lead        — score a lead by ID
 * GET  /api/score-lead/ranked — get ranked scored leads
 * GET  /api/score-lead/:id    — get a specific score record
 */

"use strict";

const express  = require("express");
const router   = express.Router();
const { getDb }               = require("../db/connection");
const { scoreLead }           = require("../services/aiScoring");
const { saveScore,
        getRankedLeads,
        getScoreById,
        getLatestScoreForLead } = require("../services/leadScoresService");

// ─────────────────────────────────────────────
//  POST /api/score-lead
// ─────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { lead_id } = req.body;
    if (!lead_id) return res.status(400).json({ success: false, message: "lead_id is required." });

    const db   = getDb();
    const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(lead_id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });

    // Pass all available signals to the scoring engine
    const result = await scoreLead({
      business_name: lead.business_name || lead.name,
      industry     : lead.industry,
      location     : lead.location,
      website      : lead.website      || null,
      notes        : lead.notes        || null,
      // Pass review signals if available on the lead record
      rating       : lead.rating       || lead.google_rating    || null,
      review_count : lead.review_count || lead.google_reviews   || null,
      phone        : lead.phone        || null,
    });

    const saved = saveScore(lead_id, result);

    return res.json({ success: true, data: { score: { ...saved, ...result } } });

  } catch (err) {
    console.error("Score lead error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/score-lead/ranked
// ─────────────────────────────────────────────
router.get("/ranked", (req, res) => {
  try {
    const { tier, min_score, limit = 50, offset = 0 } = req.query;
    const ranked = getRankedLeads({
      tier       : tier       || undefined,
      min_score  : min_score  ? Number(min_score)  : undefined,
      limit      : Number(limit),
      offset     : Number(offset),
    });
    return res.json({ success: true, data: ranked });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/score-lead/:id
// ─────────────────────────────────────────────
router.get("/:id", (req, res) => {
  try {
    const score = getScoreById(req.params.id);
    if (!score) return res.status(404).json({ success: false, message: "Score not found." });
    return res.json({ success: true, data: score });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;