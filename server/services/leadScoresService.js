/**
 * services/leadScoresService.js
 *
 * Persistence layer for AI scoring results.
 * Each score is stored in `lead_scores` and linked to the parent lead.
 * Multiple scores per lead are supported (history is preserved).
 */

"use strict";

const { getDb } = require("../db/connection");
const { v4: uuidv4 } = require("uuid");

// ─────────────────────────────────────────────
//  Write
// ─────────────────────────────────────────────

/**
 * Persist a scoring result returned by aiScoring.scoreLead().
 *
 * @param {string} leadId   - the lead's UUID
 * @param {object} result   - full ScoringResult from aiScoring
 * @returns {object}        - the newly inserted row
 */
function saveScore(leadId, result) {
  const db = getDb();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO lead_scores (
      id,
      lead_id,
      lead_score,
      tier,
      estimated_value_range,
      confidence,
      reasoning,
      red_flags,
      recommended_action,
      model,
      scored_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    id,
    leadId,
    result.lead_score,
    result.tier,
    result.estimated_value_range,
    result.confidence,
    result.reasoning,
    JSON.stringify(result.red_flags),    // store array as JSON string
    result.recommended_action,
    result.model,
  );

  // Keep the lead's top-level score column in sync with the latest result
  db.prepare(`
    UPDATE leads
    SET score = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(result.lead_score, leadId);

  return getScoreById(id);
}

// ─────────────────────────────────────────────
//  Read
// ─────────────────────────────────────────────

/** Get a single score record by its own ID */
function getScoreById(id) {
  const row = getDb().prepare("SELECT * FROM lead_scores WHERE id = ?").get(id);
  return row ? deserialize(row) : null;
}

/** Get the most recent score for a lead */
function getLatestScoreForLead(leadId) {
  const row = getDb()
    .prepare("SELECT * FROM lead_scores WHERE lead_id = ? ORDER BY scored_at DESC LIMIT 1")
    .get(leadId);
  return row ? deserialize(row) : null;
}

/** Get full scoring history for a lead (newest first) */
function getScoreHistoryForLead(leadId) {
  const rows = getDb()
    .prepare("SELECT * FROM lead_scores WHERE lead_id = ? ORDER BY scored_at DESC")
    .all(leadId);
  return rows.map(deserialize);
}

/**
 * Get all leads with their latest score — useful for dashboard / ranking.
 * @param {object} opts
 * @param {string} [opts.tier]    - filter by tier A|B|C|D
 * @param {number} [opts.min_score] - filter by minimum lead_score
 * @param {number} [opts.limit]   - default 50
 * @param {number} [opts.offset]  - default 0
 */
function getRankedLeads({ tier, min_score, limit = 50, offset = 0 } = {}) {
  const db = getDb();

  const conditions = [];
  const params = [];

  if (tier) {
    conditions.push("ls.tier = ?");
    params.push(tier);
  }
  if (min_score !== undefined) {
    conditions.push("ls.lead_score >= ?");
    params.push(Number(min_score));
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.prepare(`
    SELECT
      l.id            AS lead_id,
      l.business_name,
      l.industry,
      l.location,
      l.website,
      l.status        AS lead_status,
      ls.id           AS score_id,
      ls.lead_score,
      ls.tier,
      ls.estimated_value_range,
      ls.confidence,
      ls.reasoning,
      ls.red_flags,
      ls.recommended_action,
      ls.scored_at
    FROM lead_scores ls
    INNER JOIN leads l ON l.id = ls.lead_id
    -- only keep the most recent score per lead
    INNER JOIN (
      SELECT lead_id, MAX(scored_at) AS max_scored_at
      FROM lead_scores
      GROUP BY lead_id
    ) latest ON ls.lead_id = latest.lead_id AND ls.scored_at = latest.max_scored_at
    ${where}
    ORDER BY ls.lead_score DESC, ls.scored_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  return rows.map((row) => ({
    ...row,
    red_flags: safeParseJson(row.red_flags, []),
  }));
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
function deserialize(row) {
  return {
    ...row,
    red_flags: safeParseJson(row.red_flags, []),
  };
}

function safeParseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = {
  saveScore,
  getScoreById,
  getLatestScoreForLead,
  getScoreHistoryForLead,
  getRankedLeads,
};
