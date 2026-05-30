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

    const fullPrompt = `You are a world-class web designer who builds stunning, modern landing pages that win design awards. Generate a complete single-file HTML landing page for the local business below.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Return ONLY raw HTML starting with <!DOCTYPE html>. Zero explanation. No markdown. No code fences.
- Everything self-contained: all CSS inside one <style> tag, all JS inline before </body>.
- Google Fonts allowed via <link>. No other external CSS frameworks.
- Real Unsplash images via https://images.unsplash.com/photo-XXXXXXXXXX?w=1600&q=80 — pick photos that genuinely match the industry (cars/garage for mechanics, teeth/clinic for dental, tools for HVAC, etc). Use at least 2-3 real photos.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESIGN STANDARD — 2025 PREMIUM AGENCY LEVEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HERO SECTION:
- Full-viewport (100vh) with a real Unsplash photo as background
- Dark overlay gradient (e.g. linear-gradient(135deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.4) 100%))
- Bold display font (e.g. Syne, Playfair Display, Bebas Neue, or Clash Display via Google Fonts)
- Giant headline (clamp(3rem, 8vw, 7rem)), tight letter-spacing (-0.03em), white text
- Eyebrow label above headline (e.g. "Phoenix, AZ · Mobile Mechanic") in a pill badge
- Subheadline in a lighter weight, max 2 lines
- Star rating badge if rating data provided
- Two CTA buttons: primary (brand color, filled) + secondary (white outline)
- Animated entrance: elements slide up and fade in with staggered delays

TYPOGRAPHY:
- Pair a bold display font for headings with a clean sans-serif for body (e.g. Syne + Inter, or Bebas Neue + DM Sans)
- Section headings: 2.5-3.5rem, font-weight 800, letter-spacing -0.02em
- Body: 1.05rem, line-height 1.75, color #4a4a5a on light backgrounds

COLOR:
- Choose a BOLD, industry-specific palette. NOT generic navy/gray.
  - Auto/mechanic: deep charcoal (#0f0f0f) + electric orange (#ff5c00) + white
  - Dental: crisp white + deep teal (#0a7c6e) + warm gold (#f5b731)
  - HVAC: dark slate (#1a1f2e) + ice blue (#4fc3f7) + white
  - Restaurant: warm black (#1a1008) + rich amber (#d97706) + cream (#fdf6ec)
  - Gym/fitness: near-black + neon green (#39ff14) or electric red
  - Landscaping: deep forest (#1a2e1a) + bright lime (#7dc243)
  - Plumbing: deep navy (#0d1b2a) + bright cyan (#06b6d4)
  - Use CSS custom properties (--primary, --accent, --bg-dark, etc.)

LAYOUT & SECTIONS (in order):
1. STICKY NAV: Transparent on hero, solid dark on scroll (JS scroll listener). Logo left, links right. Clean and minimal.
2. HERO: As described above.
3. STATS BAR: Full-width dark band with 3-4 animated count-up numbers (years experience, jobs done, rating, response time). Bold numbers, small labels.
4. ABOUT: Two-column layout. Left: real Unsplash photo in a stylish frame (border-radius, box-shadow, slight rotation or overlap). Right: heading, 2-3 paragraphs, a list of key differentiators with checkmark icons.
5. SERVICES: 3-column card grid. Cards have: icon (SVG inline), title, description. On hover: cards lift (translateY(-8px)), border glows with accent color. Use box-shadow and border transitions.
6. WHY CHOOSE US: Dark background section (--bg-dark). 3-4 feature boxes with large icon, bold stat or keyword, short description.
7. TESTIMONIAL: If rating/reviews provided, a testimonial quote section with large decorative quotation marks, star icons, and reviewer attribution.
8. CONTACT: Two-column. Left: address, phone (tel: link), email (mailto: link), hours. Right: a styled "Book Now" or "Get a Quote" form (name, phone, message fields) — styled beautifully, non-functional placeholder.
9. FOOTER: Dark background, logo, tagline, copyright. Clean and minimal.

EFFECTS & POLISH:
- CSS scroll-triggered animations: sections fade+slide up as they enter viewport (use IntersectionObserver in JS)
- Smooth hover transitions everywhere (0.25s ease)
- Service cards: glass-morphism style OR solid with dramatic box-shadow
- Gradient accents: subtle gradient overlays on section backgrounds
- Custom scrollbar styling
- Mobile: hamburger menu, stacked layout, touch-friendly buttons (min 48px tap targets)
- NO stock clip-art icons — use clean inline SVG icons

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUSINESS DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${userText}

Write all copy as if you are the business owner — confident, professional, local. No Lorem ipsum. No placeholder text. Make it feel real and trustworthy.`;

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