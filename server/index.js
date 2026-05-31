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
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: { message: "GEMINI_API_KEY not configured on server." } });
  }
  try {
    const { messages } = req.body;
    const userText = (messages || []).map(m => m.content).join("\n\n");

    const PROMPT = `You are a senior front-end developer at a world-class design agency. Generate a complete single-file HTML landing page for the local business below. This is a SALES DEMO shown to a business owner — it must look like a $3,000–$5,000 professionally-built website, not a generic AI page.

══════════════════════════════════════════════════
OUTPUT RULES
══════════════════════════════════════════════════
• Return ONLY raw HTML starting with <!DOCTYPE html>. No markdown. No code fences. No commentary.
• Single file: all CSS inside <style>, all JS inside <script> before </body>.
• Only allowed external resource: Google Fonts via <link>.
• Use real Unsplash photos: https://images.unsplash.com/photo-PHOTOID?w=1200&q=85&fit=crop&auto=format
  Real photo IDs by industry:
  Auto/mechanic:    1492144533, 1486262322, 1492496111, 1503736235, 1549399645, 3807517
  Dental/medical:   3845810, 3279209, 4021775, 4386466, 5215001, 40568
  HVAC/trades:      1216589, 1145434, 162568, 257636, 3862634, 1422408
  Restaurant/food:  1640777, 262978, 299347, 1279330, 1640773, 67468
  Fitness/gym:      1954524, 1552106, 841130, 2247179, 4164418, 3253501
  Landscaping:      1214497, 296230, 1301585, 1459495, 3076899, 2132250
  Plumbing:         210881, 2988232, 1599703, 3517739, 2058134
  Beauty/salon:     3065209, 3993449, 1570807, 3065171, 3065172
  Construction:     1117452, 585419, 1395963, 2138922, 3760529, 1216589
  Use 6–10 DIFFERENT photo IDs spread across the page. Never repeat the same photo ID.

══════════════════════════════════════════════════
DESIGN SYSTEM
══════════════════════════════════════════════════
Google Fonts import (always include):
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">

CSS :root variables — pick values suited to the industry:
  --primary: bold accent (NOT blue/gray — use orange, teal, amber, lime, cyan, crimson, etc.)
  --primary-rgb: RGB triplet for rgba() use e.g. "255,92,0"
  --dark: near-black for dark sections (#0d0d0d, #0a0f1a, #0f1a0a, etc.)
  --light: page background (#ffffff or #f8f7f4)
  --text: #1a1a2e
  --muted: #6b7280
  --border: #e5e7eb
  --radius-sm: 10px
  --radius-md: 18px
  --radius-lg: 32px
  --shadow-sm: 0 1px 3px rgba(0,0,0,.08),0 4px 16px rgba(0,0,0,.04)
  --shadow-md: 0 4px 24px rgba(0,0,0,.10),0 12px 48px rgba(0,0,0,.08)
  --shadow-lg: 0 16px 64px rgba(0,0,0,.14),0 32px 80px rgba(0,0,0,.10)
  --ease: cubic-bezier(.4,0,.2,1)

Global reset:
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth;-webkit-font-smoothing:antialiased}
  body{font-family:'DM Sans',sans-serif;color:var(--text);background:var(--light);line-height:1.7}
  img{max-width:100%;height:auto;display:block}
  a{text-decoration:none;color:inherit}
  button{cursor:pointer;border:none;background:none;font:inherit}

Scroll reveal classes (add to every section except hero and nav):
  .reveal{opacity:0;transform:translateY(48px);transition:opacity .8s var(--ease),transform .8s var(--ease)}
  .reveal.visible{opacity:1;transform:none}
  .reveal-d1{transition-delay:.1s} .reveal-d2{transition-delay:.2s} .reveal-d3{transition-delay:.3s}

══════════════════════════════════════════════════
SECTIONS — build ALL in this exact order
══════════════════════════════════════════════════

1. NAV (fixed)
   position:fixed;top:0;width:100%;z-index:1000;padding:20px 6%;transition:all .35s var(--ease);display:flex;justify-content:space-between;align-items:center
   Initial: background:transparent
   .nav-scrolled (JS): background:var(--dark);backdrop-filter:blur(20px);padding:14px 6%;box-shadow:0 4px 30px rgba(0,0,0,.3)
   Logo: font-family:'Syne';font-weight:800;font-size:1.4rem;color:white — last word of name in color:var(--primary)
   Links: display:flex;gap:32px;color:rgba(255,255,255,.8);font-size:.9rem;font-weight:500
   CTA btn: background:var(--primary);color:white;padding:10px 22px;border-radius:var(--radius-lg);font-weight:600;font-size:.88rem
   Mobile: hamburger (3-line SVG), full overlay menu on click

2. HERO — TWO COLUMN LAYOUT
   min-height:100vh;padding:140px 6% 80px;display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center;position:relative;overflow:hidden;background:var(--dark)
   Background decorations: radial gradient blob top-right (primary color, 25% opacity), subtle dot grid pattern using background-image
   
   LEFT column — text:
   a) Eyebrow badge: inline-flex;padding:7px 16px;border-radius:99px;background:rgba(var(--primary-rgb),.15);border:1px solid rgba(var(--primary-rgb),.3);color:var(--primary);font-size:.78rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;margin-bottom:28px
   b) Headline: font-family:'Syne';font-weight:800;font-size:clamp(2.8rem,5vw,4.4rem);line-height:1.05;letter-spacing:-.03em;color:white;margin-bottom:20px — one key word in var(--primary)
   c) Subtext: font-size:1.1rem;color:rgba(255,255,255,.65);line-height:1.8;max-width:480px;margin-bottom:36px
   d) CTA row: display:flex;gap:12px;flex-wrap:wrap;margin-bottom:36px
      Primary: background:var(--primary);color:white;padding:15px 32px;border-radius:var(--radius-lg);font-weight:600;box-shadow:0 8px 32px rgba(var(--primary-rgb),.4);transition:.25s var(--ease)
      Secondary: border:2px solid rgba(255,255,255,.25);color:white;padding:15px 32px;border-radius:var(--radius-lg);font-weight:600
   e) Trust row: display:flex;gap:20px;flex-wrap:wrap;margin-bottom:28px — each item: checkmark (color:var(--primary)) + text (rgba(255,255,255,.6);font-size:.85rem)
      4 trust items relevant to the industry e.g. "Licensed & Insured" "Free Estimates" "5-Star Rated" "Same-Day Service"
   f) Stars (if rating provided): gold ★ chars + rating/5 + "(N reviews)" in muted white
   
   RIGHT column — image card:
   position:relative;border-radius:var(--radius-md);overflow:hidden;aspect-ratio:4/5;box-shadow:var(--shadow-lg)
   img: position:absolute;inset:0;width:100%;height:100%;object-fit:cover
   Bottom gradient: position:absolute;bottom:0;left:0;right:0;height:40%;background:linear-gradient(to top,rgba(0,0,0,.5),transparent)
   Floating stat badge bottom-left: position:absolute;bottom:20px;left:20px;background:white;border-radius:var(--radius-sm);padding:12px 16px;box-shadow:var(--shadow-md);display:flex;align-items:center;gap:10px — SVG icon in var(--primary), bold number, small label
   Small secondary card right side: position:absolute;top:20%;right:-20px;width:180px;background:var(--dark);border:1px solid rgba(255,255,255,.12);border-radius:var(--radius-sm);padding:14px;backdrop-filter:blur(20px) — add a small stat or badge
   
   Entrance animation: @keyframes heroUp{from{opacity:0;transform:translateY(32px)}to{opacity:1;transform:none}}
   Apply with animation:heroUp .8s var(--ease) both + staggered delays to each left column child

3. STATS BAR
   background:var(--primary);padding:20px 6%;display:flex;justify-content:space-around;flex-wrap:wrap;gap:16px;align-items:center
   4 items — number: font-family:'Syne';font-weight:800;font-size:2.4rem;color:white — label: font-size:.8rem;color:rgba(255,255,255,.75);text-transform:uppercase;letter-spacing:.08em
   data-target attribute on each number for JS count-up. Use realistic numbers.

4. WHY CHOOSE US (class="reveal")
   padding:100px 6%;background:var(--light)
   Header (centered): overline label + h2 (font-family:'Syne';font-weight:800;font-size:clamp(2rem,4vw,3rem)) + description; margin-bottom:64px
   Grid: display:grid;grid-template-columns:repeat(3,1fr);gap:28px
   Cards: background:white;border-radius:var(--radius-md);padding:36px 28px;border:1.5px solid var(--border);box-shadow:var(--shadow-sm);transition:all .3s var(--ease)
   hover: transform:translateY(-6px);box-shadow:var(--shadow-md);border-color:rgba(var(--primary-rgb),.3)
   Icon: 52px circle bg:rgba(var(--primary-rgb),.1);SVG 26px stroke:var(--primary);stroke-width:1.75;fill:none
   h3: font-family:'Syne';font-weight:700;font-size:1.15rem;margin-bottom:10px
   p: font-size:.95rem;color:var(--muted);line-height:1.75
   Add 6 feature cards.

5. SERVICES (class="reveal")
   padding:100px 6%;background:#f9f9f7
   Header centered; margin-bottom:64px
   Grid: display:grid;grid-template-columns:repeat(3,1fr);gap:24px
   Each card: position:relative;border-radius:var(--radius-md);overflow:hidden;background:white;box-shadow:var(--shadow-sm);transition:all .35s var(--ease)
   hover: transform:translateY(-8px);box-shadow:var(--shadow-lg)
   Image area: height:200px — img:width:100%;height:100%;object-fit:cover;transition:transform .5s var(--ease) — hover img:transform:scale(1.08)
   .service-overlay: position:absolute;inset:0;background:rgba(var(--primary-rgb),.9);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .3s;color:white;font-weight:600
   hover .service-overlay: opacity:1
   Content: padding:24px — icon (36px circle) + h3 (font-family:'Syne') + p
   Include 6 service cards with real industry-specific services.

6. GALLERY (class="reveal")
   padding:100px 6%;background:var(--dark)
   Header: overline (var(--primary)) + h2 (white) + desc (rgba(255,255,255,.55));centered;margin-bottom:56px
   Grid: display:grid;grid-template-columns:repeat(4,1fr);gap:16px
   Items: position:relative;border-radius:var(--radius-sm);overflow:hidden;cursor:pointer
   First item and one other: grid-column:span 2;aspect-ratio:16/9
   Others: aspect-ratio:1/1
   img: width:100%;height:100%;object-fit:cover;transition:transform .6s var(--ease)
   hover img: transform:scale(1.06)
   .gallery-overlay: position:absolute;inset:0;background:rgba(var(--primary-rgb),.75);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .3s — white SVG zoom icon inside
   hover .gallery-overlay: opacity:1
   8 different photos.

7. TESTIMONIALS (class="reveal")
   padding:100px 6%;background:var(--light)
   Header centered; margin-bottom:56px
   Grid: display:grid;grid-template-columns:repeat(3,1fr);gap:24px
   Cards: background:white;border-radius:var(--radius-md);padding:32px;box-shadow:var(--shadow-sm);border:1.5px solid var(--border);position:relative;transition:.3s
   hover: box-shadow:var(--shadow-md);transform:translateY(-4px)
   Big quote mark: position:absolute;top:20px;right:24px;font-family:'Syne';font-size:4rem;font-weight:800;color:rgba(var(--primary-rgb),.12);line-height:1
   Stars: ★ chars color:var(--primary);font-size:1rem;margin-bottom:16px
   Review text: font-size:.95rem;line-height:1.8;font-style:italic;margin-bottom:24px
   Reviewer: 40px avatar circle (bg:rgba(var(--primary-rgb),.15);initial letter in var(--primary)) + name (font-weight:600) + detail (color:var(--muted))
   3 realistic reviews with specific details.

8. ABOUT (class="reveal")
   padding:100px 6%;background:#f9f9f7
   display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center
   LEFT image composition (position:relative;min-height:520px):
   Main img: width:85%;border-radius:var(--radius-md);overflow:hidden;box-shadow:var(--shadow-lg) — img:height:480px;object-fit:cover
   Secondary img: position:absolute;bottom:-32px;right:-16px;width:52%;border-radius:var(--radius-sm);border:4px solid white;box-shadow:var(--shadow-md) — img:height:220px;object-fit:cover
   Years badge: position:absolute;top:32px;left:-20px;background:var(--primary);color:white;border-radius:var(--radius-sm);padding:18px 22px;box-shadow:var(--shadow-md) — big number in Syne 800 + small label
   RIGHT content: overline + h2 + 2 paragraphs + 4-item list (checkmark circle + bold label + desc) + CTA button

9. CTA BANNER (class="reveal")
   position:relative;padding:100px 6%;overflow:hidden;text-align:center
   Background: real Unsplash photo;background-size:cover;background-position:center
   ::before: position:absolute;inset:0;background:linear-gradient(135deg,rgba(var(--primary-rgb),.88),rgba(0,0,0,.8))
   Content (relative z-index:1): h2 (Syne 800 white clamp(2rem,4vw,3.5rem)) + p + button row
   Buttons: white filled (color:var(--primary)) + <a href="tel:..."> outlined white (click-to-call with phone SVG icon)

10. CONTACT (class="reveal")
    padding:100px 6%;background:var(--light)
    display:grid;grid-template-columns:1fr 1.3fr;gap:80px;align-items:start
    LEFT: overline + h2 + paragraph + 4 contact detail items (icon circle + label + value)
    Phone: <a href="tel:..."> color:var(--primary);font-family:'Syne';font-size:1.2rem;font-weight:800
    Click-to-call button: full-width;background:var(--primary);color:white;padding:16px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;gap:10px;margin-top:16px
    RIGHT form: background:white;border-radius:var(--radius-lg);padding:44px;box-shadow:var(--shadow-md);border:1.5px solid var(--border)
    Fields: Name, Phone, Service (select dropdown with real services), Message
    Input style: width:100%;padding:13px 16px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-family:'DM Sans';font-size:.95rem;outline:none;background:var(--light)
    :focus: border-color:var(--primary);box-shadow:0 0 0 3px rgba(var(--primary-rgb),.12)
    Submit: width:100%;background:var(--primary);color:white;padding:15px;border-radius:var(--radius-sm);font-family:'DM Sans';font-weight:600

11. FOOTER
    background:var(--dark);padding:64px 6% 32px
    Top grid: display:grid;grid-template-columns:2fr 1fr 1fr;gap:48px;padding-bottom:48px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:32px
    Col 1: logo + tagline + description + social icons
    Col 2: Quick Links + 5 nav links
    Col 3: Contact Info + phone (tel: link) + email + address + hours
    Bottom: © 2025 [name]. All rights reserved. + "Built with LeadFlow AI" right-aligned

══════════════════════════════════════════════════
JAVASCRIPT
══════════════════════════════════════════════════
1. Nav scroll: window.addEventListener('scroll',()=>nav.classList.toggle('nav-scrolled',scrollY>60))
2. Hamburger: toggle .menu-open; mobile menu slides down
3. Scroll reveal: IntersectionObserver threshold 0.12 adds .visible class to .reveal elements
4. Count-up: on stats bar entry, animate 0→target over 1800ms with easeOutQuart; read target from data-target attr
5. Gallery lightbox: click item → fixed overlay with full-size image; click overlay to close

══════════════════════════════════════════════════
RESPONSIVE
══════════════════════════════════════════════════
@media (max-width:1024px): hero grid-template-columns:1fr; right column shown below, aspect-ratio:16/9; about grid-template-columns:1fr
@media (max-width:768px): why/services/testimonials grid-template-columns:1fr 1fr; gallery grid-template-columns:repeat(2,1fr); contact grid-template-columns:1fr; footer top grid-template-columns:1fr; nav links hidden, hamburger shown
@media (max-width:480px): all grids grid-template-columns:1fr; hero font-size clamp(2.2rem,8vw,3.2rem); CTA buttons flex-direction:column width:100%

══════════════════════════════════════════════════
BUSINESS DATA
══════════════════════════════════════════════════
BUSINESS_DATA_PLACEHOLDER

COPY RULES:
• Write as the actual business owner — confident, local, trustworthy
• ZERO placeholder text or lorem ipsum — every word must be specific to this business
• Generate 3 realistic testimonials with specific, plausible customer first names
• Adapt everything to the industry — a dentist and a plumber should feel completely different
• Phone: use real one from data or (555) 000-0000 as fallback with tel: link
• Make it feel like this website has been live and earning customers for years`;

    const prompt = PROMPT.replace("BUSINESS_DATA_PLACEHOLDER", userText);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const upstream = await fetch(url, {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({
        contents        : [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 65536, temperature: 0.75 },
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: { message: data?.error?.message || "Gemini API error" } });
    }

    let html = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    html = html.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    if (!html.toLowerCase().includes("<!doctype") && !html.toLowerCase().includes("<html")) {
      return res.status(500).json({ error: { message: "Gemini did not return valid HTML. Try again." } });
    }

    res.json({
      content: [{
        type: "text",
        text: JSON.stringify({
          generated_html  : html,
          editable_content: {
            hero_title:"",hero_subtitle:"",call_to_action:"",
            about_title:"",about_text:"",services_title:"",
            services_list:[],contact_title:"",contact_instructions:"",
          }
        })
      }]
    });

  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});


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