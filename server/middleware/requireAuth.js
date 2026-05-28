/**
 * middleware/requireAuth.js
 *
 * Verifies JWT token from Authorization header or cookie.
 * Attaches req.user = { id, email, plan } on success.
 *
 * Usage:
 *   app.use("/api/leads", requireAuth, leadsRouter);
 *
 * Token format:
 *   Authorization: Bearer <token>
 *   OR cookie: token=<token>
 */

"use strict";

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "changeme_use_strong_secret_in_prod";

function requireAuth(req, res, next) {
  let token = null;

  // 1. Try Authorization header
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }

  // 2. Try cookie fallback
  if (!token && req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      code: "UNAUTHORIZED",
      message: "Authentication required. Please log in.",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id    : decoded.id,
      email : decoded.email,
      plan  : decoded.plan,
    };
    next();
  } catch (err) {
    const expired = err.name === "TokenExpiredError";
    return res.status(401).json({
      success: false,
      code   : expired ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
      message: expired
        ? "Your session has expired. Please log in again."
        : "Invalid authentication token.",
    });
  }
}

/**
 * Optional auth — attaches req.user if token is present and valid,
 * but does NOT block the request if there's no token.
 */
function optionalAuth(req, res, next) {
  let token = null;

  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }
  if (!token && req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.id, email: decoded.email, plan: decoded.plan };
  } catch {
    // invalid/expired token — ignore silently for optional auth
  }
  next();
}

/**
 * Require a specific plan (or higher).
 * Plan hierarchy: free < pro < agency
 */
const PLAN_RANK = { free: 0, pro: 1, agency: 2 };

function requirePlan(minPlan) {
  return (req, res, next) => {
    const userRank = PLAN_RANK[req.user?.plan] ?? -1;
    const minRank  = PLAN_RANK[minPlan]        ?? 99;
    if (userRank >= minRank) return next();
    return res.status(403).json({
      success: false,
      code   : "PLAN_REQUIRED",
      message: `This feature requires the ${minPlan} plan or higher.`,
      required_plan: minPlan,
      current_plan : req.user?.plan || "none",
    });
  };
}

module.exports = { requireAuth, optionalAuth, requirePlan };
