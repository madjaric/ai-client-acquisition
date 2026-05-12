/**
 * server/index.js
 * Entry point — configures and starts the Express server.
 */

require("dotenv").config();

const path    = require("path");               // FIX 1: top-level import
const express = require("express");
const helmet  = require("helmet");
const cors    = require("cors");
const morgan  = require("morgan");
const rateLimit = require("express-rate-limit");

const { getDb, closeDb } = require("./db/connection");

const healthRouter           = require("./routes/health");
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
//  Security & Middleware
// ─────────────────────────────────────────────

// FIX 2: Helmet CSP was blocking inline scripts and Google Fonts.
// We relax only what the dashboards actually need — everything else stays strict.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"], // 🔥 OVO JE KLJUČNO
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
      },
    },
  })
);

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

// Rate limiter — API routes only, never static files
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max     : parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders  : false,
  message: { success: false, message: "Too many requests — please try again later." },
});
app.use("/api", limiter);

// ─────────────────────────────────────────────
//  Static files — BEFORE API routes and before the 404 handler
// ─────────────────────────────────────────────
// FIX 3: static middleware moved before API routes and the old JSON root handler.
// express.static will serve dashboard.html, discovery.html, etc.
// index.html is NOT the primary entrypoint here (dashboard.html is), but it
// is still served correctly at /index.html.
app.use(express.static(PUBLIC_DIR, {
  // Cache for 1 hour in production, no cache in dev
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
}));

// ─────────────────────────────────────────────
//  API Routes
// ─────────────────────────────────────────────
app.use("/api/health",           healthRouter);
app.use("/api/leads",            leadsRouter);
app.use("/api/score-lead",       scoreLeadRouter);
app.use("/api/campaigns",        campaignsRouter);
app.use("/api/outreach",         outreachRouter);
app.use("/api/generate-outreach",generateOutreachRouter);
app.use("/api/send-email",       sendEmailRouter);
app.use("/api/discovery",        discoveryRouter);

// ─────────────────────────────────────────────
//  Root redirect
// ─────────────────────────────────────────────
// FIX 4: Root used to return JSON, hijacking the browser before static could
// serve dashboard.html.  Now it redirects to the real dashboard.
app.get("/", (req, res) => {
  // Accept: text/html → redirect to dashboard
  // Accept: application/json (curl, Postman) → return the API index JSON
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
      leads             : "GET  /api/leads  |  POST /api/leads  |  PATCH /api/leads/:id",
      score_lead        : "POST /api/score-lead  |  GET /api/score-lead/ranked",
      generate_outreach : "POST /api/generate-outreach",
      send_email        : "POST /api/send-email",
      discovery         : "POST /api/discovery/search  |  POST /api/discovery/import",
    },
  });
});

// ─────────────────────────────────────────────
//  SPA fallback — serves dashboard.html for any unknown non-API route
// ─────────────────────────────────────────────
// FIX 5: Catch-all for client-side routes. Must come AFTER all API routes
// so /api/* 404s still return JSON, not HTML.
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "dashboard.html"));
});

// ─────────────────────────────────────────────
//  Error handlers
// ─────────────────────────────────────────────
// API 404 — only reached for /api/* paths not matched above
app.use("/api", (req, res) => {
  res.status(404).json({ success: false, message: `API route not found: ${req.originalUrl}` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err);
  const wantsJson = req.originalUrl.startsWith("/api") ||
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

  const server = app.listen(PORT, () => {
    console.log(`\n🚀 LeadFlow — AI Client Acquisition System`);
    console.log(`   Env      : ${process.env.NODE_ENV || "development"}`);
    console.log(`   Dashboard: http://localhost:${PORT}/dashboard.html`);
    console.log(`   Discovery: http://localhost:${PORT}/discovery.html`);
    console.log(`   API Health: http://localhost:${PORT}/api/health`);
    console.log(`   SERPAPI  : ${process.env.SERPAPI_KEY ? "✅ configured" : "⚠️  not set (mock data)"}`);
    console.log(`   AI       : ${process.env.GEMINI_API_KEY ? "✅ configured" : "⚠️  ANTHROPIC_API_KEY not set"}\n`);
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
