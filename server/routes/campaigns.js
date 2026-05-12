/**
 * routes/campaigns.js
 *
 * GET    /api/campaigns
 * POST   /api/campaigns
 * GET    /api/campaigns/:id
 * PATCH  /api/campaigns/:id
 * DELETE /api/campaigns/:id
 * GET    /api/campaigns/:id/leads
 * POST   /api/campaigns/:id/leads        { lead_id }
 * DELETE /api/campaigns/:id/leads/:leadId
 * POST   /api/campaigns/:id/generate-emails  (bulk AI generation)
 */

"use strict";

const express           = require("express");
const router            = express.Router();
const campaignsService  = require("../services/campaignsService");
const outreachService   = require("../services/outreachService");
const leadsService      = require("../services/leadsService");
const { validate, rules } = require("../middleware/validate");

const createCampaignSchema = {
  name : [rules.required("name is required."), rules.maxLength(200), rules.safe()],
  type : [rules.oneOf(["email","linkedin","cold_call","other"])],
  ai_prompt: [rules.maxLength(2000)],
};

const updateCampaignSchema = {
  name   : [rules.maxLength(200), rules.safe()],
  type   : [rules.oneOf(["email","linkedin","cold_call","other"])],
  status : [rules.oneOf(["draft","active","paused","completed"])],
  ai_prompt: [rules.maxLength(2000)],
};

// List campaigns
router.get("/", (req, res) => {
  try {
    const { status, limit, offset } = req.query;
    const campaigns = campaignsService.getAllCampaigns({
      status,
      limit : limit  ? Number(limit)  : 50,
      offset: offset ? Number(offset) : 0,
    });
    res.json({ success: true, count: campaigns.length, data: campaigns });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Create campaign
router.post("/", validate(createCampaignSchema), (req, res) => {
  try {
    const { name, type, ai_prompt } = req.body;
    const campaign = campaignsService.createCampaign({ name, type, ai_prompt });
    res.status(201).json({ success: true, data: campaign });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Get single campaign
router.get("/:id", (req, res) => {
  try {
    const campaign = campaignsService.getCampaignById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found." });
    res.json({ success: true, data: campaign });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Update campaign
router.patch("/:id", validate(updateCampaignSchema), (req, res) => {
  try {
    const campaign = campaignsService.updateCampaign(req.params.id, req.body);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found." });
    res.json({ success: true, data: campaign });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Delete campaign
router.delete("/:id", (req, res) => {
  try {
    const deleted = campaignsService.deleteCampaign(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: "Campaign not found." });
    res.json({ success: true, message: "Campaign deleted." });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Get leads in campaign
router.get("/:id/leads", (req, res) => {
  try {
    const leads = campaignsService.getLeadsForCampaign(req.params.id);
    res.json({ success: true, count: leads.length, data: leads });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Add lead to campaign
router.post("/:id/leads", (req, res) => {
  try {
    const { lead_id } = req.body;
    if (!lead_id) return res.status(400).json({ success: false, message: "lead_id is required." });
    const link = campaignsService.addLeadToCampaign(req.params.id, lead_id);
    res.status(201).json({ success: true, data: link });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Remove lead from campaign
router.delete("/:id/leads/:leadId", (req, res) => {
  try {
    const removed = campaignsService.removeLeadFromCampaign(req.params.id, req.params.leadId);
    if (!removed) return res.status(404).json({ success: false, message: "Link not found." });
    res.json({ success: true, message: "Lead removed from campaign." });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Bulk generate outreach emails for all leads in a campaign
router.post("/:id/generate-emails", async (req, res) => {
  try {
    const campaign = campaignsService.getCampaignById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found." });

    const leads = campaignsService.getLeadsForCampaign(req.params.id);
    if (!leads.length) {
      return res.status(400).json({ success: false, message: "No leads in this campaign." });
    }

    const results = [];
    for (const lead of leads) {
      try {
        const email = await outreachService.generateAndSave(lead, {
          campaignId     : campaign.id,
          campaignContext: campaign.ai_prompt || req.body.context,
        });
        campaignsService.markEmailSent(campaign.id, lead.id, "generated");
        results.push({ lead_id: lead.id, business_name: lead.business_name, status: "ok", email_id: email.id });
      } catch (e) {
        results.push({ lead_id: lead.id, business_name: lead.business_name, status: "error", error: e.message });
      }
    }

    const succeeded = results.filter(r => r.status === "ok").length;
    res.json({
      success: true,
      message: `Generated ${succeeded}/${leads.length} emails.`,
      data   : results,
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
