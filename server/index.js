/**
 * server/index.js
 * Entry point — configures and starts the Express server.
 */

require("dotenv").config();

const path         = require("path");
const fs           = require("fs");
const express      = require("express");
const helmet       = require("helmet");
const cors         = require("cors");
const morgan       = require("morgan");
const rateLimit    = require("express-rate-limit");
const cookieParser = require("cookie-parser");

const { getDb, closeDb } = require("./db/connection");
const { requireAuth }    = require("./middleware/requireAuth");

// Inline users migration — no separate file needed
function runUserMigrations(db) {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (
      id                     TEXT PRIMARY KEY,
      email                  TEXT NOT NULL UNIQUE,
      password_hash          TEXT NOT NULL,
      plan                   TEXT NOT NULL DEFAULT 'free'
                               CHECK(plan IN ('free','pro','agency')),
      searches_this_month    INTEGER NOT NULL DEFAULT 0,
      searches_reset_at      TEXT NOT NULL DEFAULT (datetime('now')),
      stripe_customer_id     TEXT,
      stripe_subscription_id TEXT,
      created_at             TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
    `CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id)`,
  ];
  for (const sql of stmts) {
    try { db.prepare(sql).run(); } catch (e) {
      if (!e.message.includes("already exists")) throw e;
    }
  }
  console.log("  ✅ Users table ready.");
}

// ─── Route imports ────────────────────────────────────────────────────────────
const healthRouter           = require("./routes/health");
const authRouter             = require("./routes/auth");
const paymentsRouter         = require("./routes/payments");
const leadsRouter            = require("./routes/leads");
const scoreLeadRouter        = require("./routes/scoreLead");
const campaignsRouter        = require("./routes/campaigns");
const outreachRouter         = require("./routes/outreach");
const generateOutreachRouter = require("./routes/generateOutreach");
const sendEmailRouter        = require("./routes/sendEmail");
const discoveryRouter        = require("./routes/discovery");

// ─── Template-based website generation stack ─────────────────────────────────
const { renderLandingPage } = require("./renderLandingPage");
const { resolveIndustry }   = require("./resolveIndustry");
const { getTemplate }       = require("./services/templateManifest");

// ─────────────────────────────────────────────
//  App Setup
// ─────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

// ─────────────────────────────────────────────
//  ⚠️  Stripe webhook — MUST be registered BEFORE express.json()
//  It needs the raw body for signature verification.
// ─────────────────────────────────────────────
app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  paymentsRouter
);

// ─────────────────────────────────────────────
//  Security & Middleware
// ─────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        scriptSrc    : ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc     : ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc      : ["'self'", "https://fonts.gstatic.com"],
        imgSrc       : ["'self'", "data:", "https://images.unsplash.com"],
      },
    },
  })
);

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

// Rate limiter — API routes only
const limiter = rateLimit({
  windowMs       : parseInt(process.env.RATE_LIMIT_WINDOW_MS)    || 15 * 60 * 1000,
  max            : parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders  : false,
  message        : { success: false, message: "Too many requests — please try again later." },
});
app.use("/api", limiter);

// ─────────────────────────────────────────────
//  Static files
// ─────────────────────────────────────────────
app.use(express.static(PUBLIC_DIR, {
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
}));

// ─────────────────────────────────────────────
//  API Routes — Public (no auth required)
// ─────────────────────────────────────────────
app.use("/api/health",   healthRouter);
app.use("/api/auth",     authRouter);
app.use("/api/payments", paymentsRouter);   // webhook handled above; rest of routes here

// ─────────────────────────────────────────────
//  API Routes — Protected (JWT required)
// ─────────────────────────────────────────────
app.use("/api/leads",             requireAuth, leadsRouter);
app.use("/api/score-lead",        requireAuth, scoreLeadRouter);
app.use("/api/campaigns",         requireAuth, campaignsRouter);
app.use("/api/outreach",          requireAuth, outreachRouter);
app.use("/api/generate-outreach", requireAuth, generateOutreachRouter);
app.use("/api/send-email",        requireAuth, sendEmailRouter);
app.use("/api/discovery",         discoveryRouter);  // requireAuth applied per-endpoint inside

// ─────────────────────────────────────────────
//  Lead Intelligence — inline route
//  GET /api/lead-intelligence/:leadId
// ─────────────────────────────────────────────
app.get("/api/lead-intelligence/:leadId", requireAuth, (req, res) => {
  try {
    const db     = getDb();
    const leadId = req.params.leadId;

    const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });

    // Latest score
    const scoreRow = db.prepare(
      "SELECT * FROM lead_scores WHERE lead_id = ? ORDER BY scored_at DESC LIMIT 1"
    ).get(leadId);

    let score = null;
    if (scoreRow) {
      score = {
        ...scoreRow,
        red_flags      : (() => { try { return JSON.parse(scoreRow.red_flags); } catch { return []; } })(),
        score_breakdown: (() => { try { return JSON.parse(scoreRow.score_breakdown || "{}"); } catch { return {}; } })(),
        score_100      : scoreRow.score !== undefined && scoreRow.score !== null
                           ? scoreRow.score
                           : (scoreRow.lead_score ? scoreRow.lead_score * 10 : 0),
        score_label    : (() => {
          const s = scoreRow.score !== undefined && scoreRow.score !== null
            ? scoreRow.score : (scoreRow.lead_score ? scoreRow.lead_score * 10 : 0);
          if (s >= 90) return "Hot";
          if (s >= 70) return "Warm";
          if (s >= 40) return "Mild";
          return "Cold";
        })(),
      };
    }

    // Latest generated message
    const msgRow = db.prepare(
      "SELECT * FROM generated_messages WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(leadId);

    const hasWebsite = !!(lead.website && lead.website.trim());

    const revenueProjection = score ? {
      estimated_value_range  : score.estimated_value_range || "—",
      website_revenue_potential: score.website_revenue_potential || null,
      conversion_probability : score.conversion_probability || "medium",
      model_used             : score.model || (hasWebsite ? "A" : "B"),
    } : null;

    return res.json({
      success: true,
      data: {
        lead,
        score,
        latest_message    : msgRow || null,
        revenue_projection: revenueProjection,
        has_website       : hasWebsite,
        intelligence_summary: {
          headline   : score
            ? `${lead.business_name} — ${score.score_label} Lead`
            : `${lead.business_name} — awaiting AI scoring`,
          next_action: score?.recommended_action || "Run AI Score to unlock full intelligence",
          model_type : score?.model === "B" ? "Website Opportunity Lead" : "Lead Gen Services Lead",
        },
      },
    });
  } catch (err) {
    console.error("Lead intelligence error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  Pipeline Analytics — inline route
//  GET /api/pipeline/analytics
// ─────────────────────────────────────────────
app.get("/api/pipeline/analytics", requireAuth, (req, res) => {
  try {
    const db = getDb();

    const statusRows = db.prepare("SELECT status, COUNT(*) as count FROM leads GROUP BY status").all();
    const dist = { total: 0, new: 0, contacted: 0, replied: 0, qualified: 0, converted: 0 };
    for (const r of statusRows) { dist[r.status] = r.count; dist.total += r.count; }

    const withSite = db.prepare("SELECT COUNT(*) as n FROM leads WHERE website IS NOT NULL AND website != ''").get().n;
    const noSite   = dist.total - withSite;

    const rankedScores = db.prepare(`
      SELECT ls.*, l.business_name, l.industry,
             COALESCE(ls.score, ls.lead_score * 10, 0) as score_100
      FROM lead_scores ls
      INNER JOIN leads l ON l.id = ls.lead_id
      INNER JOIN (SELECT lead_id, MAX(scored_at) as m FROM lead_scores GROUP BY lead_id) lx
        ON ls.lead_id = lx.lead_id AND ls.scored_at = lx.m
      ORDER BY score_100 DESC
    `).all();

    const highestValue = rankedScores[0] || null;
    const highestWo    = rankedScores.filter(s => s.website_opportunity_score > 0)
                           .sort((a,b) => b.website_opportunity_score - a.website_opportunity_score)[0] || null;

    const industryCounts = {};
    rankedScores.forEach(s => { if (s.industry) industryCounts[s.industry] = (industryCounts[s.industry]||0)+1; });
    const topIndustry = Object.entries(industryCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || null;

    let potentialRevenue = 0;
    rankedScores.forEach(s => {
      const m = (s.estimated_value_range||"").match(/\$?([\d,]+)/);
      if (m) potentialRevenue += parseInt(m[1].replace(/,/g,""))||0;
    });

    return res.json({
      success: true,
      data: {
        lead_distribution: dist,
        website_opportunity_metrics: {
          with_website              : withSite,
          without_website           : noSite,
          website_opportunity_score : noSite > 0 ? Math.round((noSite/dist.total)*100) : 0,
          estimated_website_revenue : noSite * 2500,
        },
        ai_insights: {
          highest_value_lead: highestValue ? {
            id: highestValue.lead_id, business_name: highestValue.business_name,
            value_range: highestValue.estimated_value_range, score: highestValue.score_100,
          } : null,
          highest_website_opportunity: highestWo ? {
            id: highestWo.lead_id, business_name: highestWo.business_name,
            wo_score: highestWo.website_opportunity_score, industry: highestWo.industry,
          } : null,
          fastest_conversion: rankedScores.find(s => s.recommended_action) ? {
            id: rankedScores[0].lead_id, business_name: rankedScores[0].business_name,
            next_action: rankedScores[0].recommended_action, score: rankedScores[0].score_100,
          } : null,
          most_responsive_industry: topIndustry,
        },
        revenue_projection: {
          potential_revenue            : potentialRevenue,
          monthly_recurring_opportunity: Math.round(potentialRevenue * 0.3),
          estimated_close_value        : Math.round(potentialRevenue * 0.15),
        },
      },
    });
  } catch (err) {
    console.error("Pipeline analytics error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
//  Website Preview — save HTML to disk + serve
//  POST /api/preview/save   → saves HTML, returns public URL
//  GET  /api/preview/:leadId → serves the saved HTML file
// ─────────────────────────────────────────────
const PREVIEW_DIR = path.join(PUBLIC_DIR, "previews");
if (!fs.existsSync(PREVIEW_DIR)) fs.mkdirSync(PREVIEW_DIR, { recursive: true });

app.post("/api/preview/save", requireAuth, (req, res) => {
  try {
    const { lead_id, html } = req.body;
    if (!lead_id || !html) {
      return res.status(400).json({ success: false, message: "lead_id and html are required." });
    }

    const safe = lead_id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const file = path.join(PREVIEW_DIR, `${safe}.html`);
    fs.writeFileSync(file, html, "utf8");

    const db   = getDb();
    const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(lead_id);
    if (lead) {
      const baseUrl    = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
      const previewUrl = `${baseUrl}/previews/${safe}.html`;

      // Build updated notes: replace old preview markers, add new ones
      const notesBase = (lead.notes || "")
        .replace(/\[WEBSITE_PREVIEW_GENERATED\]/g, "")
        .replace(/\[PREVIEW_URL:[^\]]*\]/g, "")
        .trim();
      const newNotes = (notesBase ? notesBase + "\n" : "") +
        "[WEBSITE_PREVIEW_GENERATED]\n" +
        `[PREVIEW_URL:${previewUrl}]`;

      db.prepare("UPDATE leads SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(newNotes, lead_id);

      return res.json({ success: true, preview_url: previewUrl });
    }

    return res.json({ success: true, preview_url: null });
  } catch (err) {
    console.error("Preview save error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/preview/:leadId", (req, res) => {
  const safe = req.params.leadId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const file = path.join(PREVIEW_DIR, `${safe}.html`);
  if (!fs.existsSync(file)) return res.status(404).send("Preview not found.");
  res.setHeader("Content-Type", "text/html");
  res.sendFile(file);
});

// ─────────────────────────────────────────────
//  Gemini proxy — website generator
// ─────────────────────────────────────────────
app.post("/api/generate-website", async (req, res) => {
  const t0 = Date.now();

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: { message: "GEMINI_API_KEY not configured on server." } });
  }

  try {
    const { messages, industry: rawIndustry } = req.body;
    const userText = (messages || []).map(m => m.content).join("\n\n");

    const bizData      = parseBusinessPrompt(userText);
    const businessName = bizData.business_name || "Our Business";
    const industry     = rawIndustry || bizData.industry || "";

    console.log(`[IWG] Generation started — business: ${businessName} | industry: ${industry || "unknown"}`);

    const category     = resolveIndustry(industry);
    const templateName = CATEGORY_TEMPLATE_MAP[category] || "professional";
    const manifest     = getTemplate(templateName);

    if (!manifest) {
      throw new Error(`Template manifest entry not found for: ${templateName}`);
    }

    const templateHtml = require("fs").readFileSync(manifest.file, "utf8");
    console.log(`[IWG] Template: ${templateName} (category: ${category}) — ${templateHtml.length} chars`);

    const tone = TEMPLATE_TONE_MAP[templateName] || "professional";

    const JSON_PROMPT = `You are a senior copywriter for a local business marketing agency.
Extract and enhance the business information below into a JSON object.
Return ONLY a raw JSON object — no markdown, no code fences, nothing before { or after }.

Business data:
${userText}

Return this exact JSON structure:
{
  "headline":    "<compelling hero headline, 6-12 words, specific to this business>",
  "description": "<2-sentence description of the business, what they do and why choose them>",
  "services":    ["<service 1>", "<service 2>", "<service 3>", "<service 4>", "<service 5>", "<service 6>"],
  "cta_text":    "<action CTA button text, 3-6 words, e.g. Get a Free Quote>",
  "tone":        "${tone}"
}

Rules:
- headline: specific, benefit-driven, no generic phrases like "Welcome to"
- description: warm, professional, mentions location if available
- services: 3-6 items max, use actual service names from the data above if provided
- cta_text: urgent but not pushy, industry-appropriate
- tone: always "${tone}"
- Zero placeholder text — every field specific to this exact business`;

    const t1 = Date.now();
    console.log(`[IWG] JSON prompt: ${JSON_PROMPT.length} chars`);

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const upstream = await fetch(geminiUrl, {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({
        contents: [{ role: "user", parts: [{ text: JSON_PROMPT }] }],
        generationConfig: {
          maxOutputTokens: 8000,
          temperature    : 0.65,
          candidateCount : 1,
          thinkingConfig : { thinkingBudget: 0 },
        },
      }),
    });

    const t2 = Date.now();
    console.log(`[IWG] Gemini responded in ${t2 - t1}ms — HTTP ${upstream.status}`);

    const data = await upstream.json();

    if (!upstream.ok) {
      console.error(`[IWG] Gemini error:`, data?.error);
      return res.status(upstream.status).json({
        error: { message: data?.error?.message || "Gemini API error" }
      });
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!rawText) {
      const reason = data?.candidates?.[0]?.finishReason || "unknown";
      console.error(`[IWG] Empty response — finishReason: ${reason}`);
      return res.status(500).json({ error: { message: `Gemini returned empty response (reason: ${reason})` } });
    }

    let generatedFields;
    try {
      const clean = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();
      generatedFields = JSON.parse(clean);
    } catch (e) {
      console.error(`[IWG] JSON parse failed:`, e.message, "\nRaw:", rawText.slice(0, 200));
      generatedFields = {
        headline:    businessName,
        description: bizData.description || `Professional ${industry || "services"} for your area.`,
        services:    bizData.services,
        cta_text:    "Get a Free Quote",
        tone,
      };
    }

    const t3 = Date.now();

    const jsonData = {
      business_name: businessName,
      headline:      generatedFields.headline    || businessName,
      description:   generatedFields.description || "",
      services:      generatedFields.services    || bizData.services || [],
      cta_text:      generatedFields.cta_text    || "Get a Free Quote",
      phone:         bizData.phone    || "",
      address:       bizData.location || "",
      email:         bizData.email    || "",
      industry,
      tone:          generatedFields.tone || tone,
    };

    const html = renderLandingPage(jsonData, templateHtml);

    const t4 = Date.now();
    console.log(`[IWG] Rendered in ${t4 - t3}ms — ${html.length} chars (template: ${templateName})`);
    console.log(`[IWG] Total generation time: ${t4 - t0}ms`);

    const validationError = validateHtml(html);
    if (validationError) {
      console.error(`[IWG] Rendered HTML validation failed: ${validationError}`);
      return res.status(500).json({ error: { message: validationError } });
    }

    res.json({
      content: [{
        type: "text",
        text: JSON.stringify({
          generated_html  : html,
          editable_content: {
            hero_title:           generatedFields.headline    || "",
            hero_subtitle:        generatedFields.description || "",
            call_to_action:       generatedFields.cta_text    || "",
            about_title:          businessName,
            about_text:           generatedFields.description || "",
            services_title:       "Our Services",
            services_list:        (generatedFields.services || []),
            contact_title:        "Get in Touch",
            contact_instructions: "",
          },
          _meta: {
            template:  templateName,
            category:  category,
            tone:      jsonData.tone,
            generated: new Date().toISOString(),
          }
        })
      }]
    });

  } catch (err) {
    console.error("[IWG] Unhandled error:", err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── Industry → template selection map ───────────────────────────────────────
const CATEGORY_TEMPLATE_MAP = {
  plumb:       "professional",
  hvac:        "professional",
  electr:      "professional",
  construct:   "professional",
  mechanic:    "dark",
  landscap:    "vibrant",
  cleaning:    "professional",
  dental:      "professional",
  medical:     "professional",
  cafe:        "vibrant",
  restaurant:  "vibrant",
  food:        "vibrant",
  fitness:     "dark",
  beauty:      "vibrant",
  retail:      "vibrant",
  law:         "professional",
  consult:     "professional",
  tech:        "dark",
  fallback:    "professional",
};

const TEMPLATE_TONE_MAP = {
  professional: "professional",
  vibrant:      "professional",
  dark:         "premium",
};

/**
 * parseBusinessPrompt(text)
 * Parses "Key: Value\n" format from iwgGenerate messages[0].content.
 */
function parseBusinessPrompt(text) {
  const result = {
    business_name: "", industry: "", location: "",
    phone: "", email: "", rating: "", description: "", services: [],
  };
  if (!text) return result;

  for (const line of text.split("\n")) {
    const sep = line.indexOf(": ");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim().toLowerCase().replace(/\s+/g, "_");
    const val = line.slice(sep + 2).trim();
    if (!val) continue;
    switch (key) {
      case "business_name": case "name":        result.business_name = val; break;
      case "industry":                          result.industry      = val; break;
      case "location":                          result.location      = val; break;
      case "phone":                             result.phone         = val; break;
      case "email":                             result.email         = val; break;
      case "rating":                            result.rating        = val; break;
      case "description":                       result.description   = val; break;
      case "services":
        result.services = val.split(",").map(s => s.trim()).filter(Boolean);
        break;
    }
  }
  return result;
}

/**
 * extractHtml(rawText)
 * Robust pipeline — handles all known Gemini output variations:
 * 1. Clean HTML (ideal case)
 * 2. ```html ... ``` fenced
 * 3. ``` ... ``` fenced (no lang)
 * 4. JSON envelope {"generated_html":"..."}
 * 5. Partial/truncated HTML
 */
function extractHtml(raw) {
  if (!raw) return "";

  // 1. Already starts with doctype/html
  const trimmed = raw.trim();
  if (/^<!doctype\s+html/i.test(trimmed) || /^<html/i.test(trimmed)) {
    return trimmed;
  }

  // 2. Fenced ```html ... ```
  const htmlFence = trimmed.match(/```html\s*([\s\S]*?)```/i);
  if (htmlFence) return htmlFence[1].trim();

  // 3. Generic ``` ... ```
  const genericFence = trimmed.match(/```\s*([\s\S]*?)```/);
  if (genericFence) {
    const inner = genericFence[1].trim();
    if (inner.toLowerCase().includes('<html') || inner.toLowerCase().includes('<!doctype')) {
      return inner;
    }
  }

  // 4. JSON envelope {"generated_html": "..."}
  try {
    const jsonStart = raw.indexOf('{');
    if (jsonStart !== -1) {
      // Handle escaped HTML inside JSON
      const parsed = JSON.parse(raw.slice(jsonStart));
      if (parsed.generated_html) return parsed.generated_html;
    }
  } catch (_) {}

  // 5. Find HTML document anywhere in the string
  const docStart = raw.search(/<!doctype\s+html/i);
  if (docStart !== -1) return raw.slice(docStart).trim();

  const htmlStart = raw.search(/<html[\s>]/i);
  if (htmlStart !== -1) return raw.slice(htmlStart).trim();

  // 6. Return as-is and let validation catch it
  return trimmed;
}

/**
 * repairHtml(html)
 * If Gemini truncated the output (hit token limit), the HTML will be missing
 * closing tags. Rather than failing, we repair it so the user gets a working
 * (if slightly incomplete) page instead of an error.
 */
function repairHtml(html) {
  if (!html) return html;

  // Close any open <style> block
  const styleOpens  = (html.match(/<style[^>]*>/gi) || []).length;
  const styleCloses = (html.match(/<\/style>/gi) || []).length;
  if (styleOpens > styleCloses) html += '\n</style>';

  // Close any open <script> block
  const scriptOpens  = (html.match(/<script[^>]*>/gi) || []).length;
  const scriptCloses = (html.match(/<\/script>/gi) || []).length;
  if (scriptOpens > scriptCloses) html += '\n</script>';

  // Ensure </body> and </html> exist
  if (!/<\/body>/i.test(html)) html += '\n</body>';
  if (!/<\/html>/i.test(html)) html += '\n</html>';

  return html;
}

/**
 * validateHtml(html)
 * Returns null if valid, or an error string describing the problem.
 * Truncated HTML is repaired rather than rejected.
 */
function validateHtml(html) {
  if (!html)              return "Generated HTML is empty";
  if (html.length < 500)  return `Generated HTML too short (${html.length} chars — Gemini may have failed)`;
  if (!/<!doctype\s+html/i.test(html) &&
      !/<html[\s>]/i.test(html)) return "Generated HTML missing <html> tag — Gemini returned wrong format";
  return null;  // closing tags validated/repaired separately via repairHtml()
}

/**
 * postProcessHtml(html, photoUrls)
 * Adds onerror fallbacks to any <img> that lacks them.
 * Replaces empty/placeholder src values.
 */
function postProcessHtml(html, photoUrls) {
  if (!html) return html;
  const fallback = photoUrls[0] || "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80&fit=crop&auto=format";
  let photoIdx = 1;

  // Replace empty/placeholder srcs
  html = html.replace(/src=["']\s*["']/gi, () => `src="${photoUrls[photoIdx++ % photoUrls.length] || fallback}"`);
  html = html.replace(/src=["'](#|placeholder[^"']*|YOUR[_-]IMAGE[^"']*)["']/gi,
    () => `src="${photoUrls[photoIdx++ % photoUrls.length] || fallback}"`);

  // Add onerror to any <img> missing it
  html = html.replace(/<img(\b[^>]*?)>/gi, (match, attrs) => {
    if (/onerror/i.test(attrs)) return match;
    return `<img${attrs} onerror="this.onerror=null;this.src='${fallback}'">`;
  });

  return html;
}


// ─────────────────────────────────────────────
//  Root redirect
// ─────────────────────────────────────────────
app.get("/", (req, res) => {
  const wantsHtml = req.headers.accept && req.headers.accept.includes("text/html");
  if (wantsHtml) {
    return res.redirect(302, "/dashboard/dashboard.html");
  }
  res.json({
    name    : "AI Client Acquisition System — LeadFlow",
    version : "1.0.0",
    ui      : "http://localhost:" + PORT + "/dashboard/dashboard.html",
    endpoints: {
      health            : "GET  /api/health",
      auth              : "POST /api/auth/register  |  POST /api/auth/login  |  GET /api/auth/me",
      payments          : "POST /api/payments/create-checkout  |  POST /api/payments/create-portal",
      leads             : "GET  /api/leads  |  POST /api/leads  |  PATCH /api/leads/:id",
      score_lead        : "POST /api/score-lead  |  GET /api/score-lead/ranked",
      generate_outreach : "POST /api/generate-outreach",
      send_email        : "POST /api/send-email",
      discovery         : "POST /api/discovery/search  |  POST /api/discovery/import  |  GET /api/discovery/quota",
    },
  });
});

// ─────────────────────────────────────────────
//  SPA fallback — unknown non-API routes → dashboard
//  (auth guard in dashboard.html handles the redirect to /login.html)
// ─────────────────────────────────────────────
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "dashboard", "dashboard.html"));
});

// ─────────────────────────────────────────────
//  Error handlers
// ─────────────────────────────────────────────
app.use("/api", (req, res) => {
  res.status(404).json({ success: false, message: `API route not found: ${req.originalUrl}` });
});

app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err);
  const wantsJson =
    req.originalUrl.startsWith("/api") ||
    (req.headers.accept && req.headers.accept.includes("application/json"));
  if (wantsJson) {
    return res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === "production" ? "Internal server error." : err.message,
    });
  }
  res.status(500).sendFile(path.join(PUBLIC_DIR, "dashboard", "dashboard.html"));
});

// ─────────────────────────────────────────────
//  Boot Sequence
// ─────────────────────────────────────────────
function start() {
  getDb(); // open + cache SQLite connection

  console.log("📦 Running database migrations...");
  require("./db/migrate").runMigrations();
  runUserMigrations(getDb());   // creates users table + indexes

  const server = app.listen(PORT, () => {
    console.log(`\n🚀 LeadFlow — AI Client Acquisition System`);
    console.log(`   Env       : ${process.env.NODE_ENV || "development"}`);
    console.log(`   Dashboard : http://localhost:${PORT}/dashboard/dashboard.html`);
    console.log(`   Login     : http://localhost:${PORT}/login.html`);
    console.log(`   API Health: http://localhost:${PORT}/api/health`);
    console.log(`   SERPAPI   : ${process.env.SERPAPI_KEY        ? "✅ configured" : "⚠️  not set (mock data)"}`);
    console.log(`   Gemini AI : ${process.env.GEMINI_API_KEY     ? "✅ configured" : "⚠️  not set"}`);
    console.log(`   JWT       : ${process.env.JWT_SECRET         ? "✅ configured" : "⚠️  using default (set JWT_SECRET in .env!)"}`);
    console.log(`   Stripe    : ${process.env.STRIPE_SECRET_KEY  ? "✅ configured" : "⚠️  not set (payments disabled)"}\n`);
  });

  process.on("SIGTERM", () => shutdown(server));
  process.on("SIGINT",  () => shutdown(server));
}

function shutdown(server) {
  console.log("\n⏳ Shutting down gracefully...");
  server.close(() => {
    closeDb();
    console.log("✅ Server closed.");
    process.exit(0);
  });
}

start();

module.exports = app; // for testing