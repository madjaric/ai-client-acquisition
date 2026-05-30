/**
 * routes/leadIntelligence.js
 *
 * GET /api/lead-intelligence/:leadId
 *
 * Returns a fully-assembled intelligence payload for a single lead:
 *   - Lead data
 *   - Latest AI score (Model A or B)
 *   - Score breakdown & reasoning
 *   - Website opportunity data (Model B only)
 *   - Latest generated outreach message
 *   - Recommended next action
 *   - Revenue potential & conversion probability
 *
 * Used by the Lead Intelligence Side Panel in the dashboard.
 */

"use strict";

const express = require("express");
const router  = express.Router();

const { getLeadById }            = require("../services/leadsService");
const { getLatestScoreForLead }  = require("../services/leadScoresService");
const { getMessagesForLead }     = require("../services/outreachGenerator");

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/lead-intelligence/:leadId
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:leadId", async (req, res) => {
  try {
    const { leadId } = req.params;

    const lead = getLeadById(leadId);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found." });
    }

    // Fetch latest score
    const score = getLatestScoreForLead(leadId);

    // Fetch latest outreach message
    const messages = getMessagesForLead(leadId, { limit: 1 });
    const latestMessage = messages[0] || null;

    // Parse score fields that may be stored as JSON strings
    let parsedScore = null;
    if (score) {
      const redFlags = typeof score.red_flags === "string"
        ? (() => { try { return JSON.parse(score.red_flags); } catch { return []; } })()
        : (score.red_flags || []);

      const scoreBreakdown = typeof score.score_breakdown === "string"
        ? (() => { try { return JSON.parse(score.score_breakdown); } catch { return {}; } })()
        : (score.score_breakdown || {});

      parsedScore = {
        ...score,
        red_flags: redFlags,
        score_breakdown: scoreBreakdown,
        // Normalise score to 0-100 if stored as 1-10
        score_100: score.score !== undefined
          ? score.score
          : (score.lead_score ? score.lead_score * 10 : null),
        score_label: getScoreLabel(score.score !== undefined ? score.score : (score.lead_score * 10)),
      };
    }

    // Check if a website was generated (stored in localStorage on client)
    // The API can check if we have outreach referencing website preview
    const hasWebsite = !!(lead.website && lead.website.trim());

    // Revenue projection
    let revenueProjection = null;
    if (parsedScore) {
      revenueProjection = {
        estimated_value_range  : parsedScore.estimated_value_range || "—",
        website_revenue_potential: parsedScore.website_revenue_potential || null,
        conversion_probability : parsedScore.conversion_probability || "medium",
        model_used             : parsedScore.model || (hasWebsite ? "A" : "B"),
      };
    }

    return res.json({
      success: true,
      data: {
        lead,
        score: parsedScore,
        latest_message: latestMessage,
        revenue_projection: revenueProjection,
        has_website: hasWebsite,
        intelligence_summary: buildSummary(lead, parsedScore),
      },
    });

  } catch (err) {
    console.error("Lead intelligence error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function getScoreLabel(score) {
  if (!score && score !== 0) return "Unscored";
  if (score >= 90) return "Hot";
  if (score >= 70) return "Warm";
  if (score >= 40) return "Mild";
  return "Cold";
}

function buildSummary(lead, score) {
  if (!score) {
    return {
      headline: `${lead.business_name} — awaiting AI scoring`,
      next_action: "Run AI Score to unlock full intelligence",
    };
  }
  return {
    headline    : `${lead.business_name} — ${score.score_label || "Scored"} Lead`,
    next_action : score.recommended_action || "Review score and generate outreach",
    model_type  : score.model === "B" ? "Website Opportunity Lead" : "Lead Gen Services Lead",
  };
}

module.exports = router;
