/**
 * routes/generateOutreach.js
 *
 * POST /api/generate-outreach        — generate and save outreach
 * GET  /api/generate-outreach        — list generated messages (history)
 * GET  /api/generate-outreach/:id    — get single message
 *
 * Preview detection (two ways):
 *   1. Request body:  websitePreviewExists: true, preview_url: "https://..."
 *   2. Lead notes contain:  [WEBSITE_PREVIEW_GENERATED] and [PREVIEW_URL:https://...]
 */

"use strict";

const express  = require("express");
const router   = express.Router();
const { getDb }              = require("../db/connection");
const { generateOutreach,
        getAllMessages }      = require("../services/outreachGenerator");

// ─────────────────────────────────────────────
//  POST /api/generate-outreach
// ─────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const {
      lead_id,
      tone_override,
      campaign_id,
      websitePreviewExists = false,
      preview_url,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ success: false, message: "lead_id is required." });
    }

    const db   = getDb();
    const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(lead_id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found." });
    }

    const latestScore = db.prepare(
      "SELECT * FROM lead_scores WHERE lead_id = ? ORDER BY scored_at DESC LIMIT 1"
    ).get(lead_id);

    const lead_score = latestScore?.lead_score || 5;

    // Detect preview from request body OR from lead notes marker
    const hasPreview = !!websitePreviewExists ||
      ((lead.notes || "").includes("[WEBSITE_PREVIEW_GENERATED]"));

    // Resolve preview URL: request body takes precedence, then parse from notes
    const notesUrlMatch = (lead.notes || "").match(/\[PREVIEW_URL:([^\]]+)\]/);
    const resolvedPreviewUrl = preview_url || (notesUrlMatch ? notesUrlMatch[1] : null);

    const result = await generateOutreach({
      business_name       : lead.business_name || lead.name,
      industry            : lead.industry,
      location            : lead.location,
      lead_score,
      estimated_value     : latestScore?.estimated_value_range || null,
      website             : lead.website || null,
      notes               : lead.notes   || null,
      tone_override       : tone_override || null,
      websitePreviewExists: hasPreview,
      preview_url         : resolvedPreviewUrl,
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

// ─────────────────────────────────────────────
//  GET /api/generate-outreach  (history list)
// ─────────────────────────────────────────────
router.get("/", (req, res) => {
  try {
    const { messages, total } = getAllMessages({
      limit : Number(req.query.limit)  || 50,
      offset: Number(req.query.offset) || 0,
    });
    return res.json({ success: true, data: messages, total });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/generate-outreach/:id
// ─────────────────────────────────────────────
router.get("/:id", (req, res) => {
  try {
    const msg = getDb()
      .prepare("SELECT * FROM generated_messages WHERE id = ?")
      .get(req.params.id);
    if (!msg) return res.status(404).json({ success: false, message: "Message not found." });
    return res.json({ success: true, data: msg });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;