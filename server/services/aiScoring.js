/**
 * services/aiScoring.js
 *
 * DUAL AI SCORING SYSTEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * MODEL A — Businesses WITH websites
 *   Scores: website quality, SEO, reviews, social activity, industry competitiveness
 *   Purpose: Probability of purchasing lead generation / digital marketing services
 *
 * MODEL B — Businesses WITHOUT websites
 *   Scores: review presence, business age, industry demand, location demand, social presence
 *   Purpose: Probability of purchasing a website + online presence package
 *   Extra outputs: website_opportunity_score, website_revenue_potential, digital_presence_score
 *
 * Score labels: 90-100 = Hot | 70-89 = Warm | 40-69 = Mild | 0-39 = Cold
 */

"use strict";

console.log("🔥 LOADED DUAL AI SCORING ENGINE");

const MODEL          = "gemini-2.5-flash-lite";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_TOKENS     = 1200;

// ─────────────────────────────────────────────────────────────────────────────
//  SCORE LABEL HELPER
// ─────────────────────────────────────────────────────────────────────────────
function getScoreLabel(score) {
  if (score >= 90) return "Hot";
  if (score >= 70) return "Warm";
  if (score >= 40) return "Mild";
  return "Cold";
}

// ─────────────────────────────────────────────────────────────────────────────
//  MODEL A — SYSTEM PROMPT (Has Website → Sell Lead Gen / Digital Marketing)
// ─────────────────────────────────────────────────────────────────────────────
const MODEL_A_SYSTEM_PROMPT = `
You are a senior B2B client acquisition analyst specialising in digital agency sales.
Your task: evaluate a business that HAS a website and score their probability of purchasing
lead generation services, conversion optimisation, SEO, or digital marketing automation.

Score on a 0–100 scale. Consider these weighted factors:
  - Website quality & professionalism (visible from URL/notes)
  - SEO presence & organic visibility signals
  - Google review count & rating (social proof baseline)
  - Social media activity signals
  - Industry competitiveness (how hard is it for them to get leads organically?)
  - Contact availability (phone, email, booking form)
  - Estimated monthly ad spend / growth appetite implied by size

Return ONLY valid JSON. No markdown. No backticks.

{
  "score": 0-100,
  "score_label": "Hot|Warm|Mild|Cold",
  "tier": "A|B|C|D",
  "model": "A",
  "estimated_value_range": "$X–$Y/month",
  "confidence": "high|medium|low",
  "reasoning": "2-4 sentences explaining the score",
  "score_breakdown": {
    "website_quality": 0-20,
    "seo_quality": 0-20,
    "review_signals": 0-15,
    "social_activity": 0-15,
    "industry_competitiveness": 0-15,
    "contact_availability": 0-15
  },
  "red_flags": [],
  "recommended_action": "specific next action",
  "conversion_probability": "high|medium|low",
  "best_service_angle": "what to pitch first"
}
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
//  MODEL B — SYSTEM PROMPT (No Website → Sell Website / Online Presence)
// ─────────────────────────────────────────────────────────────────────────────
const MODEL_B_SYSTEM_PROMPT = `
You are a senior digital sales analyst specialising in selling websites to local businesses
that currently have NO online presence.

Your task: evaluate a business WITHOUT a website and score their probability of purchasing
a website + online presence package.

Score on a 0–100 scale. Consider these weighted factors:
  - Google review count (proves real customers exist)
  - Google rating (proves business quality)
  - Business age implied by review history
  - Industry demand for websites (plumbers/dentists/restaurants need sites urgently)
  - Location demand (urban vs rural, competitive market)
  - Social presence (if any Instagram/Facebook signals in notes)
  - Pain of having no website in 2025 for this industry

Also generate:
  - website_opportunity_score (0-100): urgency of the website opportunity
  - website_revenue_potential: estimated one-time + monthly value of a site deal
  - digital_presence_score (0-100): current digital footprint strength
  - recommended_website_type: what kind of site to pitch
  - recommended_pages: number of pages
  - recommended_cta: primary call-to-action for the website
  - recommended_conversion_strategy: how the website will get them more business

Return ONLY valid JSON. No markdown. No backticks.

{
  "score": 0-100,
  "score_label": "Hot|Warm|Mild|Cold",
  "tier": "A|B|C|D",
  "model": "B",
  "estimated_value_range": "$X one-time + $Y/month",
  "confidence": "high|medium|low",
  "reasoning": "2-4 sentences explaining the score",
  "score_breakdown": {
    "review_presence": 0-20,
    "review_quality": 0-15,
    "industry_demand": 0-20,
    "location_demand": 0-15,
    "social_presence": 0-15,
    "no_website_urgency": 0-15
  },
  "red_flags": [],
  "recommended_action": "specific next action",
  "conversion_probability": "high|medium|low",
  "website_opportunity_score": 0-100,
  "website_revenue_potential": "$X one-time / $Y/mo maintenance",
  "digital_presence_score": 0-100,
  "recommended_website_type": "e.g. Lead Gen Landing Page | Appointment Booking Site | Menu + Reservation Site",
  "recommended_pages": 3,
  "recommended_cta": "e.g. Call Now | Book Appointment | Get a Free Quote",
  "recommended_conversion_strategy": "short description of the conversion approach"
}
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
//  PROMPT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────
function buildModelAPrompt({ business_name, industry, location, website, notes }) {
  return `
Score this lead (HAS website) for likelihood of purchasing digital marketing / lead gen services:

Business Name : ${business_name}
Industry      : ${industry}
Location      : ${location}
Website       : ${website}
Notes         : ${notes || "None"}

Return ONLY raw JSON.
`.trim();
}

function buildModelBPrompt({ business_name, industry, location, notes }) {
  return `
Score this lead (NO website) for likelihood of purchasing a website / online presence package:

Business Name : ${business_name}
Industry      : ${industry}
Location      : ${location}
Website       : None / Not found
Notes         : ${notes || "None"}

Return ONLY raw JSON.
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  GEMINI API CALL
// ─────────────────────────────────────────────────────────────────────────────
async function callGemini(systemPrompt, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured in environment variables.");

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: systemPrompt + "\n\n" + userPrompt }],
      }],
      generationConfig: {
        temperature      : 0.2,
        maxOutputTokens  : MAX_TOKENS,
        responseMimeType : "application/json",
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
//  RESPONSE PARSERS
// ─────────────────────────────────────────────────────────────────────────────
function parseModelAResponse(raw) {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/gi, "").trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (err) {
    console.error("MODEL A RAW RESPONSE:", raw);
    throw new Error(`Model A returned non-JSON: ${raw.slice(0, 200)}`);
  }

  const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
  return {
    // Core fields
    score,
    lead_score            : Math.round(score / 10),  // legacy 1-10 field for DB compat
    score_label           : parsed.score_label || getScoreLabel(score),
    tier                  : deriveTier(score),
    model                 : "A",
    estimated_value_range : String(parsed.estimated_value_range || "Unknown"),
    confidence            : ["high","medium","low"].includes(parsed.confidence) ? parsed.confidence : "medium",
    reasoning             : String(parsed.reasoning || ""),
    score_breakdown       : parsed.score_breakdown || {},
    red_flags             : Array.isArray(parsed.red_flags) ? parsed.red_flags.map(String) : [],
    recommended_action    : String(parsed.recommended_action || ""),
    conversion_probability: parsed.conversion_probability || "medium",
    best_service_angle    : String(parsed.best_service_angle || ""),
    // Model B fields default to null for DB consistency
    website_opportunity_score    : null,
    website_revenue_potential    : null,
    digital_presence_score       : null,
    recommended_website_type     : null,
    recommended_pages            : null,
    recommended_cta              : null,
    recommended_conversion_strategy: null,
  };
}

function parseModelBResponse(raw) {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/gi, "").trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (err) {
    console.error("MODEL B RAW RESPONSE:", raw);
    throw new Error(`Model B returned non-JSON: ${raw.slice(0, 200)}`);
  }

  const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
  const woScore = Math.max(0, Math.min(100, Number(parsed.website_opportunity_score) || 0));
  const dpScore = Math.max(0, Math.min(100, Number(parsed.digital_presence_score) || 0));

  return {
    score,
    lead_score            : Math.round(score / 10),
    score_label           : parsed.score_label || getScoreLabel(score),
    tier                  : deriveTier(score),
    model                 : "B",
    estimated_value_range : String(parsed.estimated_value_range || "Unknown"),
    confidence            : ["high","medium","low"].includes(parsed.confidence) ? parsed.confidence : "medium",
    reasoning             : String(parsed.reasoning || ""),
    score_breakdown       : parsed.score_breakdown || {},
    red_flags             : Array.isArray(parsed.red_flags) ? parsed.red_flags.map(String) : [],
    recommended_action    : String(parsed.recommended_action || ""),
    conversion_probability: parsed.conversion_probability || "medium",
    best_service_angle    : null,
    // Model B exclusive fields
    website_opportunity_score    : woScore,
    website_revenue_potential    : String(parsed.website_revenue_potential || ""),
    digital_presence_score       : dpScore,
    recommended_website_type     : String(parsed.recommended_website_type || ""),
    recommended_pages            : Number(parsed.recommended_pages) || 5,
    recommended_cta              : String(parsed.recommended_cta || ""),
    recommended_conversion_strategy: String(parsed.recommended_conversion_strategy || ""),
  };
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
  const { business_name, industry, location, website, notes } = lead;

  if (!business_name || !industry || !location) {
    throw new Error("scoreLead requires: business_name, industry, location");
  }

  const hasWebsite = website && website.trim().length > 0;

  let raw, result;

  if (hasWebsite) {
    // MODEL A — has website
    const prompt = buildModelAPrompt({ business_name, industry, location, website, notes });
    raw    = await callGemini(MODEL_A_SYSTEM_PROMPT, prompt);
    result = parseModelAResponse(raw);
  } else {
    // MODEL B — no website
    const prompt = buildModelBPrompt({ business_name, industry, location, notes });
    raw    = await callGemini(MODEL_B_SYSTEM_PROMPT, prompt);
    result = parseModelBResponse(raw);
  }

  return {
    ...result,
    scored_at_ms: Date.now(),
    model_version: MODEL,
  };
}

module.exports = {
  scoreLead,
  getScoreLabel,
  deriveTier,
  MODEL_A_SYSTEM_PROMPT,
  MODEL_B_SYSTEM_PROMPT,
  buildModelAPrompt,
  buildModelBPrompt,
};