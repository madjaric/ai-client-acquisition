/**
 * db/migrations/002_add_users.js
 *
 * Creates the users table and adds stripe columns.
 * Run automatically via runMigrations() in migrate.js
 *
 * If you're using a single migrate.js file, paste these statements there.
 */

"use strict";

const MIGRATIONS = [
  // ── users table ──────────────────────────────────────────────────────────
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

  // Index for fast email lookup
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`,

  // Index for Stripe customer lookup
  `CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id)`,
];

/**
 * Run all migrations against the given better-sqlite3 db instance.
 * Each statement is wrapped in an individual try/catch so existing
 * tables/indexes are silently skipped.
 */
function runUserMigrations(db) {
  for (const sql of MIGRATIONS) {
    try {
      db.prepare(sql).run();
    } catch (err) {
      // Already exists — skip
      if (!err.message.includes("already exists")) {
        throw err;
      }
    }
  }
  console.log("  ✅ Users migration applied.");
}

module.exports = { runUserMigrations };
