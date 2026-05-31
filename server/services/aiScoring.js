/**
 * services/aiScoring.js
 *
 * PREMIUM SALES INTELLIGENCE ENGINE
 * Transforms lead data into actionable business development insights.
 * Analyzes only verified data — never invents signals.
 */

"use strict";

const MODEL = "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_TOKENS = 1800;

// ─────────────────────────────────────────────────────────────────────────────
//  SYSTEM PROMPT — Premium Sales Intelligence
// ─────────────────────────────────────────────────────────────────────────────
const SCORING_SYSTEM_PROMPT = `
You are a senior business development consultant and digital agency sales strategist.
Your job is to analyze a local business lead and produce premium sales intelligence
that a salesperson can immediately act on.

CRITICAL RULES — follow these absolutely:
1. NEVER invent facts. Only use data explicitly provided.
2. NEVER assume social media presence, website tech, ads, or CRM unless stated in the data.
3. If a field is "Not provided" or empty — treat it as unknown, not negative.
4. Write like a sharp human consultant, not a marketing bot.
5. Avoid filler phrases: "great opportunity", "leverage", "synergy", "seamless", "cutting-edge".
6. Be specific. Reference actual numbers and facts from the input.
7. Keep each section concise and high-signal. No padding.

SCORING LOGIC:
- Score 80-100 (Hot): No website + strong reviews + local service business + high-intent industry
- Score 60-79 (Warm): Weak/missing website + decent reviews + clear opportunity
- Score 40-59 (Mild): Has website but with obvious gaps, limited signals
- Score 0-39 (Cold): Strong digital infrastructure, limited opportunity detected

HIGH-INTENT INDUSTRIES (score higher for these):
plumbing, hvac, roofing, electrical, dental, medical, legal, accounting,
auto repair, landscaping, pest control, cleaning, moving, construction,
cosmetic, tattoo, physiotherapy, veterinary, real estate

WEBSITE OPPORTUNITY by industry category:
- Automotive/Repair: service showcase, quote requests, booking, trust-building
- Medical/Dental/Health: appointment booking, service pages, patient trust, FAQs
- Legal/Accounting: consultation booking, case types, credentials, trust signals
- Restaurants/Food: menu visibility, reservations, hours, delivery info
- Contractors/Trades: project gallery, lead capture forms, service areas, quotes
- Beauty/Personal care: booking system, portfolio, pricing, reviews showcase
- Retail/Local shops: product showcase, hours, directions, online presence

OUTPUT FORMAT — return ONLY valid JSON, no markdown, no backticks:

{
  "lead_score": 0-100,
  "tier": "A|B|C|D",
  "confidence": "high|medium|low",
  "estimated_value_range": "e.g. $1,500–$3,000 one-time + $200/mo",
  "revenue_potential": "High|Medium|Low",
  "revenue_potential_reason": "One sentence explaining why, referencing actual data",
  "opportunity_summary": "2-3 sentences. What was found, why it matters, why contact this lead now. Be specific — reference their actual review count, rating, location, industry.",
  "digital_presence_audit": [
    "✅ Google Business Profile detected",
    "✅ 4.9/5 rating from 43 reviews",
    "✅ Phone number available",
    "❌ Website not detected",
    "❌ Online booking system not detected",
    "❌ Lead capture form not detected"
  ],
  "website_opportunity": "2-3 sentences specific to this industry explaining exactly how a website would help THIS business. Reference their category and situation.",
  "outreach_angle": "One punchy sentence a salesperson could use as their opening hook. Reference the actual gap found.",
  "outreach_message": "50-100 word cold outreach message. Professional, specific, references the actual opportunity. No generic marketing language. Write as if from a real person.",
  "red_flags": [],
  "recommended_action": "One specific next action. Not 'schedule a call' — be precise about what to say or send."
}
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
//  USER PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function buildUserPrompt({ business_name, industry, location, website, notes, rating, review_count, phone }) {
  const hasWebsite = website && website.trim() && website !== "Not provided";
  const hasRating  = rating  && Number(rating) > 0;
  const hasReviews = review_count && Number(review_count) > 0;

  return `
Analyze this business lead and produce premium sales intelligence:

BUSINESS DATA (only use what is provided):
  Business Name   : ${business_name}
  Industry        : ${industry}
  Location        : ${location}
  Website         : ${hasWebsite ? website : "NOT DETECTED — no website found"}
  Phone           : ${phone || "Not provided"}
  Google Rating   : ${hasRating ? rating + "/5" : "Not available"}
  Google Reviews  : ${hasReviews ? review_count + " reviews" : "Not available"}
  Additional Notes: ${notes || "None"}

CONTEXT:
  - Has website: ${hasWebsite ? "YES — " + website : "NO"}
  - Review signals: ${hasRating && hasReviews ? `${review_count} reviews at ${rating}/5` : "Limited or none"}

Score this lead 0-100 and generate full sales intelligence.
Return ONLY valid JSON.
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  GEMINI API CALL
// ─────────────────────────────────────────────────────────────────────────────
async function callGemini(userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: SCORING_SYSTEM_PROMPT + "\n\n" + userPrompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: MAX_TOKENS,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini API error [${response.status}]: ${body}`);
  }

  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ─────────────────────────────────────────────────────────────────────────────
//  RESPONSE PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseScoreResponse(raw) {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/gi, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("RAW AI RESPONSE:", raw);
    throw new Error(`AI returned non-JSON response: ${raw.slice(0, 200)}`);
  }

  const score = Math.max(0, Math.min(100, Number(parsed.lead_score) || 0));

  // Backwards-compatible lead_score (1-10) for DB
  const lead_score = Math.max(1, Math.min(10, Math.round(score / 10)));

  const VALID_TIERS      = ["A", "B", "C", "D"];
  const VALID_CONFIDENCE = ["high", "medium", "low"];
  const VALID_POTENTIAL  = ["High", "Medium", "Low"];

  return {
    // New 0-100 score
    score,
    score_label: getScoreLabel(score),

    // Legacy 1-10 for DB compatibility
    lead_score,

    tier: VALID_TIERS.includes(parsed.tier) ? parsed.tier : deriveTier(score),
    confidence: VALID_CONFIDENCE.includes(parsed.confidence) ? parsed.confidence : "medium",
    estimated_value_range: String(parsed.estimated_value_range || "Unknown"),

    // New premium fields
    revenue_potential: VALID_POTENTIAL.includes(parsed.revenue_potential)
      ? parsed.revenue_potential : "Medium",
    revenue_potential_reason: String(parsed.revenue_potential_reason || ""),
    opportunity_summary: String(parsed.opportunity_summary || ""),
    digital_presence_audit: Array.isArray(parsed.digital_presence_audit)
      ? parsed.digital_presence_audit.map(String) : [],
    website_opportunity: String(parsed.website_opportunity || ""),
    outreach_angle: String(parsed.outreach_angle || ""),
    outreach_message: String(parsed.outreach_message || ""),

    // Legacy fields for backwards compat
    reasoning: String(parsed.opportunity_summary || parsed.reasoning || ""),
    red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags.map(String) : [],
    recommended_action: String(parsed.recommended_action || ""),
  };
}

function getScoreLabel(score) {
  if (score >= 80) return "Hot";
  if (score >= 60) return "Warm";
  if (score >= 40) return "Mild";
  return "Cold";
}

function deriveTier(score) {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────
async function scoreLead(lead) {
  const { business_name, industry, location, website, notes, rating, review_count, phone } = lead;

  if (!business_name || !industry || !location) {
    throw new Error("scoreLead requires: business_name, industry, location");
  }

  const userPrompt = buildUserPrompt({
    business_name, industry, location, website, notes,
    rating, review_count, phone,
  });

  const raw    = await callGemini(userPrompt);
  const result = parseScoreResponse(raw);

  return {
    ...result,
    scored_at_ms: Date.now(),
    model: MODEL,
  };
}

module.exports = {
  scoreLead,
  getScoreLabel,
  deriveTier,
  SCORING_SYSTEM_PROMPT,
  buildUserPrompt,
};