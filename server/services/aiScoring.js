/**
 * services/aiScoring.js
 */

"use strict";

console.log("🔥 LOADED AI SCORING FILE");
console.log("🔥 GEMINI SCORING ACTIVE");

// STABLE GEMINI MODEL
const MODEL = "gemini-2.5-flash-lite";

const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_TOKENS = 3000;

// ─────────────────────────────────────────────────────────────────────────────
//  SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────
const SCORING_SYSTEM_PROMPT = `
You are a senior business development consultant and digital agency sales strategist.
Analyze local business leads and produce premium sales intelligence a salesperson can act on immediately.

CRITICAL RULES:
1. NEVER invent facts. Only use data explicitly provided.
2. NEVER assume social media, ads, CRM, or website tech unless stated in the input.
3. If a field says "Not provided" — treat as unknown, not negative.
4. Write like a sharp human consultant. No filler, no buzzwords.
5. Be specific — reference actual numbers from the input.
6. Keep each field concise and high-signal.

SCORING LOGIC (0-100):
- 80-100 Hot:  No website + strong reviews + local service + high-intent industry
- 60-79 Warm:  Weak/missing digital presence + clear opportunity
- 40-59 Mild:  Has website but obvious gaps
- 0-39  Cold:  Strong digital infrastructure, limited opportunity

HIGH-INTENT INDUSTRIES (score higher):
plumbing, hvac, roofing, electrical, dental, medical, legal, accounting,
auto repair, landscaping, pest control, cleaning, moving, construction,
cosmetic, tattoo, physiotherapy, veterinary, real estate

WEBSITE OPPORTUNITY by industry:
- Automotive/Repair: service showcase, quote requests, booking, trust-building
- Medical/Dental: appointment booking, service pages, patient trust, FAQs
- Legal/Accounting: consultation booking, credentials, trust signals
- Restaurants: menu, reservations, hours, delivery info
- Contractors/Trades: project gallery, lead capture, service areas, quotes
- Beauty/Personal care: booking, portfolio, pricing, reviews showcase

Return ONLY valid JSON — no markdown, no backticks, no explanation.
Keep ALL string values short enough to fit within the token limit.
outreach_message must be 50-80 words maximum.

{
  "lead_score": 0-100,
  "tier": "A|B|C|D",
  "confidence": "high|medium|low",
  "estimated_value_range": "e.g. $2,500 one-time + $200/mo",
  "revenue_potential": "High|Medium|Low",
  "revenue_potential_reason": "One sentence max referencing actual data",
  "opportunity_summary": "2-3 sentences. What was found, why it matters, why contact now. Reference actual review count and rating.",
  "digital_presence_audit": [
    "✅ Google Business Profile detected",
    "✅ 4.9/5 rating from 43 reviews",
    "❌ Website not detected",
    "❌ Online booking not detected"
  ],
  "website_opportunity": "2 sentences specific to this industry and situation.",
  "outreach_angle": "One sentence hook a salesperson can use immediately.",
  "outreach_message": "50-80 word cold outreach. Professional, specific, references actual opportunity. No generic marketing.",
  "red_flags": [],
  "recommended_action": "One specific next action — not just schedule a call."
}
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// USER PROMPT
// ─────────────────────────────────────────────────────────────────────────────
function buildUserPrompt({ business_name, industry, location, website, notes, rating, review_count, phone }) {
  const hasWebsite = website && website.trim() && website !== "Not provided";
  const hasRating  = rating  && Number(rating) > 0;
  const hasReviews = review_count && Number(review_count) > 0;

  return `
Analyze this business lead and produce premium sales intelligence:

BUSINESS DATA (only use what is explicitly provided):
  Business Name   : ${business_name}
  Industry        : ${industry}
  Location        : ${location}
  Website         : ${hasWebsite ? website : "NOT DETECTED — no website found"}
  Phone           : ${phone || "Not provided"}
  Google Rating   : ${hasRating ? rating + "/5" : "Not available"}
  Google Reviews  : ${hasReviews ? review_count + " reviews" : "Not available"}
  Additional Notes: ${notes || "None"}

SUMMARY OF SIGNALS:
  - Has website: ${hasWebsite ? "YES — " + website : "NO"}
  - Review signals: ${hasRating && hasReviews ? review_count + " reviews at " + rating + "/5" : "Not available"}

Score 0-100 and produce full sales intelligence. Return ONLY valid JSON.
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI API CALL
// ─────────────────────────────────────────────────────────────────────────────
async function callClaude(userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured in environment variables."
    );
  }

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text:
                SCORING_SYSTEM_PROMPT +
                "\n\n" +
                userPrompt,
            },
          ],
        },
      ],

      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: MAX_TOKENS,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Gemini API error [${response.status}]: ${body}`
    );
  }

  const data = await response.json();

  return (
    data?.candidates?.[0]?.content?.parts?.[0]?.text || ""
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseScoreResponse(raw) {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/gi, "").trim();

  let parsed;

  // ── Attempt 1: clean parse ──
  try {
    parsed = JSON.parse(cleaned);
  } catch (_) {
    // ── Attempt 2: truncated JSON — close open braces/brackets and retry ──
    try {
      const repaired = repairTruncatedJson(cleaned);
      parsed = JSON.parse(repaired);
      console.warn("[aiScoring] JSON was truncated — repaired successfully.");
    } catch (err) {
      console.error("RAW AI RESPONSE:", raw.slice(0, 400));
      throw new Error(`AI returned non-JSON response: ${raw.slice(0, 200)}`);
    }
  }

  const score = Math.max(0, Math.min(100, Number(parsed.lead_score) || 0));
  const lead_score = Math.max(1, Math.min(10, Math.round(score / 10)));

  const VALID_TIERS      = ["A", "B", "C", "D"];
  const VALID_CONFIDENCE = ["high", "medium", "low"];
  const VALID_POTENTIAL  = ["High", "Medium", "Low"];

  return {
    score,
    score_label: getScoreLabel(score),
    lead_score,
    tier: VALID_TIERS.includes(parsed.tier) ? parsed.tier : deriveTier(score),
    confidence: VALID_CONFIDENCE.includes(parsed.confidence) ? parsed.confidence : "medium",
    estimated_value_range: String(parsed.estimated_value_range || "Unknown"),
    revenue_potential: VALID_POTENTIAL.includes(parsed.revenue_potential)
      ? parsed.revenue_potential : "Medium",
    revenue_potential_reason: String(parsed.revenue_potential_reason || ""),
    opportunity_summary: String(parsed.opportunity_summary || parsed.reasoning || ""),
    digital_presence_audit: Array.isArray(parsed.digital_presence_audit)
      ? parsed.digital_presence_audit.map(String) : [],
    website_opportunity: String(parsed.website_opportunity || ""),
    outreach_angle: String(parsed.outreach_angle || ""),
    outreach_message: String(parsed.outreach_message || ""),
    reasoning: String(parsed.opportunity_summary || parsed.reasoning || ""),
    red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags.map(String) : [],
    recommended_action: String(parsed.recommended_action || ""),
  };
}

/**
 * Attempt to repair truncated JSON by closing any open strings,
 * arrays, and objects so JSON.parse can succeed.
 */
function repairTruncatedJson(str) {
  let s = str.trimEnd();

  // Remove trailing comma before closing
  s = s.replace(/,\s*$/, "");

  // If we're mid-string value, close the string
  // Count unescaped quotes to detect open string
  let inString = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\' && inString) { i += 2; continue; }
    if (ch === '"') inString = !inString;
    i++;
  }
  if (inString) s += '"';

  // Remove trailing comma again after closing string
  s = s.replace(/,\s*$/, "");

  // Count open braces and brackets, close them
  let braces = 0, brackets = 0;
  inString = false;
  for (let j = 0; j < s.length; j++) {
    const ch = s[j];
    if (ch === '\\' && inString) { j++; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }

  // Close in reverse order — brackets first, then braces
  for (let k = 0; k < brackets; k++) s += ']';
  for (let k = 0; k < braces;   k++) s += '}';

  return s;
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
// PUBLIC API
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

  const raw    = await callClaude(userPrompt);
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