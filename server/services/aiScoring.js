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

const MAX_TOKENS = 900;

// ─────────────────────────────────────────────────────────────────────────────
//  SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────
const SCORING_SYSTEM_PROMPT = `
You are a senior B2B client acquisition analyst with 15+ years of experience
evaluating over 1,000 small-to-mid-size US businesses as potential clients for
digital services (web design, SEO, paid ads, CRM setup, software, consulting).

Your job is to assess an inbound lead and determine:
  1. How valuable this client is likely to be (monthly revenue potential)
  2. How easy or hard they will be to close and retain
  3. What specific risks or red flags exist
  4. The single best next action to take right now

Return ONLY valid JSON.
No markdown.
No backticks.
No explanation.

{
  "lead_score": 1-10,
  "tier": "A|B|C|D",
  "estimated_value_range": "",
  "confidence": "high|medium|low",
  "reasoning": "",
  "red_flags": [],
  "recommended_action": ""
}
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// USER PROMPT
// ─────────────────────────────────────────────────────────────────────────────
function buildUserPrompt({
  business_name,
  industry,
  location,
  website,
  notes,
}) {
  return `
Please score this lead:

Business Name : ${business_name}
Industry      : ${industry}
Location      : ${location}
Website       : ${website || "Not provided"}
Notes         : ${notes || "None"}

Return ONLY raw JSON.
Do not wrap in markdown.
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
  const cleaned = raw
    .replace(/```json/gi, "")
    .replace(/```/gi, "")
    .trim();

  let parsed;

  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("RAW AI RESPONSE:", raw);

    throw new Error(
      `AI returned non-JSON response: ${raw.slice(0, 200)}`
    );
  }

  const lead_score = Number(parsed.lead_score);

  if (!lead_score || lead_score < 1 || lead_score > 10) {
    throw new Error(
      `Invalid lead_score in AI response: ${parsed.lead_score}`
    );
  }

  const VALID_TIERS = ["A", "B", "C", "D"];
  const VALID_CONFIDENCE = ["high", "medium", "low"];

  return {
    lead_score: Math.round(lead_score),

    tier: VALID_TIERS.includes(parsed.tier)
      ? parsed.tier
      : derivetier(lead_score),

    estimated_value_range: String(
      parsed.estimated_value_range || "Unknown"
    ),

    confidence: VALID_CONFIDENCE.includes(parsed.confidence)
      ? parsed.confidence
      : "medium",

    reasoning: String(parsed.reasoning || ""),

    red_flags: Array.isArray(parsed.red_flags)
      ? parsed.red_flags.map(String)
      : [],

    recommended_action: String(
      parsed.recommended_action || ""
    ),
  };
}

function derivetier(score) {
  if (score >= 8) return "A";
  if (score >= 6) return "B";
  if (score >= 4) return "C";
  return "D";
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────
async function scoreLead(lead) {
  const {
    business_name,
    industry,
    location,
    website,
    notes,
  } = lead;

  if (!business_name || !industry || !location) {
    throw new Error(
      "scoreLead requires: business_name, industry, location"
    );
  }

  const userPrompt = buildUserPrompt({
    business_name,
    industry,
    location,
    website,
    notes,
  });

  const raw = await callClaude(userPrompt);

  const result = parseScoreResponse(raw);

  return {
    ...result,
    scored_at_ms: Date.now(),
    model: MODEL,
  };
}

module.exports = {
  scoreLead,
  SCORING_SYSTEM_PROMPT,
  buildUserPrompt,
};