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
    const { messages, industry } = req.body;
    const userText = (messages || []).map(m => m.content).join("\n\n");

    console.log(`[IWG] Generation started — industry: ${industry || "unknown"}`);
    console.log(`[IWG] User text length: ${userText.length} chars`);

    // ── Pick industry-matched photo IDs ───────────────────────────────────────
    const PHOTO_POOLS = {
      auto:        ["1492144533","1486262322","1492496111","1503736235","1549399645","3807517"],
      dental:      ["3845810","3279209","4021775","4386466","5215001","40568"],
      hvac:        ["1216589","1145434","162568","257636","3862634","1422408"],
      plumb:       ["210881","2988232","1599703","3517739","2058134","1216589"],
      restaurant:  ["1640777","262978","299347","1279330","1640773","67468"],
      food:        ["1640777","262978","299347","1279330","1640773","67468"],
      fitness:     ["1954524","1552106","841130","2247179","4164418","3253501"],
      landscap:    ["1214497","296230","1301585","1459495","3076899","2132250"],
      beauty:      ["3065209","3993449","1570807","3065171","3065172"],
      salon:       ["3065209","3993449","1570807","3065171","3065172"],
      construct:   ["1117452","585419","1395963","2138922","3760529","1216589"],
      electr:      ["257636","3862634","1422408","162568","1145434"],
    };
    const FALLBACK_PHOTOS = ["1497366216548-37526070297c","1498050108023-c5249f4df085",
      "1556761175-b413da4baf72","1521791136064-7986c2920216","1504328345596-9c7c7df1ad62"];
    let photoPool = FALLBACK_PHOTOS;
    const industryLower = (industry || userText).toLowerCase();
    for (const [key, ids] of Object.entries(PHOTO_POOLS)) {
      if (industryLower.includes(key)) { photoPool = ids; break; }
    }
    // Shuffle and pick 6
    const photos = [...photoPool].sort(() => Math.random() - 0.5).slice(0, 6);
    const photoUrls = photos.map(id =>
      `https://images.unsplash.com/photo-${id}?w=1200&q=80&fit=crop&auto=format`
    );

    // ── Generation prompt ─────────────────────────────────────────────────────
    const PROMPT = `You are a senior front-end developer at a world-class design agency.
Generate a complete single-file HTML landing page for the local business below.
This is a SALES DEMO — it must look like a $3,000–$5,000 professionally-built website.

OUTPUT RULES:
• Return ONLY raw HTML starting with <!DOCTYPE html>. No markdown. No code fences.
• Single file: all CSS in <style>, all JS in <script> before </body>.
• Google Fonts: <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">

DESIGN:
• CSS vars: --primary (bold industry color, not blue/gray), --primary-rgb, --dark (#0d0d0d), --light (#f8f7f4)
• Every <img>: onerror="this.onerror=null;this.src='${photoUrls[0]}'" loading="lazy"
• Use these Unsplash photos (no repeats):
${photoUrls.map((u,i) => `  ${u}`).join("\n")}

SECTIONS (build ALL in this order):
1. NAV — fixed, transparent→dark on scroll, logo + links + CTA button, hamburger mobile
2. HERO — min-height:100vh, dark bg, TWO columns: left=eyebrow+headline(Syne 800)+subtext+CTA buttons+trust items+stars; right=image card (aspect-ratio:4/5, img covers, floating stat badge)
3. STATS BAR — primary bg, 4 animated count-up numbers with data-target attr
4. WHY CHOOSE US — 3-col grid, 6 feature cards with SVG icons
5. SERVICES — 3-col grid, 6 service cards each with image (height:200px) + icon + title + desc
6. GALLERY — 4-col grid, 8 photos, lightbox on click
7. TESTIMONIALS — 3 cards with stars, review text, avatar initial, realistic names
8. ABOUT — 2-col: left=image composition (main+secondary+years badge), right=text+list+CTA
9. CTA BANNER — full-width bg photo with gradient overlay, headline + buttons
10. CONTACT — 2-col: left=details+click-to-call, right=form (Name/Phone/Service/Message)
11. FOOTER — dark bg, 3-col grid, logo+links+contact info, copyright

BEHAVIOUR:
• Nav scroll: classList.toggle('nav-scrolled', scrollY>60)
• Scroll reveal: IntersectionObserver adds .visible to .reveal elements
• Count-up: animate data-target numbers over 1800ms on entry
• Gallery lightbox: click→overlay with full image

COPY RULES:
• Zero placeholder text — every word specific to this business
• 3 realistic testimonials with local customer names
• Phone as <a href="tel:...">. Industry-appropriate trust badges.
• Make it feel like the site has been live and earning customers for years

BUSINESS DATA:
${userText}

Output starts with <!DOCTYPE html> — nothing before it.`;

    const t1 = Date.now();
    console.log(`[IWG] Prompt built in ${t1 - t0}ms — ${PROMPT.length} chars`);

    // ── Call Gemini ───────────────────────────────────────────────────────────
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const upstream = await fetch(geminiUrl, {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({
        contents: [{ role: "user", parts: [{ text: PROMPT }] }],
        generationConfig: {
          maxOutputTokens: 16384,   // Was 65536 — 4x faster
          temperature    : 0.7,
          candidateCount : 1,
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

    // ── Extract HTML ──────────────────────────────────────────────────────────
    let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log(`[IWG] Raw response length: ${rawText.length} chars`);

    if (!rawText) {
      const reason = data?.candidates?.[0]?.finishReason || "unknown";
      console.error(`[IWG] Empty response — finishReason: ${reason}`);
      return res.status(500).json({ error: { message: `Gemini returned empty response (reason: ${reason})` } });
    }

    // Robust HTML extraction pipeline
    let html = extractHtml(rawText);

    const t3 = Date.now();
    console.log(`[IWG] HTML extracted in ${t3 - t2}ms — ${html.length} chars`);

    // ── Validate ──────────────────────────────────────────────────────────────
    const validationError = validateHtml(html);
    if (validationError) {
      console.error(`[IWG] Validation failed: ${validationError}`);
      console.error(`[IWG] HTML preview: ${html.substring(0, 200)}`);
      return res.status(500).json({ error: { message: validationError } });
    }

    // ── Post-process: inject stock image fallbacks ────────────────────────────
    html = postProcessHtml(html, photoUrls);

    const t4 = Date.now();
    console.log(`[IWG] Post-process done in ${t4 - t3}ms`);
    console.log(`[IWG] Total generation time: ${t4 - t0}ms`);

    // ── Respond ───────────────────────────────────────────────────────────────
    // Wrap in the same envelope the frontend expects.
    res.json({
      content: [{
        type: "text",
        text: JSON.stringify({
          generated_html  : html,
          editable_content: {
            hero_title:"", hero_subtitle:"", call_to_action:"",
            about_title:"", about_text:"", services_title:"",
            services_list:[], contact_title:"", contact_instructions:"",
          }
        })
      }]
    });

  } catch (err) {
    console.error("[IWG] Unhandled error:", err);
    res.status(500).json({ error: { message: err.message } });
  }
});

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
 * validateHtml(html)
 * Returns null if valid, or an error string describing the problem.
 */
function validateHtml(html) {
  if (!html)                             return "Generated HTML is empty";
  if (html.length < 500)                 return `Generated HTML too short (${html.length} chars — expected >500)`;
  if (!/<!doctype\s+html/i.test(html) &&
      !/<html[\s>]/i.test(html))         return "Generated HTML missing <html> tag";
  if (!/<\/html>/i.test(html))           return "Generated HTML missing closing </html> tag";
  if (!/<\/body>/i.test(html))           return "Generated HTML missing closing </body> tag";
  return null;
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
    return res.redirect(302, "/dashboard.html");
  }
  res.json({
    name    : "AI Client Acquisition System — LeadFlow",
    version : "1.0.0",
    ui      : "http://localhost:" + PORT + "/dashboard.html",
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
  res.sendFile(path.join(PUBLIC_DIR, "dashboard.html"));
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
  res.status(500).sendFile(path.join(PUBLIC_DIR, "dashboard.html"));
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
    console.log(`   Dashboard : http://localhost:${PORT}/dashboard.html`);
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