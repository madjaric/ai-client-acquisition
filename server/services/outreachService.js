/**
 * services/outreachGenerator.js
 *
 * PERSONALIZED EMAIL ENGINE V2 — DUAL ENGINE SYSTEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ENGINE A — Businesses WITH websites
 *   Goal: Sell lead gen, conversion optimization, outreach automation, LeadFlowAI
 *   Focus: ROI, lead generation, revenue growth
 *
 * ENGINE B — Businesses WITHOUT websites
 *   Goal: Sell online presence, credibility, website solution
 *   Angle: Reference missing website + existing visibility + opportunity
 *   If preview exists: reference generated website
 *
 * OUTPUT PER ENGINE:
 *   1. Subject Line
 *   2. Opening
 *   3. Main Value Proposition
 *   4. CTA
 *   5. Follow-up Sequence (Day 3 / Day 7 / Day 14)
 */

"use strict";

const { getDb }      = require("../db/connection");
const { v4: uuidv4 } = require("uuid");

const MODEL   = "gemini-2.5-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// ─────────────────────────────────────────────────────────────────────────────
//  ENGINE A SYSTEM PROMPT — Has Website → Sell Lead Gen / Digital Marketing
// ─────────────────────────────────────────────────────────────────────────────
const ENGINE_A_SYSTEM_PROMPT = `
You are a senior B2B Sales Development Representative who closes digital agency contracts
for businesses that already have a website but are under-performing online.

YOUR GOAL: Sell lead generation services, conversion rate optimisation,
outreach automation, and the LeadFlowAI platform.

ANGLE: This business has a website but it's likely not generating consistent leads.
Focus on: revenue growth, lead volume, cost-per-acquisition, automation, ROI.

STRICT MODE: Return ONLY valid JSON. No markdown. No explanation.

OUTPUT FORMAT:
{
  "subject_line": "4-7 words, curiosity-driven, no clickbait",
  "opening": "1-2 sentences. Reference something specific about their industry/location. Never use 'I came across your website' or 'I hope this finds you well'.",
  "value_proposition": "2-3 sentences max. One clear ROI-focused offer. No feature lists.",
  "cta": "1 sentence. ONE soft ask — 15-min call, quick question, or yes/no reply.",
  "follow_up_day3": "60-80 word follow-up for Day 3 after no reply. Reference original email. Add new angle.",
  "follow_up_day7": "60-80 word follow-up for Day 7. Shift to social proof or urgency angle.",
  "follow_up_day14": "50-70 word final follow-up for Day 14. Short, easy, low-pressure.",
  "personalization_notes": "Notes on how this was personalized to the lead."
}

RULES:
- Subject line: under 8 words, never start with "Re:" or "Following up"
- Entire email body (opening + value_prop + cta) under 120 words
- Peer-to-peer tone, confident, not salesy
- NEVER use: ROI (in email body), synergy, solutions, leverage, game-changer, seamless, innovative
- Follow-ups must feel like new perspectives, not copy-paste
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
//  ENGINE B SYSTEM PROMPT — No Website → Sell Website / Online Presence
// ─────────────────────────────────────────────────────────────────────────────
const ENGINE_B_SYSTEM_PROMPT = `
You are a senior B2B Sales Development Representative who sells website packages
and online presence solutions to local businesses with NO website.

YOUR GOAL: Sell a website, credibility, and customer acquisition system.
Use curiosity and value first. Do NOT immediately pitch a price.

ANGLE: This business has no website. Their competitors are capturing the customers
searching for them online. Reference their existing Google presence (reviews).
If a website preview was generated, reference it as a "preview we created for them."

STRICT MODE: Return ONLY valid JSON. No markdown. No explanation.

OUTPUT FORMAT:
{
  "subject_line": "4-7 words, curiosity-driven, references their business or industry",
  "opening": "1-2 sentences. Reference their Google reviews or local reputation. Reference the website preview if available. Never generic.",
  "value_proposition": "2-3 sentences. Focus on credibility, customer trust, and the customers they're losing daily with no online presence.",
  "cta": "1 sentence. Soft — offer to share the preview, ask if they've thought about it, or a yes/no question.",
  "follow_up_day3": "60-80 words. Follow up and reference the website preview. Add specific industry stat about customers checking websites before calling.",
  "follow_up_day7": "60-80 words. Shift to competitor angle — their competitors are online, they're invisible.",
  "follow_up_day14": "50-70 words. Final touch. Extremely low-pressure. Offer the preview as a free gift.",
  "personalization_notes": "Notes on how this was personalized to the lead."
}

RULES:
- NEVER immediately sell or quote a price
- Always lead with curiosity and value
- Reference the website preview if one exists (websitePreviewExists = true)
- Subject line under 8 words
- Entire email body under 130 words
- Tone: friendly local advisor, not a cold salesperson
- Use the business's Google reviews as social proof of their worth
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
//  PROMPT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────
function buildEngineAPrompt(input) {
  const { business_name, industry, location, lead_score, estimated_value, website, notes, tone_override } = input;

  const tier = lead_score >= 80 ? "Hot (direct & confident)"
    : lead_score >= 60 ? "Warm (curiosity driven)"
    : lead_score >= 40 ? "Mild (brief & soft)"
    : "Cold (no hard ask)";

  return `
Generate Engine A outreach (business HAS a website):

Business Name  : ${business_name}
Industry       : ${industry}
Location       : ${location}
Score          : ${lead_score}/100 — ${tier}
Estimated Value: ${estimated_value || "unknown"}
Website        : ${website}
Notes          : ${notes || "none"}
Tone Override  : ${tone_override || "default"}

Return ONLY valid JSON.
`.trim();
}

function buildEngineBPrompt(input) {
  const { business_name, industry, location, lead_score, notes, tone_override, websitePreviewExists, review_count, rating } = input;

  return `
Generate Engine B outreach (business has NO website):

Business Name        : ${business_name}
Industry             : ${industry}
Location             : ${location}
Score                : ${lead_score}/100
Google Reviews       : ${review_count || "unknown"} reviews, ${rating || "unknown"} rating
Notes                : ${notes || "none"}
Tone Override        : ${tone_override || "default"}
Website Preview Exists: ${websitePreviewExists ? "YES — reference it in opening and follow-ups" : "NO"}

Return ONLY valid JSON.
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  GEMINI API CALL
// ─────────────────────────────────────────────────────────────────────────────
async function callGemini(systemPrompt, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in environment variables.");

  const response = await fetch(`${API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
      }],
      generationConfig: {
        temperature      : 0.7,
        maxOutputTokens  : 2500,
        responseMimeType : "application/json",
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Gemini API error [${response.status}]: ${errBody}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ─────────────────────────────────────────────────────────────────────────────
//  PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseResponse(raw) {
  const cleaned = raw.replace(/```json|```/gi, "").trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch { throw new Error(`AI returned invalid JSON: ${raw.slice(0, 300)}`); }

  const fields = ["subject_line","opening","value_proposition","cta","follow_up_day3","follow_up_day7","follow_up_day14"];
  for (const f of fields) {
    if (!parsed[f]) throw new Error(`Missing field: ${f}`);
  }

  return {
    subject_line          : String(parsed.subject_line).trim(),
    // Compose full email_body from parts (backwards compat with DB schema)
    email_body            : [parsed.opening, parsed.value_proposition, parsed.cta].filter(Boolean).join("\n\n").trim(),
    opening               : String(parsed.opening).trim(),
    value_proposition     : String(parsed.value_proposition).trim(),
    cta                   : String(parsed.cta).trim(),
    follow_up_day3        : String(parsed.follow_up_day3).trim(),
    follow_up_day7        : String(parsed.follow_up_day7).trim(),
    follow_up_day14       : String(parsed.follow_up_day14).trim(),
    personalization_notes : String(parsed.personalization_notes || "").trim(),
    // Legacy field for outreach panel
    short_dm              : String(parsed.cta || "").trim(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  DB HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function saveMessage({ leadId, campaignId, engine, input, output }) {
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
    `${MODEL}:engine-${engine}`
  );

  return getMessageById(id);
}

function getMessageById(id) {
  return getDb().prepare("SELECT * FROM generated_messages WHERE id = ?").get(id);
}

function getMessagesForLead(leadId, { limit = 20, offset = 0 } = {}) {
  return getDb().prepare(`
    SELECT * FROM generated_messages WHERE lead_id = ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(leadId, Number(limit), Number(offset));
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

  const total = db.prepare("SELECT COUNT(*) as n FROM generated_messages").get().n;
  return { messages, total };
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * generateOutreach(input)
 *
 * Automatically selects Engine A (has website) or Engine B (no website).
 *
 * @param {object} input
 * @param {string} input.business_name
 * @param {string} input.industry
 * @param {string} input.location
 * @param {number} input.lead_score  — 0-100
 * @param {string} [input.estimated_value]
 * @param {string} [input.website]   — present = Engine A, absent = Engine B
 * @param {string} [input.notes]
 * @param {string} [input.tone_override]
 * @param {boolean}[input.websitePreviewExists] — Engine B: reference preview in email
 * @param {number} [input.review_count]  — Engine B: for personalisation
 * @param {number} [input.rating]        — Engine B: for personalisation
 * @param {string} [input.leadId]
 * @param {string} [input.campaignId]
 * @param {boolean}[input.saveToDb]
 */
async function generateOutreach(input) {
  const {
    business_name, industry, location,
    lead_score, estimated_value,
    website, notes, tone_override,
    websitePreviewExists, review_count, rating,
    leadId, campaignId, saveToDb = true,
  } = input;

  if (!business_name || !industry || !location) {
    throw new Error("business_name, industry, and location are required.");
  }
  if (lead_score == null) {
    throw new Error("lead_score is required (0-100).");
  }

  const hasWebsite = website && website.trim().length > 0;
  const engine     = hasWebsite ? "A" : "B";

  let prompt, systemPrompt;

  if (hasWebsite) {
    systemPrompt = ENGINE_A_SYSTEM_PROMPT;
    prompt = buildEngineAPrompt({ business_name, industry, location, lead_score, estimated_value, website, notes, tone_override });
  } else {
    systemPrompt = ENGINE_B_SYSTEM_PROMPT;
    prompt = buildEngineBPrompt({ business_name, industry, location, lead_score, notes, tone_override, websitePreviewExists, review_count, rating });
  }

  const raw    = await callGemini(systemPrompt, prompt);
  const output = parseResponse(raw);

  if (!saveToDb || !leadId) {
    return {
      ...output,
      engine,
      lead_score,
      estimated_value: estimated_value || null,
      model: MODEL,
      saved: false,
    };
  }

  const saved = saveMessage({ leadId, campaignId, engine, input: { lead_score, estimated_value, tone_override }, output });
  return { ...saved, engine, opening: output.opening, value_proposition: output.value_proposition, cta: output.cta, follow_up_day3: output.follow_up_day3, follow_up_day7: output.follow_up_day7, follow_up_day14: output.follow_up_day14 };
}

module.exports = {
  generateOutreach,
  getMessageById,
  getMessagesForLead,
  getAllMessages,
  ENGINE_A_SYSTEM_PROMPT,
  ENGINE_B_SYSTEM_PROMPT,
  buildEngineAPrompt,
  buildEngineBPrompt,
};