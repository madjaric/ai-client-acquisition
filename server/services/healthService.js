/**
 * services/healthService.js
 * Business logic for system health checks.
 */

const { getDb } = require("../db/connection");
const os = require("os");

function getSystemHealth() {
  const dbStatus = checkDatabase();

  return {
    status: dbStatus.ok ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    uptime_seconds: Math.floor(process.uptime()),
    services: {
      database: dbStatus,
      api: { ok: true, message: "Express API is running" },
    },
    system: {
      platform: os.platform(),
      node_version: process.version,
      memory: {
        used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total_mb: Math.round(os.totalmem() / 1024 / 1024),
      },
    },
  };
}

function checkDatabase() {
  try {
    const db = getDb();
    const row = db.prepare("SELECT 1 AS ok").get();
    return { ok: row.ok === 1, message: "SQLite is connected and responsive" };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

module.exports = { getSystemHealth };
