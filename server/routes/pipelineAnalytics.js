/**
 * routes/pipelineAnalytics.js
 *
 * GET /api/pipeline/analytics
 *
 * Returns aggregated analytics for the Pipeline Analytics & Insights section:
 *   - Lead distribution
 *   - Website opportunity metrics
 *   - AI insights (highest value lead, fastest conversion, etc.)
 *   - Revenue projection
 *
 * All data is derived from leads + lead_scores tables. No new DB tables needed.
 */

"use strict";

const express = require("express");
const router  = express.Router();
const { getDb } = require("../db/connection");

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/pipeline/analytics
// ─────────────────────────────────────────────────────────────────────────────
router.get("/analytics", (req, res) => {
  try {
    const db = getDb();

    // ── 1. Lead Distribution ──────────────────────────────────────────────
    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM leads GROUP BY status
    `).all();

    const dist = { total: 0, new: 0, contacted: 0, replied: 0, qualified: 0, converted: 0, lost: 0 };
    for (const row of statusCounts) {
      dist[row.status] = row.count;
      dist.total += row.count;
    }

    // ── 2. Website Opportunity Metrics ────────────────────────────────────
    const totalLeads    = dist.total;
    const withWebsite   = db.prepare("SELECT COUNT(*) as n FROM leads WHERE website IS NOT NULL AND website != ''").get().n;
    const noWebsite     = totalLeads - withWebsite;

    // Average website opportunity score from Model B scores
    const woScoreRow = db.prepare(`
      SELECT AVG(CAST(json_extract(reasoning, '$.website_opportunity_score') AS REAL)) as avg_wo
      FROM lead_scores
      WHERE model = 'B'
    `).get();

    // Estimated website revenue: sum of potential from notes/scoring
    const woLeads = db.prepare(`
      SELECT ls.estimated_value_range, ls.website_revenue_potential, ls.website_opportunity_score
      FROM lead_scores ls
      INNER JOIN (
        SELECT lead_id, MAX(scored_at) as max_sa FROM lead_scores GROUP BY lead_id
      ) latest ON ls.lead_id = latest.lead_id AND ls.scored_at = latest.max_sa
      WHERE ls.model = 'B' OR ls.website_opportunity_score IS NOT NULL
    `).all();

    // Simple revenue estimate: $2500 avg site deal × no-website leads with score >= 40
    const hotWoLeads  = woLeads.filter(l => (l.website_opportunity_score || 0) >= 70).length;
    const warmWoLeads = woLeads.filter(l => (l.website_opportunity_score || 0) >= 40 && (l.website_opportunity_score || 0) < 70).length;
    const estimatedWoRevenue = (hotWoLeads * 3500) + (warmWoLeads * 2000);

    // ── 3. AI Insights — pull from lead_scores ────────────────────────────
    const rankedScores = db.prepare(`
      SELECT ls.*, l.business_name, l.industry, l.location, l.website,
             COALESCE(ls.score, ls.lead_score * 10, 0) as score_100
      FROM lead_scores ls
      INNER JOIN leads l ON l.id = ls.lead_id
      INNER JOIN (
        SELECT lead_id, MAX(scored_at) as max_sa FROM lead_scores GROUP BY lead_id
      ) latest ON ls.lead_id = latest.lead_id AND ls.scored_at = latest.max_sa
      ORDER BY score_100 DESC
    `).all();

    const highestValueLead = rankedScores.find(s => s.estimated_value_range && s.estimated_value_range !== "Unknown") || rankedScores[0] || null;

    // Highest website opportunity: Model B leads sorted by website_opportunity_score
    const highestWoLead = rankedScores
      .filter(s => s.website_opportunity_score && Number(s.website_opportunity_score) > 0)
      .sort((a, b) => Number(b.website_opportunity_score) - Number(a.website_opportunity_score))[0] || null;

    // Fastest conversion: Tier A or Hot score leads, prioritize those with recommended action
    const fastestConversion = rankedScores.find(s =>
      (s.tier === "A" || (Number(s.score_100) >= 80)) && s.recommended_action
    ) || rankedScores[0] || null;

    // Most responsive industry: industry with most high-scoring leads
    const industryScores = {};
    for (const s of rankedScores) {
      if (!s.industry) continue;
      if (!industryScores[s.industry]) industryScores[s.industry] = { count: 0, totalScore: 0 };
      industryScores[s.industry].count++;
      industryScores[s.industry].totalScore += Number(s.score_100) || 0;
    }
    const mostResponsiveIndustry = Object.entries(industryScores)
      .sort(([, a], [, b]) => (b.totalScore / b.count) - (a.totalScore / a.count))[0]?.[0] || null;

    // ── 4. Revenue Projection ─────────────────────────────────────────────
    // Parse estimated values from score ranges
    let potentialRevenue = 0, monthlyRecurring = 0;
    for (const s of rankedScores) {
      const val = s.estimated_value_range || "";
      const nums = val.match(/\$?([\d,]+)/g);
      if (nums && nums.length >= 1) {
        const low = parseInt(nums[0].replace(/[$,]/g, "")) || 0;
        potentialRevenue += low;
      }
    }
    // Monthly recurring: assume ~30% of pipeline is service retainers
    monthlyRecurring = Math.round(potentialRevenue * 0.3);
    const estimatedCloseValue = Math.round(potentialRevenue * 0.15); // 15% close rate

    return res.json({
      success: true,
      data: {
        lead_distribution: {
          total    : dist.total,
          new      : dist.new || 0,
          contacted: dist.contacted || 0,
          replied  : dist.replied || 0,
          qualified: dist.qualified || 0,
          converted: dist.converted || 0,
        },
        website_opportunity_metrics: {
          with_website              : withWebsite,
          without_website           : noWebsite,
          website_opportunity_score : Math.round(noWebsite > 0 ? (hotWoLeads / noWebsite) * 100 : 0),
          estimated_website_revenue : estimatedWoRevenue,
          hot_opportunities         : hotWoLeads,
          warm_opportunities        : warmWoLeads,
        },
        ai_insights: {
          highest_value_lead: highestValueLead ? {
            id            : highestValueLead.lead_id,
            business_name : highestValueLead.business_name,
            value_range   : highestValueLead.estimated_value_range,
            score         : highestValueLead.score_100,
          } : null,
          highest_website_opportunity: highestWoLead ? {
            id              : highestWoLead.lead_id,
            business_name   : highestWoLead.business_name,
            wo_score        : highestWoLead.website_opportunity_score,
            industry        : highestWoLead.industry,
          } : null,
          fastest_conversion: fastestConversion ? {
            id            : fastestConversion.lead_id,
            business_name : fastestConversion.business_name,
            next_action   : fastestConversion.recommended_action,
            score         : fastestConversion.score_100,
          } : null,
          most_responsive_industry: mostResponsiveIndustry,
        },
        revenue_projection: {
          potential_revenue          : potentialRevenue,
          monthly_recurring_opportunity: monthlyRecurring,
          estimated_close_value      : estimatedCloseValue,
        },
      },
    });

  } catch (err) {
    console.error("Pipeline analytics error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
