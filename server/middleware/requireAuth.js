/**
 * middleware/requireAuth.js
 */

"use strict";

const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "changeme_use_strong_secret_in_prod";

function requireAuth(req, res, next) {
  let token = null;

  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) token = authHeader.slice(7);
  if (!token && req.cookies?.token) token = req.cookies.token;

  if (!token) {
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Authentication required." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.id, email: decoded.email, plan: decoded.plan };
    next();
  } catch (err) {
    const expired = err.name === "TokenExpiredError";
    return res.status(401).json({
      success: false,
      code   : expired ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
      message: expired ? "Session expired. Please log in again." : "Invalid token.",
    });
  }
}

const PLAN_RANK = { free: 0, pro: 1, agency: 2 };

function requirePlan(minPlan) {
  return (req, res, next) => {
    const userRank = PLAN_RANK[req.user?.plan] ?? -1;
    const minRank  = PLAN_RANK[minPlan]        ?? 99;
    if (userRank >= minRank) return next();
    return res.status(403).json({
      success: false, code: "PLAN_REQUIRED",
      message: `This feature requires the ${minPlan} plan or higher.`,
      required_plan: minPlan, current_plan: req.user?.plan || "none",
    });
  };
}

module.exports = { requireAuth, requirePlan };