/**
 * services/leadsService.js
 * Business logic for lead management.
 * Fields: business_name, industry, location, website (opt), notes (opt)
 */

const { getDb } = require("../db/connection");
const { v4: uuidv4 } = require("uuid");

// ─────────────────────────────────────────────
//  Read
// ─────────────────────────────────────────────

/**
 * List all leads with optional filters and pagination.
 * @param {object} opts
 * @param {string}  [opts.status]   - filter by status
 * @param {string}  [opts.industry] - filter by industry (partial match)
 * @param {string}  [opts.location] - filter by location (partial match)
 * @param {string}  [opts.search]   - search business_name (partial match)
 * @param {number}  [opts.limit]    - default 50
 * @param {number}  [opts.offset]   - default 0
 */
function getAllLeads({ status, industry, location, search, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (industry) {
    conditions.push("industry LIKE ?");
    params.push(`%${industry}%`);
  }
  if (location) {
    conditions.push("location LIKE ?");
    params.push(`%${location}%`);
  }
  if (search) {
    conditions.push("business_name LIKE ?");
    params.push(`%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `SELECT * FROM leads ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  const rows = db.prepare(query).all(...params);

  // Total count for pagination meta
  const countQuery = `SELECT COUNT(*) as total FROM leads ${where}`;
  const { total } = db.prepare(countQuery).get(...params.slice(0, -2));

  return { leads: rows, total, limit: Number(limit), offset: Number(offset) };
}

/** Get single lead by ID */
function getLeadById(id) {
  return getDb().prepare("SELECT * FROM leads WHERE id = ?").get(id);
}

/** Check for duplicate business_name + location combination */
function leadExists(business_name, location, excludeId = null) {
  const db = getDb();
  const query = excludeId
    ? "SELECT id FROM leads WHERE business_name = ? AND location = ? AND id != ?"
    : "SELECT id FROM leads WHERE business_name = ? AND location = ?";
  const params = excludeId
    ? [business_name, location, excludeId]
    : [business_name, location];
  return !!db.prepare(query).get(...params);
}

// ─────────────────────────────────────────────
//  Write
// ─────────────────────────────────────────────

/**
 * Create a new lead.
 * @param {object} data
 * @param {string} data.business_name  - required
 * @param {string} data.industry       - required
 * @param {string} data.location       - required
 * @param {string} [data.website]      - optional
 * @param {string} [data.notes]        - optional
 */
function createLead({ business_name, industry, location, website, notes }) {
  const db = getDb();

  if (leadExists(business_name, location)) {
    const err = new Error(
      `A lead for "${business_name}" in "${location}" already exists.`
    );
    err.code = "DUPLICATE_LEAD";
    throw err;
  }

  const id = uuidv4();

  db.prepare(`
    INSERT INTO leads (id, name, business_name, industry, location, website, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    business_name,           // keep legacy `name` col in sync
    business_name,
    industry,
    location,
    website  || null,
    notes    || null
  );

  return getLeadById(id);
}

/**
 * Update allowed fields on a lead.
 * All fields are optional — only provided ones are updated.
 */
function updateLead(id, fields) {
  const db = getDb();
  const ALLOWED = ["business_name", "industry", "location", "website", "notes", "status", "score"];
  const updates = Object.keys(fields).filter((k) => ALLOWED.includes(k) && fields[k] !== undefined);

  if (updates.length === 0) throw new Error("No valid fields provided for update.");

  // Sync legacy `name` if business_name is being updated
  if (fields.business_name) {
    updates.push("name");
    fields.name = fields.business_name;
  }

  // Duplicate check when business_name + location changes
  const current = getLeadById(id);
  if (!current) return null;

  const newName     = fields.business_name || current.business_name;
  const newLocation = fields.location      || current.location;
  if (
    (fields.business_name || fields.location) &&
    leadExists(newName, newLocation, id)
  ) {
    const err = new Error(
      `A lead for "${newName}" in "${newLocation}" already exists.`
    );
    err.code = "DUPLICATE_LEAD";
    throw err;
  }

  const setClause = [...updates, "updated_at"].map((k) =>
    k === "updated_at" ? "updated_at = CURRENT_TIMESTAMP" : `${k} = ?`
  ).join(", ");

  db.prepare(`UPDATE leads SET ${setClause} WHERE id = ?`)
    .run(...updates.map((k) => fields[k]), id);

  return getLeadById(id);
}

/** Delete a lead by ID. Returns true if deleted. */
function deleteLead(id) {
  const info = getDb().prepare("DELETE FROM leads WHERE id = ?").run(id);
  return info.changes > 0;
}

/** Update just the AI score */
function setLeadScore(id, score) {
  return updateLead(id, { score });
}

module.exports = {
  getAllLeads,
  getLeadById,
  createLead,
  updateLead,
  deleteLead,
  setLeadScore,
};
