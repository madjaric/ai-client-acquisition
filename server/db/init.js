/**
 * db/init.js
 * Initializes database schema — run once or on startup.
 * Usage: node server/db/init.js  OR  require'd by server/index.js
 */

require("dotenv").config();
const { getDb, closeDb } = require("./connection");

function initializeSchema() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT UNIQUE NOT NULL,
      company     TEXT,
      status      TEXT NOT NULL DEFAULT 'new'
                    CHECK(status IN ('new','contacted','qualified','converted','lost')),
      source      TEXT,
      notes       TEXT,
      score       INTEGER DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL DEFAULT 'email'
                    CHECK(type IN ('email','linkedin','cold_call','other')),
      status      TEXT NOT NULL DEFAULT 'draft'
                    CHECK(status IN ('draft','active','paused','completed')),
      ai_prompt   TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id            TEXT PRIMARY KEY,
      lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      campaign_id   TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
      type          TEXT NOT NULL DEFAULT 'email',
      direction     TEXT NOT NULL DEFAULT 'outbound'
                      CHECK(direction IN ('outbound','inbound')),
      content       TEXT,
      ai_generated  INTEGER DEFAULT 1,
      sent_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_email       ON leads(email);
    CREATE INDEX IF NOT EXISTS idx_interactions_lead ON interactions(lead_id);
  `);

  console.log("✅ Database schema ready.");
}

module.exports = { initializeSchema };

// Allow running standalone: node server/db/init.js
if (require.main === module) {
  initializeSchema();
  closeDb();
}
