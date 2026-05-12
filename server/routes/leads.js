/**
 * routes/leads.js
 * Lead input system — full CRUD + AI actions.
 *
 * POST   /api/leads              Create a lead
 * GET    /api/leads              List all leads (filterable, paginated)
 * GET    /api/leads/:id          Get single lead
 * PATCH  /api/leads/:id          Update a lead
 * DELETE /api/leads/:id          Delete a lead
 * POST   /api/leads/:id/score    AI lead scoring
 * POST   /api/leads/:id/email    AI outreach email generation
 */

const express = require("express");
const router  = express.Router();

const leadsService = require("../services/leadsService");
const aiService    = require("../services/aiService");
const { validate, createLeadSchema, updateLeadSchema } = require("../middleware/validate");

// ─────────────────────────────────────────────
//  POST /api/leads — Create a new lead
// ─────────────────────────────────────────────
router.post("/", validate(createLeadSchema), (req, res) => {
  try {
    const { business_name, industry, location, website, notes } = req.body;
    const lead = leadsService.createLead({ business_name, industry, location, website, notes });

    return res.status(201).json({
      success: true,
      message: `Lead "${lead.business_name}" created successfully.`,
      data: lead,
    });
  } catch (err) {
    if (err.code === "DUPLICATE_LEAD") {
      return res.status(409).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/leads — List leads
//  Query params: status, industry, location, search, limit, offset
// ─────────────────────────────────────────────
router.get("/", (req, res) => {
  try {
    const { status, industry, location, search, limit, offset } = req.query;

    const result = leadsService.getAllLeads({
      status,
      industry,
      location,
      search,
      limit:  limit  ? parseInt(limit,  10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    return res.json({
      success: true,
      meta: {
        total:  result.total,
        limit:  result.limit,
        offset: result.offset,
        count:  result.leads.length,
      },
      data: result.leads,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/leads/:id — Single lead
// ─────────────────────────────────────────────
router.get("/:id", (req, res) => {
  try {
    const lead = leadsService.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });
    return res.json({ success: true, data: lead });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  PATCH /api/leads/:id — Update a lead
// ─────────────────────────────────────────────
router.patch("/:id", validate(updateLeadSchema), (req, res) => {
  try {
    const lead = leadsService.updateLead(req.params.id, req.body);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });
    return res.json({ success: true, message: "Lead updated.", data: lead });
  } catch (err) {
    if (err.code === "DUPLICATE_LEAD") {
      return res.status(409).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  DELETE /api/leads/:id
// ─────────────────────────────────────────────
router.delete("/:id", (req, res) => {
  try {
    const deleted = leadsService.deleteLead(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: "Lead not found." });
    return res.json({ success: true, message: "Lead deleted." });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  POST /api/leads/:id/score — AI scoring
// ─────────────────────────────────────────────
router.post("/:id/score", async (req, res) => {
  try {
    const lead = leadsService.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });

    const { score, reason } = await aiService.scoreLead(lead);
    const updated = leadsService.setLeadScore(lead.id, score);

    return res.json({
      success: true,
      data: { ...updated, ai_score_reason: reason },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  POST /api/leads/:id/email — AI outreach email
// ─────────────────────────────────────────────
router.post("/:id/email", async (req, res) => {
  try {
    const lead = leadsService.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });

    const { campaign_context } = req.body;
    const email = await aiService.generateOutreachEmail(lead, campaign_context);

    return res.json({
      success: true,
      data: { lead_id: lead.id, email_body: email },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
