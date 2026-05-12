/**
 * routes/outreach.js
 *
 * POST /api/outreach/generate         Generate + save email for a lead
 * POST /api/outreach/preview          Generate WITHOUT saving
 * GET  /api/outreach/lead/:leadId     All emails for a lead
 * GET  /api/outreach/campaign/:campaignId  All emails for a campaign
 * GET  /api/outreach/:id              Single email by ID
 */

"use strict";

const express         = require("express");
const router          = express.Router();
const outreachService = require("../services/outreachService");
const leadsService    = require("../services/leadsService");
const { validate, rules } = require("../middleware/validate");

const generateSchema = {
  lead_id        : [rules.required("lead_id is required.")],
  campaign_context: [rules.maxLength(500)],
};

const previewSchema = {
  business_name : [rules.required(), rules.maxLength(200)],
  industry      : [rules.required(), rules.maxLength(100)],
  location      : [rules.required(), rules.maxLength(200)],
  website       : [rules.url(),      rules.maxLength(500)],
  notes         : [rules.maxLength(2000)],
};

// Generate + save
router.post("/generate", validate(generateSchema), async (req, res) => {
  try {
    const { lead_id, campaign_id, campaign_context } = req.body;
    const lead = leadsService.getLeadById(lead_id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });

    const email = await outreachService.generateAndSave(lead, { campaignId: campaign_id, campaignContext: campaign_context });
    res.status(201).json({ success: true, data: email });
  } catch (err) {
    res.status(502).json({ success: false, message: err.message });
  }
});

// Preview (no save)
router.post("/preview", validate(previewSchema), async (req, res) => {
  try {
    const { business_name, industry, location, website, notes, campaign_context } = req.body;
    const result = await outreachService.generatePreview(
      { business_name, industry, location, website, notes },
      campaign_context
    );
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(502).json({ success: false, message: err.message });
  }
});

// Emails for a lead
router.get("/lead/:leadId", (req, res) => {
  try {
    const emails = outreachService.getEmailsForLead(req.params.leadId);
    res.json({ success: true, count: emails.length, data: emails });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Emails for a campaign
router.get("/campaign/:campaignId", (req, res) => {
  try {
    const emails = outreachService.getEmailsForCampaign(req.params.campaignId);
    res.json({ success: true, count: emails.length, data: emails });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Single email
router.get("/:id", (req, res) => {
  try {
    const email = outreachService.getEmailById(req.params.id);
    if (!email) return res.status(404).json({ success: false, message: "Email not found." });
    res.json({ success: true, data: email });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
