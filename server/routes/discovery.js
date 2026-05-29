/**
 * routes/discovery.js
 *
 * POST /api/discovery/search   — search for businesses (quota enforced)
 * POST /api/discovery/import   — import selected results as leads
 * GET  /api/discovery/quota    — return current user's search quota
 */

"use strict";

const express = require("express");
const router  = express.Router();

const { requireAuth }          = require("../middleware/requireAuth");
const { searchBusinesses, getQuotaInfo } = require("../services/discoveryService");
const { createLead }           = require("../services/leadsService");

// ── GET /quota ────────────────────────────────────────────────────────────────
router.get("/quota", requireAuth, (req, res) => {
  try {
    const quota = getQuotaInfo(req.user.id);
    res.json({ success: true, quota });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /search ──────────────────────────────────────────────────────────────
router.post("/search", requireAuth, async (req, res) => {
  try {
    const query = (req.body.query || req.body.keyword || "").trim();

    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        message: "A search query of at least 2 characters is required.",
      });
    }

    const results = await searchBusinesses(query, {
      userId: req.user.id,
      limit : Number(req.body.limit) || 20,
    });

    // Return updated quota so the frontend can update the counter
    const quota = getQuotaInfo(req.user.id);

    res.json({ success: true, results, count: results.length, quota });

  } catch (err) {
    if (err.code === "QUOTA_EXCEEDED") {
      return res.status(429).json({
        success  : false,
        code     : "QUOTA_EXCEEDED",
        message  : err.message,
        used     : err.used,
        limit    : err.limit,
        plan     : err.plan,
        resets_at: err.resets_at,
      });
    }
    console.error("Discovery search error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /import ──────────────────────────────────────────────────────────────
router.post("/import", requireAuth, async (req, res) => {
  try {
    const { businesses } = req.body;

    if (!Array.isArray(businesses) || businesses.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide an array of businesses to import.",
      });
    }

    const MAX_IMPORT = 50;
    const toImport   = businesses.slice(0, MAX_IMPORT);
    const imported   = [];
    const skipped    = [];

    for (const biz of toImport) {
      try {
        // Map discovery result fields → lead fields
        const lead = createLead({
          business_name: biz.business_name || biz.title || "Unknown",
          industry     : biz.type          || biz.industry || "Unknown",
          location     : biz.address       || biz.location || "Unknown",
          website      : biz.website       || null,
          notes        : [
            biz.phone   ? `Phone: ${biz.phone}`   : null,
            biz.rating  ? `Rating: ${biz.rating}⭐ (${biz.reviews || 0} reviews)` : null,
          ].filter(Boolean).join(" | ") || null,
        });
        imported.push(lead);
      } catch (err) {
        // DUPLICATE_LEAD or other — skip and report
        skipped.push({
          business_name: biz.business_name || biz.title,
          reason: err.code === "DUPLICATE_LEAD" ? "Already exists" : err.message,
        });
      }
    }

    res.status(201).json({
      success     : true,
      imported    : imported.length,
      skipped     : skipped.length,
      leads       : imported,
      skip_details: skipped,
    });

  } catch (err) {
    console.error("Discovery import error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;