/**
 * db/migrate.js
 * Sequential migration runner. Append-only — never edit existing entries.
 */

"use strict";

const { getDb } = require("./connection");

const M001 = `
  CREATE TABLE IF NOT EXISTS leads (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE,
    company       TEXT,
    status        TEXT NOT NULL DEFAULT 'new'
                    CHECK(status IN ('new','contacted','qualified','converted','lost')),
    source        TEXT,
    notes         TEXT,
    score         INTEGER DEFAULT 0,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
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
  CREATE INDEX IF NOT EXISTS idx_interactions_lead ON interactions(lead_id);
`;

const M002 = `
  ALTER TABLE leads ADD COLUMN business_name TEXT;
  ALTER TABLE leads ADD COLUMN industry      TEXT;
  ALTER TABLE leads ADD COLUMN location      TEXT;
  ALTER TABLE leads ADD COLUMN website       TEXT;
  UPDATE leads SET business_name = name WHERE business_name IS NULL;
  CREATE INDEX IF NOT EXISTS idx_leads_business_name ON leads(business_name);
  CREATE INDEX IF NOT EXISTS idx_leads_industry      ON leads(industry);
  CREATE INDEX IF NOT EXISTS idx_leads_location      ON leads(location);
`;

const M003 = `
  CREATE TABLE IF NOT EXISTS lead_scores (
    id                    TEXT PRIMARY KEY,
    lead_id               TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    lead_score            INTEGER NOT NULL CHECK(lead_score BETWEEN 1 AND 10),
    tier                  TEXT    NOT NULL CHECK(tier IN ('A','B','C','D')),
    estimated_value_range TEXT    NOT NULL,
    confidence            TEXT    NOT NULL CHECK(confidence IN ('high','medium','low')),
    reasoning             TEXT    NOT NULL,
    red_flags             TEXT    NOT NULL DEFAULT '[]',
    recommended_action    TEXT    NOT NULL,
    model                 TEXT,
    scored_at             DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_lead_scores_lead_id    ON lead_scores(lead_id);
  CREATE INDEX IF NOT EXISTS idx_lead_scores_tier       ON lead_scores(tier);
  CREATE INDEX IF NOT EXISTS idx_lead_scores_lead_score ON lead_scores(lead_score DESC);
  CREATE INDEX IF NOT EXISTS idx_lead_scores_scored_at  ON lead_scores(scored_at DESC);
`;

const M004 = `
  CREATE TABLE IF NOT EXISTS campaign_leads (
    id             TEXT PRIMARY KEY,
    campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    lead_id        TEXT NOT NULL REFERENCES leads(id)     ON DELETE CASCADE,
    email_status   TEXT DEFAULT 'pending'
                     CHECK(email_status IN ('pending','generated','sent','bounced','replied')),
    email_sent_at  DATETIME,
    added_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(campaign_id, lead_id)
  );
  CREATE INDEX IF NOT EXISTS idx_cl_campaign ON campaign_leads(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_cl_lead     ON campaign_leads(lead_id);

  CREATE TABLE IF NOT EXISTS outreach_emails (
    id           TEXT PRIMARY KEY,
    lead_id      TEXT NOT NULL REFERENCES leads(id)     ON DELETE CASCADE,
    campaign_id  TEXT          REFERENCES campaigns(id) ON DELETE SET NULL,
    subject      TEXT NOT NULL,
    body         TEXT NOT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_oe_lead     ON outreach_emails(lead_id);
  CREATE INDEX IF NOT EXISTS idx_oe_campaign ON outreach_emails(campaign_id);
`;

const M005 = `
  CREATE TABLE IF NOT EXISTS generated_messages (
    id                            TEXT PRIMARY KEY,
    lead_id                       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    campaign_id                   TEXT          REFERENCES campaigns(id) ON DELETE SET NULL,
    subject_line                  TEXT NOT NULL,
    email_body                    TEXT NOT NULL,
    short_dm                      TEXT NOT NULL,
    personalization_notes         TEXT,
    lead_score_at_generation      INTEGER,
    estimated_value_at_generation TEXT,
    tone_override                 TEXT,
    model                         TEXT,
    created_at                    DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_gm_lead_id    ON generated_messages(lead_id);
  CREATE INDEX IF NOT EXISTS idx_gm_campaign   ON generated_messages(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_gm_created_at ON generated_messages(created_at DESC);
`;

const M006 = `
  -- email_logs: full audit trail of every send attempt
  CREATE TABLE IF NOT EXISTS email_logs (
    id                   TEXT PRIMARY KEY,
    to_address           TEXT NOT NULL,
    subject              TEXT NOT NULL,
    body                 TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'sent'
                           CHECK(status IN ('sent','failed','bounced','opened')),
    smtp_message_id      TEXT,          -- Message-ID returned by Gmail
    error_message        TEXT,          -- populated on failure
    lead_id              TEXT REFERENCES leads(id) ON DELETE SET NULL,
    campaign_id          TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
    generated_message_id TEXT REFERENCES generated_messages(id) ON DELETE SET NULL,
    source               TEXT DEFAULT 'manual'
                           CHECK(source IN ('manual','campaign','test','outreach')),
    sent_at              DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_el_status      ON email_logs(status);
  CREATE INDEX IF NOT EXISTS idx_el_lead        ON email_logs(lead_id);
  CREATE INDEX IF NOT EXISTS idx_el_campaign    ON email_logs(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_el_sent_at     ON email_logs(sent_at DESC);
  CREATE INDEX IF NOT EXISTS idx_el_to_address  ON email_logs(to_address);
`;

const migrations = [
  { id: "001_initial_schema",        up: M001 },
  { id: "002_leads_business_fields", up: M002 },
  { id: "003_lead_scores_table",     up: M003 },
  { id: "004_campaigns_and_outreach",up: M004 },
  { id: "005_generated_messages",    up: M005 },
  { id: "006_email_logs",             up: M006 },
];

function runMigrations() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id         TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = new Set(
    db.prepare("SELECT id FROM migrations").all().map((r) => r.id)
  );

  let ran = 0;
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    console.log(`  ⏳ Applying migration: ${migration.id}`);
    db.exec(migration.up);
    db.prepare("INSERT INTO migrations (id) VALUES (?)").run(migration.id);
    console.log(`  ✅ Applied: ${migration.id}`);
    ran++;
  }

  if (ran === 0) {
    console.log("  ✅ Database is up to date.");
  } else {
    console.log(`  🎉 ${ran} migration(s) applied.`);
  }
}

module.exports = { runMigrations };

if (require.main === module) {
  require("dotenv").config();
  runMigrations();
  require("./connection").closeDb();
}
