/**
 * server/index.js
 * Entry point — configures and starts the Express server.
 */

require("dotenv").config();

const path         = require("path");
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
const leadIntelligenceRouter = require("./routes/leadIntelligence");
const pipelineAnalyticsRouter = require("./routes/pipelineAnalytics");

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
app.use("/api/lead-intelligence", requireAuth, leadIntelligenceRouter);
app.use("/api/pipeline",          requireAuth, pipelineAnalyticsRouter);

// ─────────────────────────────────────────────
//  Gemini proxy — website generator
//  Reuses the existing GEMINI_API_KEY from .env
// ─────────────────────────────────────────────
app.post("/api/generate-website", async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: { message: "GEMINI_API_KEY not configured on server." } });
  }
  try {
    const { messages } = req.body;
    const userText = (messages || []).map(m => m.content).join("\n\n");

    const fullPrompt = `You are a senior front-end developer at a top-tier design agency. Build a complete, single-file HTML landing page for the local business below. This page will be shown to the business owner as a sales demo — it must look genuinely impressive and modern.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONLY raw HTML starting with <!DOCTYPE html>. No markdown. No code fences. No comments outside code.
Single file: all CSS in <style>, all JS before </body>.
Allowed external resources: Google Fonts <link> only.
Use real Unsplash photos: https://images.unsplash.com/photo-ID?w=1400&q=85&fit=crop
  — Search for photo IDs that genuinely match the industry. Examples:
  — Auto repair: 1492144533 (mechanic), 1486262322 (car engine), 1558618666 (garage)
  — Dental: 3845810 (dental chair), 3279209 (smile), 298611 (clinic)
  — HVAC: 162568 (tools), 1216589 (technician), 257636 (air unit)
  — Restaurant: 1640777 (food), 262978 (restaurant interior), 299347 (chef)
  — Gym: 1954524 (gym), 1552106 (weights), 841130 (fitness)
  — Landscaping: 1214497 (garden), 296230 (lawn), 273749 (landscape)
  — Plumbing: 210881 (pipes), 2988232 (plumber), 1029599 (tools)
  Use at least 3 photos across the page.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESIGN SYSTEM — follow exactly
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FONTS — always import these two from Google Fonts:
  Display: "Syne" weights 700,800 — use for all headings and the logo
  Body:    "DM Sans" weights 400,500 — use for all body text, nav, buttons

CSS VARIABLES — define in :root, choose values based on industry:
  --c-bg:       page background (white #ffffff or near-white #f7f7f5)
  --c-dark:     deep dark for header/footer/dark sections (near-black, e.g. #0d0d0d, #0f1923, #0a0f0a)
  --c-primary:  bold brand color matching the industry (orange, teal, cyan, lime, red — NOT generic blue or gray)
  --c-primary-light: 15% opacity version of primary for backgrounds
  --c-text:     body text (#1a1a2e or #222)
  --c-muted:    secondary text (#666)
  --radius-sm: 8px
  --radius-md: 16px
  --radius-lg: 28px
  --shadow-sm: 0 2px 12px rgba(0,0,0,.06)
  --shadow-md: 0 8px 40px rgba(0,0,0,.12)
  --shadow-lg: 0 24px 80px rgba(0,0,0,.18)
  --transition: .25s cubic-bezier(.4,0,.2,1)

SPACING SCALE — use these exact values for padding/margin:
  4px 8px 12px 16px 24px 32px 48px 64px 80px 96px 120px

TYPOGRAPHY SCALE:
  .display   { font: 800 clamp(3.5rem,8vw,7.5rem)/1.0 'Syne'; letter-spacing:-0.04em }
  .h1        { font: 800 clamp(2.4rem,5vw,4.5rem)/1.1 'Syne'; letter-spacing:-0.03em }
  .h2        { font: 800 clamp(1.8rem,3.5vw,3rem)/1.2 'Syne'; letter-spacing:-0.02em }
  .h3        { font: 700 clamp(1.2rem,2vw,1.5rem)/1.3 'Syne' }
  body text  { font: 400 1.05rem/1.8 'DM Sans'; color: var(--c-text) }
  .overline  { font: 600 .7rem/.85 'DM Sans'; letter-spacing:.12em; text-transform:uppercase; color:var(--c-primary) }

GLOBAL RESET — include this exactly:
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0 }
  html { scroll-behavior:smooth; -webkit-font-smoothing:antialiased }
  img { max-width:100%; display:block }
  a { text-decoration:none; color:inherit }
  button { cursor:pointer; border:none; background:none; font:inherit }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTIONS — build all of these in order
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. NAV
   - position:fixed; top:0; width:100%; z-index:100
   - Initially: background transparent, padding 20px 5%
   - On scroll (JS): background var(--c-dark), padding 12px 5%, box-shadow var(--shadow-md)
   - Transition: all .3s ease
   - Left: logo in Syne 700, accent color on last word (e.g. "Melville <span style='color:var(--c-primary)'>Auto</span>")
   - Right: 3-4 nav links in DM Sans, white, gap 32px; then a CTA button (filled, --c-primary)
   - Mobile: hamburger button (3 lines SVG), slide-down menu overlay on click

2. HERO
   - min-height:100vh; display:grid; place-items:center; position:relative; overflow:hidden
   - Background: real Unsplash photo, background-size:cover, background-position:center
   - Overlay: ::before pseudo-element with position:absolute; inset:0;
     background: linear-gradient(135deg, rgba(0,0,0,.82) 0%, rgba(0,0,0,.45) 60%, rgba(0,0,0,.2) 100%)
   - Content centered, max-width 800px, text-align:center, position:relative z-index:1
   - Layout from top to bottom:
     a) Overline badge: display:inline-flex; align-items:center; gap:8px; padding:6px 16px; border-radius:99px; border:1px solid rgba(255,255,255,.25); background:rgba(255,255,255,.08); backdrop-filter:blur(8px); font-size:.75rem; letter-spacing:.1em; color:white; text-transform:uppercase; margin-bottom:24px
     b) Giant headline: .display class, color white, margin-bottom:20px. Make it 2-3 lines. Bold claim.
     c) Subheading: font-size:clamp(1rem,2vw,1.25rem); color:rgba(255,255,255,.75); max-width:560px; margin:0 auto 32px; line-height:1.7
     d) Stars row (if rating given): display:flex; gap:4px; justify-content:center; align-items:center; margin-bottom:36px. Gold stars (★) + rating text in white/80%
     e) CTA row: display:flex; gap:12px; justify-content:center; flex-wrap:wrap
        - Primary btn: background:var(--c-primary); color:white; padding:16px 36px; border-radius:var(--radius-lg); font:600 1rem 'DM Sans'; transition:var(--transition); hover: brightness(1.1) translateY(-2px) box-shadow var(--shadow-md)
        - Secondary btn: border:2px solid rgba(255,255,255,.5); color:white; padding:16px 36px; border-radius:var(--radius-lg); font:600 1rem 'DM Sans'; hover: border-color white; background:rgba(255,255,255,.1)
   - Hero entrance animation: keyframes fadeUp { from { opacity:0; transform:translateY(30px) } to { opacity:1; transform:none } }
     Apply to each child with animation-fill-mode:both and staggered animation-delay (0s, .15s, .3s, .45s, .6s)

3. STATS BAR
   - background:var(--c-primary); padding:32px 5%
   - display:flex; justify-content:space-around; flex-wrap:wrap; gap:24px
   - 4 items. Each: text-align:center
     - Number: font:800 2.8rem/1 'Syne'; color:white
     - Label: font:500 .85rem 'DM Sans'; color:rgba(255,255,255,.75); margin-top:6px; text-transform:uppercase; letter-spacing:.06em
   - Use realistic numbers: years in business, happy customers, 5-star reviews, response time etc.
   - JS count-up animation on IntersectionObserver trigger

4. ABOUT
   - padding:96px 5%; max-width:1200px; margin:0 auto
   - display:grid; grid-template-columns:1fr 1fr; gap:80px; align-items:center
   - Left column (image side):
     - position:relative; aspect-ratio:4/5
     - Main image: width:85%; border-radius:var(--radius-lg); overflow:hidden; box-shadow:var(--shadow-lg); object-fit:cover; height:100%
     - Accent image (smaller, overlapping): position:absolute; bottom:-24px; right:0; width:55%; border-radius:var(--radius-md); border:4px solid white; box-shadow:var(--shadow-md); aspect-ratio:4/3; object-fit:cover
     - Years badge: position:absolute; top:24px; left:-16px; background:var(--c-primary); color:white; padding:16px 20px; border-radius:var(--radius-md); font:800 2rem 'Syne'; line-height:1; box-shadow:var(--shadow-md)
       Small label below number: font:500 .75rem 'DM Sans'; opacity:.85
   - Right column:
     - .overline text, then .h2 heading, then 2 paragraphs of body text
     - Differentiators list: 4 items, each display:flex; gap:12px; align-items:flex-start; margin-bottom:16px
       Icon: 20x20 inline SVG checkmark in a 36px circle background:var(--c-primary-light); border-radius:50%; flex-shrink:0
       Text: font:500 .95rem 'DM Sans'

5. SERVICES
   - padding:96px 5%; background:var(--c-bg)
   - Header: centered, .overline + .h2 + short descriptor paragraph; margin-bottom:64px
   - Grid: display:grid; grid-template-columns:repeat(3,1fr); gap:24px
   - Each card:
     background:white; border-radius:var(--radius-md); padding:36px 28px;
     border:1.5px solid rgba(0,0,0,.06); box-shadow:var(--shadow-sm);
     transition:var(--transition);
     hover: transform:translateY(-8px); box-shadow:var(--shadow-lg); border-color:var(--c-primary)
     - Icon wrap: width:56px; height:56px; border-radius:var(--radius-sm); background:var(--c-primary-light); display:flex; align-items:center; justify-content:center; margin-bottom:20px
       SVG icon: 28x28, stroke:var(--c-primary), stroke-width:1.75, fill:none
     - h3 in .h3 style, margin-bottom:10px
     - p in body style, color:var(--c-muted), font-size:.95rem

6. DARK FEATURE BAND
   - background:var(--c-dark); padding:96px 5%
   - Header: .overline (color:var(--c-primary)) + .h2 (color:white); centered; margin-bottom:64px
   - display:grid; grid-template-columns:repeat(4,1fr); gap:32px (or 2 cols on narrow)
   - Each feature:
     border:1px solid rgba(255,255,255,.08); border-radius:var(--radius-md); padding:32px 24px;
     transition:var(--transition)
     hover: border-color:rgba(255,255,255,.2); background:rgba(255,255,255,.03)
     - Icon: 40x40 SVG, color:var(--c-primary)
     - Big word/stat: font:800 1.4rem 'Syne'; color:white; margin:16px 0 8px
     - Description: font-size:.9rem; color:rgba(255,255,255,.55); line-height:1.7

7. TESTIMONIAL (only if rating or reviews data provided)
   - padding:96px 5%; background:var(--c-primary-light)
   - max-width:760px; margin:0 auto; text-align:center
   - Giant quotation mark: font:800 8rem 'Syne'; color:var(--c-primary); opacity:.2; line-height:.5; margin-bottom:16px
   - Quote text: font:400 1.4rem/1.7 'DM Sans'; color:var(--c-text); font-style:italic; margin-bottom:32px
   - Stars: gold ★ ★ ★ ★ ★ font-size:1.2rem; gap:4px; justify-content:center; margin-bottom:16px
   - Attribution: font:600 1rem 'Syne'; color:var(--c-text)
   - Rating summary below: "X.X/5 based on N reviews"

8. CONTACT
   - padding:96px 5%; max-width:1200px; margin:0 auto
   - display:grid; grid-template-columns:1fr 1fr; gap:80px; align-items:start
   - Left: .overline + .h2 + contact details
     Each detail row: display:flex; gap:16px; align-items:flex-start; margin-bottom:24px
     Icon in 44px circle background:var(--c-primary-light), then text block (label in .overline, value in body)
     Phone: <a href="tel:..."> styled in color:var(--c-primary); font:700 1.3rem 'Syne'
     Email: <a href="mailto:..."> link
     Address: plain text
     Hours: plain text
   - Right: the form
     Form wrapper: background:white; border-radius:var(--radius-lg); padding:40px; box-shadow:var(--shadow-md)
     Each field: margin-bottom:20px
       label: display:block; font:600 .8rem 'DM Sans'; letter-spacing:.05em; text-transform:uppercase; color:var(--c-muted); margin-bottom:6px
       input/textarea: width:100%; padding:14px 18px; border:1.5px solid #e8e8e8; border-radius:var(--radius-sm); font:400 1rem 'DM Sans'; outline:none; transition:border-color .2s
       focus: border-color:var(--c-primary)
     Submit btn: full width; background:var(--c-primary); color:white; padding:16px; border-radius:var(--radius-sm); font:600 1rem 'DM Sans'; transition:var(--transition)
     hover: brightness(1.08) translateY(-1px)

9. FOOTER
   - background:var(--c-dark); padding:48px 5% 32px; color:rgba(255,255,255,.5)
   - Top row: display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:24px; padding-bottom:32px; border-bottom:1px solid rgba(255,255,255,.08); margin-bottom:24px
     Logo (same style as nav), tagline in small text, nav links row
   - Bottom: text-align:center; font-size:.85rem "© 2025 [Business]. All rights reserved."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
JAVASCRIPT — include all of this
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Nav scroll effect: window.addEventListener('scroll', () => { nav.classList.toggle('scrolled', window.scrollY > 60) })
2. Hamburger: toggle a .menu-open class on nav, slide down mobile menu
3. IntersectionObserver: add class .visible to sections as they enter viewport
   CSS: .reveal { opacity:0; transform:translateY(40px); transition:opacity .7s ease, transform .7s ease }
        .reveal.visible { opacity:1; transform:none }
   Apply .reveal to: about, services, dark band, testimonial, contact sections
4. Count-up animation for stats bar: triggered by IntersectionObserver, animate from 0 to target over 1.5s using easeOutQuart

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@media (max-width:900px):
  About: grid-template-columns:1fr; image side hidden or shown above text
  Services: grid-template-columns:1fr 1fr
  Dark band: grid-template-columns:1fr 1fr
  Contact: grid-template-columns:1fr

@media (max-width:640px):
  Services: grid-template-columns:1fr
  Dark band: grid-template-columns:1fr
  Nav links hidden, hamburger shown
  Buttons: full width, stacked

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUSINESS DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${userText}

Write all copy as the business owner — confident, local, trustworthy. Zero placeholder text. Make it feel like a real business that's been operating for years.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const upstream = await fetch(url, {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        generationConfig: { maxOutputTokens: 65536, temperature: 0.7 },
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: { message: data?.error?.message || "Gemini API error" } });
    }

    let html = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Strip any accidental markdown fences Gemini might add
    html = html.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    if (!html.toLowerCase().includes("<!doctype") && !html.toLowerCase().includes("<html")) {
      return res.status(500).json({ error: { message: "Gemini did not return valid HTML. Try again." } });
    }

    // Return in Anthropic-compatible shape — but wrap html in a simple JSON so
    // the client can distinguish html from error messages
    res.json({
      content: [{
        type: "text",
        text: JSON.stringify({
          generated_html  : html,
          editable_content: {
            hero_title          : "",
            hero_subtitle       : "",
            call_to_action      : "",
            about_title         : "",
            about_text          : "",
            services_title      : "",
            services_list       : [],
            contact_title       : "",
            contact_instructions: "",
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
      lead_intelligence : "GET  /api/lead-intelligence/:leadId",
      pipeline_analytics: "GET  /api/pipeline/analytics",
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