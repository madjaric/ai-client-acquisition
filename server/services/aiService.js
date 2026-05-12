const { GoogleGenerativeAI } = require("@google/generative-ai");

const MODEL = "gemini-2.5-flash";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function callGemini(systemPrompt, userPrompt) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set in environment.");
  }

  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: systemPrompt,
  });

  const result = await model.generateContent(userPrompt);

  return result.response.text();
}

/**
 * Generate outreach email
 */
async function generateOutreachEmail(lead, campaignContext = "") {
  const system = `
You are an expert B2B sales copywriter.
Write concise, personalized cold outreach emails that feel human.
Never sound robotic or generic.
`;

  const user = `
Write a cold outreach email for this lead:

Business: ${lead.business_name || lead.name}
Industry: ${lead.industry || "Unknown"}
Location: ${lead.location || "Unknown"}
Website: ${lead.website || "Not provided"}
Notes: ${lead.notes || "None"}

Campaign context: ${campaignContext || "General outreach"}

Return ONLY the email body.
`;

  return await callGemini(system, user);
}

/**
 * Score lead
 */
async function scoreLead(lead) {
  const system = `
You are a B2B sales qualification expert.

Score leads from 0–100.

Return ONLY valid JSON in this format:
{
  "score": number,
  "reason": "short explanation"
}
`;

  const user = `
Score this lead:

Business: ${lead.business_name || lead.name}
Industry: ${lead.industry || "Unknown"}
Location: ${lead.location || "Unknown"}
Source: ${lead.source || "Unknown"}
Notes: ${lead.notes || "None"}
`;

  const raw = await callGemini(system, user);

  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (err) {
    return {
      score: 50,
      reason: "Could not parse AI response.",
    };
  }
}

module.exports = {
  generateOutreachEmail,
  scoreLead,
};