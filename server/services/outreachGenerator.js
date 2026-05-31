/**
 * services/outreachGenerator.js
 *
 * Generates three formats of personalised outreach copy using Gemini:
 *   1. subject_line   — email subject (under 8 words)
 *   2. email_body     — full cold email (≤150 words)
 *   3. short_dm       — LinkedIn / Twitter DM (≤60 words)
 *
 * Inputs used by the AI:
 *   business_name, industry, location, lead_score, estimated_value,
 *   website (opt), notes (opt), tone_override (opt)
 *
 * All generated messages are saved to `generated_messages` table
 * and linked to the originating lead.
 *
 * Requires: GEMINI_API_KEY in .env
 */

"use strict";

const { getDb } = require("../db/connection");
const { v4: uuidv4 } = require("uuid");

// ─────────────────────────────────────────────────────────────────────────────
//  GEMINI CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = "gemini-2.5-flash";

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;

// ─────────────────────────────────────────────────────────────────────────────
//  SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `
You are a senior B2B Sales Development Representative (SDR) with 12 years of
experience closing digital service contracts for agencies and SaaS companies.

STRICT MODE:
Return ONLY valid JSON. No markdown. No explanation.

═══════════════════════════════════
WHAT YOU KNOW ABOUT THIS LEAD
═══════════════════════════════════

You will receive:
- business_name
- industry
- location
- lead_score (1–10)
- estimated_value
- website
- notes
- tone_override

═══════════════════════════════════
OUTPUT FORMAT (STRICT)
═══════════════════════════════════

{
  "subject_line": "",
  "email_body": "",
  "short_dm": "",
  "personalization_notes": ""
}

═══════════════════════════════════
WRITING RULES
═══════════════════════════════════

EMAIL BODY:
- 100–150 words max
- 2–4 short paragraphs
- Must include industry/location hook in first line
- One clear value proposition
- One soft CTA
- No fluff, no buzzwords

SUBJECT LINE:
- 4–7 words max
- Specific and contextual
- No clickbait

SHORT DM:
- 40–60 words max
- Conversational, natural
- No greetings like "Hi"

NEVER USE:
synergy, leverage, ROI, cutting-edge, best-in-class, seamless, innovative
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
//  PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildPrompt(input) {
  const {
    business_name,
    industry,
    location,
    lead_score,
    estimated_value,
    website,
    notes,
    tone_override,
  } = input;

  const tier =
    lead_score >= 8 ? "A (high-value - direct & confident)"
    : lead_score >= 6 ? "B (warm - curiosity driven)"
    : lead_score >= 4 ? "C (lukewarm - brief & soft)"
    : "D (low priority - no hard ask)";

  const websitePreviewExists = input.websitePreviewExists || false;
  const preview_url          = input.preview_url || null;

  const previewBlock = websitePreviewExists ? `
CRITICAL — WEBSITE PREVIEW EXISTS:
A custom website preview has already been built for ${business_name}.
${preview_url
  ? `The preview URL is: ${preview_url}
This URL MUST appear verbatim in the email_body. Include it as a clickable link like:
"Here is your free website preview: ${preview_url}"
The recipient must be able to click this link to see their site.`
  : `Reference that a preview has been created but do not invent a URL.
Say something like: "We put together a free website preview for you — reply to this email and we'll send it over."`
}
Rules:
- Subject line MUST reference the preview (e.g. "Built something for ${business_name}")
- Opening MUST mention the preview in the first sentence
- Do NOT pitch price. Lead with the preview as a gift/curiosity hook.
` : "";

  return `
Generate outreach messages:

Business Name: ${business_name}
Industry: ${industry}
Location: ${location}
Lead Score: ${lead_score}/10 - Tier ${tier}
Estimated Value: ${estimated_value || "unknown"}
Website: ${website || "NOT FOUND — this business has no website"}
Notes: ${notes ? notes.replace(/\[WEBSITE_PREVIEW_GENERATED\]/g, "").replace(/\[PREVIEW_URL:[^\]]*\]/g, "").trim() : "none"}
Tone Override: ${tone_override || "default"}
${previewBlock}
Follow ALL rules from system prompt.
Return ONLY JSON.
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  GEMINI API CALL
// ─────────────────────────────────────────────────────────────────────────────

async function callGemini(userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in environment variables.");
  }

  const response = await fetch(`${API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${SYSTEM_PROMPT}\n\n${userPrompt}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2000,
		responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Gemini API error [${response.status}]: ${errBody}`);
  }

  const data = await response.json();

  return (
    data.candidates?.[0]?.content?.parts?.[0]?.text || ""
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  PARSER
// ─────────────────────────────────────────────────────────────────────────────

function parseResponse(raw) {
  const cleaned = raw.replace(/```json|```/gi, "").trim();

  let parsed;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`AI returned invalid JSON: ${raw.slice(0, 300)}`);
  }

  const subject_line = String(parsed.subject_line || "").trim();
  const email_body = String(parsed.email_body || "").trim();
  const short_dm = String(parsed.short_dm || "").trim();
  const personalization_notes = String(parsed.personalization_notes || "").trim();

  if (!subject_line) throw new Error("Missing subject_line");
  if (!email_body) throw new Error("Missing email_body");
  if (!short_dm) throw new Error("Missing short_dm");

  return {
    subject_line,
    email_body,
    short_dm,
    personalization_notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  DB
// ─────────────────────────────────────────────────────────────────────────────

function saveMessage({ leadId, campaignId, input, output }) {
  const db = getDb();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO generated_messages (
      id, lead_id, campaign_id,
      subject_line, email_body, short_dm, personalization_notes,
      lead_score_at_generation, estimated_value_at_generation,
      tone_override, model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    leadId,
    campaignId || null,
    output.subject_line,
    output.email_body,
    output.short_dm,
    output.personalization_notes,
    input.lead_score ?? null,
    input.estimated_value ?? null,
    input.tone_override ?? null,
    MODEL
  );

  return getMessageById(id);
}

function getMessageById(id) {
  return getDb()
    .prepare("SELECT * FROM generated_messages WHERE id = ?")
    .get(id);
}

function getMessagesForLead(leadId, { limit = 20, offset = 0 } = {}) {
  return getDb()
    .prepare(`
      SELECT * FROM generated_messages
      WHERE lead_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(leadId, Number(limit), Number(offset));
}

function getAllMessages({ limit = 50, offset = 0 } = {}) {
  const db = getDb();

  const messages = db.prepare(`
    SELECT gm.*, l.business_name, l.industry, l.location
    FROM generated_messages gm
    LEFT JOIN leads l ON l.id = gm.lead_id
    ORDER BY gm.created_at DESC
    LIMIT ? OFFSET ?
  `).all(Number(limit), Number(offset));

  const total = db.prepare(
    "SELECT COUNT(*) as n FROM generated_messages"
  ).get().n;

  return { messages, total };
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

async function generateOutreach(input) {
  const {
    business_name,
    industry,
    location,
    lead_score,
    estimated_value,
    website,
    notes,
    tone_override,
    websitePreviewExists = false,
    preview_url = null,
    leadId,
    campaignId,
    saveToDb = true,
  } = input;

  if (!business_name || !industry || !location) {
    throw new Error("business_name, industry, and location are required.");
  }

  if (lead_score == null) {
    throw new Error("lead_score is required (1–10).");
  }

  const userPrompt = buildPrompt({
    business_name,
    industry,
    location,
    lead_score,
    estimated_value,
    website,
    notes,
    tone_override,
    websitePreviewExists,
    preview_url,
  });

  const raw = await callGemini(userPrompt);
  const output = parseResponse(raw);

  if (!saveToDb || !leadId) {
    return {
      ...output,
      lead_score,
      estimated_value: estimated_value || null,
      model: MODEL,
      saved: false,
    };
  }

  return saveMessage({
    leadId,
    campaignId,
    input: { lead_score, estimated_value, tone_override },
    output,
  });
}

module.exports = {
  generateOutreach,
  getMessageById,
  getMessagesForLead,
  getAllMessages,
  SYSTEM_PROMPT,
  buildPrompt,
};