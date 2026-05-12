/**
 * routes/health.js
 * GET /api/health — system status endpoint
 */

const express = require("express");
const router = express.Router();
const { getSystemHealth } = require("../services/healthService");

router.get("/", (req, res) => {
  try {
    const health = getSystemHealth();
    const statusCode = health.status === "healthy" ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (err) {
    res.status(503).json({
      status: "error",
      timestamp: new Date().toISOString(),
      message: err.message,
    });
  }
});

module.exports = router;
