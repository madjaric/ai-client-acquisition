/**
 * routes/discovery.js
 *
 * POST /api/discovery/search      — search businesses (quota enforced)
 * POST /api/discovery/import      — bulk import selected results as leads
 * POST /api/discovery/import-one  — import single business as lead
 * GET  /api/discovery/quota       — current user's search quota
 * GET  /api/discovery/source      — which data source is active
 */

"use strict";

const express = require("express");
const router  = express.Router();

const { requireAuth }                          = require("../middleware/requireAuth");
const { searchBusinesses, getDataSource,
        getQuotaInfo }                         = require("../services/discoveryService");
const { createLead }                           = require("../services/leadsService");

// ── GET /source ───────────────────────────────────────────────────────────────
router.get("/source", (req, res) => {
  res.json({ success: true, source: getDataSource() });
});

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
    // Dashboard sends { keyword, limit } — also accept { query }
    const keyword = (req.body.keyword || req.body.query || "").trim();
    const limit   = Number(req.body.limit) || 20;

    if (!keyword || keyword.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Enter a business type or location to search.",
      });
    }

    const results = await searchBusinesses(keyword, {
      userId: req.user.id,
      limit,
    });

    const quota  = getQuotaInfo(req.user.id);
    const source = getDataSource();

    // Response shape matches what dashboard.html expects:
    //   d.data    — array of businesses
    //   d.source  — "serpapi" | "mock"
    //   d.keyword — echoed back for display
    res.json({
      success: true,
      data   : results,
      keyword,
      source,
      count  : results.length,
      quota,
    });

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

// ── POST /import-one ──────────────────────────────────────────────────────────
// Single business import — called per-row from the results table
router.post("/import-one", requireAuth, async (req, res) => {
  try {
    const {
      business_name, location, industry, website, notes,
      email, email_source,
      phone, phone_normalized,
      rating, review_count,
      place_id, source: discovery_source,
    } = req.body;

    if (!business_name || !location) {
      return res.status(400).json({ success: false, message: "business_name and location are required." });
    }

    const lead = createLead({
      business_name    : business_name.trim(),
      industry         : (industry || "Local Business").trim(),
      location         : location.trim(),
      website          : website          || null,
      notes            : notes            || null,
      email            : email            || null,
      email_source     : email_source     || null,
      phone            : phone            || null,
      phone_normalized : phone_normalized || null,
      rating           : rating           != null ? Number(rating)       : null,
      review_count     : review_count     != null ? parseInt(review_count, 10) : null,
      place_id         : place_id         || null,
      discovery_source : discovery_source || null,
    });

    res.status(201).json({ success: true, data: lead });

  } catch (err) {
    if (err.code === "DUPLICATE_LEAD") {
      return res.status(409).json({ success: false, message: err.message, code: "DUPLICATE_LEAD" });
    }
    console.error("import-one error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /import ──────────────────────────────────────────────────────────────
// Bulk import — called for "Import without website" button
router.post("/import", requireAuth, async (req, res) => {
  try {
    const { businesses } = req.body;

    if (!Array.isArray(businesses) || businesses.length === 0) {
      return res.status(400).json({ success: false, message: "Provide an array of businesses." });
    }

    let imported = 0, skipped = 0, failed = 0;
    const leads = [];

    for (const biz of businesses.slice(0, 50)) {
      try {
        const lead = createLead({
          business_name    : (biz.business_name || biz.name || "Unknown").trim(),
          industry         : (biz.industry || biz.type || "Local Business").trim(),
          location         : (biz.location  || biz.address || "Unknown").trim(),
          website          : biz.website          || null,
          notes            : biz.notes            || null,
          email            : biz.email            || null,
          email_source     : biz.email_source     || null,
          phone            : biz.phone            || null,
          phone_normalized : biz.phone_normalized || null,
          rating           : biz.rating        != null ? Number(biz.rating)           : null,
          review_count     : biz.review_count  != null ? parseInt(biz.review_count, 10) : null,
          place_id         : biz.place_id         || null,
          discovery_source : biz.source           || null,
        });
        leads.push(lead);
        imported++;
      } catch (err) {
        if (err.code === "DUPLICATE_LEAD") skipped++;
        else failed++;
      }
    }

    // Response shape matches what dashboard expects: d.summary
    res.status(201).json({
      success: true,
      summary: { imported, skipped, failed },
      leads,
    });

  } catch (err) {
    console.error("bulk import error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;