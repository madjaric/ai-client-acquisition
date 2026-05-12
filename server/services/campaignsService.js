/**
 * services/campaignsService.js
 *
 * CRUD for campaigns + linking leads to campaigns via campaign_leads join table.
 */

"use strict";

const { getDb } = require("../db/connection");
const { v4: uuidv4 } = require("uuid");

// ─────────────────────────────────────────────
//  Campaigns CRUD
// ─────────────────────────────────────────────

function getAllCampaigns({ status, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const conditions = status ? ["status = ?"] : [];
  const params     = status ? [status]       : [];
  const where      = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.prepare(
    `SELECT * FROM campaigns ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, Number(limit), Number(offset));

  // Attach lead count to each campaign
  return rows.map((c) => ({
    ...c,
    lead_count: db.prepare(
      "SELECT COUNT(*) AS n FROM campaign_leads WHERE campaign_id = ?"
    ).get(c.id).n,
  }));
}

function getCampaignById(id) {
  const db = getDb();
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id);
  if (!campaign) return null;
  campaign.lead_count = db.prepare(
    "SELECT COUNT(*) AS n FROM campaign_leads WHERE campaign_id = ?"
  ).get(id).n;
  return campaign;
}

function createCampaign({ name, type = "email", ai_prompt, status = "draft" }) {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO campaigns (id, name, type, status, ai_prompt)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, type, status, ai_prompt || null);
  return getCampaignById(id);
}

function updateCampaign(id, fields) {
  const db      = getDb();
  const ALLOWED = ["name", "type", "status", "ai_prompt"];
  const updates = Object.keys(fields).filter((k) => ALLOWED.includes(k));
  if (!updates.length) throw new Error("No valid fields to update.");

  const set = updates.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE campaigns SET ${set}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...updates.map((k) => fields[k]), id);
  return getCampaignById(id);
}

function deleteCampaign(id) {
  return getDb().prepare("DELETE FROM campaigns WHERE id = ?").run(id).changes > 0;
}

// ─────────────────────────────────────────────
//  Campaign ↔ Lead linking
// ─────────────────────────────────────────────

function addLeadToCampaign(campaignId, leadId) {
  const db = getDb();
  const existing = db.prepare(
    "SELECT id FROM campaign_leads WHERE campaign_id = ? AND lead_id = ?"
  ).get(campaignId, leadId);
  if (existing) return existing;

  const id = uuidv4();
  db.prepare(
    "INSERT INTO campaign_leads (id, campaign_id, lead_id) VALUES (?, ?, ?)"
  ).run(id, campaignId, leadId);
  return db.prepare("SELECT * FROM campaign_leads WHERE id = ?").get(id);
}

function removeLeadFromCampaign(campaignId, leadId) {
  return getDb().prepare(
    "DELETE FROM campaign_leads WHERE campaign_id = ? AND lead_id = ?"
  ).run(campaignId, leadId).changes > 0;
}

function getLeadsForCampaign(campaignId) {
  return getDb().prepare(`
    SELECT l.*, cl.added_at, cl.email_sent_at, cl.email_status
    FROM leads l
    INNER JOIN campaign_leads cl ON cl.lead_id = l.id
    WHERE cl.campaign_id = ?
    ORDER BY cl.added_at DESC
  `).all(campaignId);
}

function markEmailSent(campaignId, leadId, status = "sent") {
  getDb().prepare(`
    UPDATE campaign_leads
    SET email_sent_at = CURRENT_TIMESTAMP, email_status = ?
    WHERE campaign_id = ? AND lead_id = ?
  `).run(status, campaignId, leadId);
}

module.exports = {
  getAllCampaigns, getCampaignById, createCampaign, updateCampaign, deleteCampaign,
  addLeadToCampaign, removeLeadFromCampaign, getLeadsForCampaign, markEmailSent,
};
