/**
 * db/connection.js
 * Singleton SQLite connection using better-sqlite3
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = process.env.DB_PATH || "./data/database.sqlite";
const resolvedPath = path.resolve(DB_PATH);

// Ensure the data directory exists
const dataDir = path.dirname(resolvedPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db;

function getDb() {
  if (!db) {
    db = new Database(resolvedPath, {
      verbose: process.env.NODE_ENV === "development" ? console.log : null,
    });

    // Enable WAL mode for better concurrent read performance
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    console.log(`✅ SQLite connected: ${resolvedPath}`);
  }
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
    console.log("🔒 SQLite connection closed.");
  }
}

module.exports = { getDb, closeDb };
