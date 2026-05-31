/**
 * routes/generateOutreach.js
 *
 * POST /api/generate-outreach
 *
 * Accepts lead_id + optional overrides.
 * Supports websitePreviewExists flag — when true, the outreach message
 * will reference a generated website preview as the hook.
 */

"use strict";

const express  = require("express");
const router   = express.Router();
const { getDb }          = require("../db/connection");
const { generateOutreach } = require("../services/outreachGenerator");

router.post("/", async (req, res) => {
  try {
    const {
      lead_id,
      tone_override,
      campaign_id,
      websitePreviewExists = false,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ success: false, message: "lead_id is required." });
    }

    const db   = getDb();
    const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(lead_id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found." });
    }

    // Get latest score for this lead (for lead_score field)
    const latestScore = db.prepare(
      "SELECT * FROM lead_scores WHERE lead_id = ? ORDER BY scored_at DESC LIMIT 1"
    ).get(lead_id);

    const lead_score = latestScore?.lead_score || 5;

    const result = await generateOutreach({
      business_name       : lead.business_name || lead.name,
      industry            : lead.industry,
      location            : lead.location,
      lead_score,
      estimated_value     : latestScore?.estimated_value_range || null,
      website             : lead.website || null,
      notes               : lead.notes   || null,
      tone_override       : tone_override || null,
      websitePreviewExists: !!websitePreviewExists,
      leadId              : lead_id,
      campaignId          : campaign_id || null,
      saveToDb            : true,
    });

    return res.json({ success: true, data: result });

  } catch (err) {
    console.error("Generate outreach error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
