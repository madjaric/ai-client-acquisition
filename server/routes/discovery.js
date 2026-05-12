/**
 * routes/discovery.js
 *
 * POST /api/discovery/search          Search for businesses by keyword
 * POST /api/discovery/import          Bulk-import selected businesses as leads
 * POST /api/discovery/import-one      Import a single business as a lead
 * GET  /api/discovery/source          Which data source is active
 */

"use strict";

const express          = require("express");
const router           = express.Router();
const discoveryService = require("../services/discoveryService");
const leadsService     = require("../services/leadsService");
const { validate, rules } = require("../middleware/validate");

// ─────────────────────────────────────────────
//  Validation schemas
// ─────────────────────────────────────────────

const searchSchema = {
  keyword: [
    rules.required("keyword is required."),
    rules.minLength(2, "keyword must be at least 2 characters."),
    rules.maxLength(200),
    rules.safe(),
  ],
  limit: [{
    test   : (v) => v === undefined || v === null || (Number(v) >= 1 && Number(v) <= 20),
    message: "limit must be between 1 and 20.",
  }],
};

const importOneSchema = {
  business_name : [rules.required(), rules.maxLength(200), rules.safe()],
  location      : [rules.required(), rules.maxLength(200), rules.safe()],
  industry      : [rules.required(), rules.maxLength(100), rules.safe()],
  website       : [rules.url(),      rules.maxLength(500)],
  notes         : [rules.maxLength(2000)],
};

// ─────────────────────────────────────────────
//  POST /api/discovery/search
//  Searches for businesses and returns raw results (not saved).
// ─────────────────────────────────────────────
router.post("/search", validate(searchSchema), async (req, res) => {
  const { keyword, limit = 20 } = req.body;

  try {
    const results = await discoveryService.searchBusinesses(keyword, Number(limit));
    const source  = discoveryService.getDataSource();

    return res.json({
      success  : true,
      source,
      keyword,
      count    : results.length,
      data     : results,
    });
  } catch (err) {
    console.error("[discovery/search] Error:", err.message);
    return res.status(502).json({
      success : false,
      message : err.message,
    });
  }
});

// ─────────────────────────────────────────────
//  POST /api/discovery/import
//  Bulk-import an array of businesses as leads.
//  Input: { businesses: [ { business_name, location, industry, website?, notes? }, ... ] }
// ─────────────────────────────────────────────
router.post("/import", async (req, res) => {
  const { businesses } = req.body;

  if (!Array.isArray(businesses) || businesses.length === 0) {
    return res.status(400).json({
      success : false,
      message : "businesses must be a non-empty array.",
    });
  }

  if (businesses.length > 20) {
    return res.status(400).json({
      success : false,
      message : "Maximum 20 businesses can be imported at once.",
    });
  }

  const results = {
    imported  : [],
    skipped   : [],   // duplicates
    failed    : [],   // validation errors
  };

  for (const biz of businesses) {
    const { business_name, location, industry, website, rating, phone, review_count } = biz;

    // Minimal validation
    if (!business_name || !location || !industry) {
      results.failed.push({
        business_name: business_name || "unknown",
        reason: "Missing required fields (business_name, location, industry).",
      });
      continue;
    }

    // Build notes from discovery metadata
    const noteParts = [];
    if (rating)       noteParts.push(`Rating: ${rating}/5`);
    if (review_count) noteParts.push(`${review_count} reviews`);
    if (phone)        noteParts.push(`Phone: ${phone}`);
    noteParts.push("Imported via Lead Discovery Engine");
    const notes = noteParts.join(" · ");

    try {
      const lead = leadsService.createLead({
        business_name: business_name.trim(),
        industry     : (industry || "Local Business").trim(),
        location     : location.trim(),
        website      : website   || null,
        notes,
      });
      results.imported.push({
        id            : lead.id,
        business_name : lead.business_name,
        location      : lead.location,
      });
    } catch (err) {
      if (err.code === "DUPLICATE_LEAD") {
        results.skipped.push({
          business_name,
          reason: "Already exists in leads database.",
        });
      } else {
        results.failed.push({ business_name, reason: err.message });
      }
    }
  }

  const total = businesses.length;
  return res.status(207).json({
    success : true,
    message : `Imported ${results.imported.length}/${total} businesses. ${results.skipped.length} duplicates skipped.`,
    summary : {
      total,
      imported  : results.imported.length,
      skipped   : results.skipped.length,
      failed    : results.failed.length,
    },
    data: results,
  });
});

// ─────────────────────────────────────────────
//  POST /api/discovery/import-one
//  Import a single business directly.
// ─────────────────────────────────────────────
router.post("/import-one", validate(importOneSchema), (req, res) => {
  const { business_name, location, industry, website, notes } = req.body;

  try {
    const lead = leadsService.createLead({ business_name, location, industry, website, notes });
    return res.status(201).json({
      success : true,
      message : `"${business_name}" imported as a lead.`,
      data    : lead,
    });
  } catch (err) {
    if (err.code === "DUPLICATE_LEAD") {
      return res.status(409).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/discovery/source
//  Returns which data source is currently configured.
// ─────────────────────────────────────────────
router.get("/source", (req, res) => {
  const source = discoveryService.getDataSource();
  return res.json({
    success : true,
    source,
    message : source === "serpapi"
      ? "Live data via SerpAPI (Google Maps)"
      : "Mock data (set SERPAPI_KEY in .env for live results)",
  });
});

module.exports = router;
