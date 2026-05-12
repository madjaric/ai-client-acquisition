/**
 * services/outreachService.js
 *
 * Generates personalised cold outreach emails using Claude.
 * Each generated email is saved to `outreach_emails` and linked to both
 * the lead and (optionally) a campaign.
 */

"use strict";

const { getDb }  = require("../db/connection");
const { v4: uuidv4 } = require("uuid");

const ANTHROPIC_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const MODEL             = "gemini-2.5-flash";

// ─────────────────────────────────────────────────────────────────────────────
//  SYSTEM PROMPT — Expert cold-email copywriter
// ─────────────────────────────────────────────────────────────────────────────
const OUTREACH_SYSTEM_PROMPT = `
You are an elite B2B cold email copywriter who has written and A/B tested
over 50,000 outreach emails for digital agencies targeting US small businesses.

YOUR STYLE RULES:
- Subject line: under 8 words, curiosity-driven, never clickbait, no emojis
- Opening line: reference something SPECIFIC about their business or industry —
  never "I came across your website" or "I hope this finds you well"
- Body: 3–5 short sentences MAX. One clear value proposition. No feature lists.
- CTA: ONE soft ask — a 15-minute call, a quick question, or a yes/no reply
- Tone: peer-to-peer, confident, not salesy. Write like a trusted advisor,
  not a vendor.
- Length: entire email body under 120 words
- NEVER mention "ROI", "synergy", "solutions", "leverage", or "game-changer"

You will be given lead details. Generate a subject line + email body.

Return ONLY valid JSON matching this exact shape (no markdown, no preamble):
{
  "subject": "<email subject line>",
  "body": "<full email body, use \\n for line breaks>"
}
`.trim();

function buildOutreachPrompt(lead, campaignContext) {
  return `
Generate a cold outreach email for this business:

  Business : ${lead.business_name}
  Industry : ${lead.industry}
  Location : ${lead.location}
  Website  : ${lead.website  || "not provided"}
  Notes    : ${lead.notes    || "none"}
  Score    : ${lead.score    || "unscored"}/10
  Campaign context: ${campaignContext || "General digital services outreach"}

Write a subject + body. Return only the JSON object.
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  AI CALL
// ─────────────────────────────────────────────────────────────────────────────
async function callClaude(userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const res = await fetch(ANTHROPIC_API_URL, {
    method : "POST",
    headers: {
      "Content-Type"     : "application/json",
      "x-api-key"        : apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model      : MODEL,
      max_tokens : 500,
      system     : OUTREACH_SYSTEM_PROMPT,
      messages   : [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API error [${res.status}]: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate and save a personalised outreach email for a lead.
 *
 * @param {object} lead            - full lead row from DB
 * @param {string} [campaignId]    - optional campaign to link
 * @param {string} [campaignContext] - extra context for the AI
 * @returns {object}               - saved outreach_email row
 */
async function generateAndSave(lead, { campaignId, campaignContext } = {}) {
  const raw    = await callClaude(buildOutreachPrompt(lead, campaignContext));
  const clean  = raw.replace(/```json|```/gi, "").trim();

  let parsed;
  try   { parsed = JSON.parse(clean); }
  catch { throw new Error(`AI returned non-JSON: ${raw.slice(0, 200)}`); }

  const subject = String(parsed.subject || "").trim();
  const body    = String(parsed.body    || "").trim();

  if (!subject || !body) throw new Error("AI returned empty subject or body.");

  return saveEmail({ leadId: lead.id, campaignId, subject, body });
}

/**
 * Generate email WITHOUT saving (preview / test mode).
 */
async function generatePreview(lead, campaignContext) {
  const raw   = await callClaude(buildOutreachPrompt(lead, campaignContext));
  const clean = raw.replace(/```json|```/gi, "").trim();
  try   { return JSON.parse(clean); }
  catch { throw new Error(`AI returned non-JSON: ${raw.slice(0, 200)}`); }
}

// ─────────────────────────────────────────────
//  DB helpers
// ─────────────────────────────────────────────

function saveEmail({ leadId, campaignId, subject, body }) {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO outreach_emails (id, lead_id, campaign_id, subject, body)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, leadId, campaignId || null, subject, body);
  return getEmailById(id);
}

function getEmailById(id) {
  return getDb().prepare("SELECT * FROM outreach_emails WHERE id = ?").get(id);
}

function getEmailsForLead(leadId) {
  return getDb()
    .prepare("SELECT * FROM outreach_emails WHERE lead_id = ? ORDER BY created_at DESC")
    .all(leadId);
}

function getEmailsForCampaign(campaignId) {
  return getDb()
    .prepare("SELECT * FROM outreach_emails WHERE campaign_id = ? ORDER BY created_at DESC")
    .all(campaignId);
}

module.exports = {
  generateAndSave, generatePreview,
  getEmailById, getEmailsForLead, getEmailsForCampaign,
  OUTREACH_SYSTEM_PROMPT,
};
