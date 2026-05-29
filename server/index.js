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
//  Root redirect
// ─────────────────────────────────────────────
app.get("/", (req, res) => {
  const wantsHtml = req.headers.accept && req.headers.accept.includes("text/html");
  if (wantsHtml) {
    // Browser → landing page (index.html)
    return res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  }
  // curl/Postman → JSON API index
  res.json({
    name    : "AI Client Acquisition System — LeadFlow",
    version : "1.0.0",
    ui      : "http://localhost:" + PORT + "/",
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
//  SPA fallback
//  - Known HTML pages → serve directly (express.static handles them)
//  - /dashboard.html, /login.html, /register.html etc. are static files
//  - Any unknown route → serve index.html (landing page)
// ─────────────────────────────────────────────
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
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