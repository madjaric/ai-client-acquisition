/**
 * services/authService.js
 */

"use strict";

const bcrypt = require("bcrypt");
const jwt    = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../db/connection");

const SALT_ROUNDS = 12;
const JWT_SECRET  = process.env.JWT_SECRET   || "changeme_use_strong_secret_in_prod";
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || "7d";

const PLAN_LIMITS = { free: 3, pro: 100, agency: Infinity };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, plan: user.plan },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}

function getUserById(id) {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function getUserByEmail(email) {
  return getDb().prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim());
}

// ─── Register ─────────────────────────────────────────────────────────────────

async function register(email, password, plan = "free") {
  if (!email || !password)
    throw Object.assign(new Error("Email and password are required."), { code: "VALIDATION_ERROR" });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    throw Object.assign(new Error("Invalid email address."), { code: "VALIDATION_ERROR" });

  if (password.length < 8)
    throw Object.assign(new Error("Password must be at least 8 characters."), { code: "VALIDATION_ERROR" });

  if (getUserByEmail(email))
    throw Object.assign(new Error("An account with that email already exists."), { code: "EMAIL_TAKEN" });

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  const id  = uuidv4();
  const now = new Date().toISOString();

  getDb().prepare(`
    INSERT INTO users (id, email, password_hash, plan, searches_this_month, searches_reset_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?)
  `).run(id, email.toLowerCase().trim(), password_hash, plan, now, now, now);

  const user  = getUserById(id);
  const token = generateToken(user);
  return { user: sanitizeUser(user), token };
}

// ─── Login ────────────────────────────────────────────────────────────────────

async function login(email, password) {
  if (!email || !password)
    throw Object.assign(new Error("Email and password are required."), { code: "VALIDATION_ERROR" });

  const user = getUserByEmail(email);
  const hash = user?.password_hash || "$2b$12$invalidhashfortimingprotection000000000000000000000";
  const valid = await bcrypt.compare(password, hash);

  if (!user || !valid)
    throw Object.assign(new Error("Invalid email or password."), { code: "INVALID_CREDENTIALS" });

  return { user: sanitizeUser(user), token: generateToken(user) };
}

// ─── Profile ──────────────────────────────────────────────────────────────────

function getProfile(userId) {
  return sanitizeUser(getUserById(userId));
}

function updatePlan(userId, plan) {
  if (!["free", "pro", "agency"].includes(plan)) throw new Error(`Invalid plan: ${plan}`);
  getDb().prepare("UPDATE users SET plan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(plan, userId);
  return sanitizeUser(getUserById(userId));
}

// ─── Quota ────────────────────────────────────────────────────────────────────

function checkSearchQuota(userId) {
  const db   = getDb();
  const user = getUserById(userId);
  if (!user) throw new Error("User not found.");

  const limit = PLAN_LIMITS[user.plan] ?? 5;

  // Monthly reset
  const diffDays = (Date.now() - new Date(user.searches_reset_at)) / (1000 * 60 * 60 * 24);
  if (diffDays >= 30) {
    db.prepare("UPDATE users SET searches_this_month = 0, searches_reset_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId);
    user.searches_this_month = 0;
  }

  const used    = user.searches_this_month || 0;
  const allowed = limit === Infinity || used < limit;
  return {
    allowed,
    used,
    limit    : limit === Infinity ? null : limit,
    plan     : user.plan,
    resets_at: new Date(user.searches_reset_at).toISOString(),
  };
}

function incrementSearchCount(userId) {
  getDb().prepare("UPDATE users SET searches_this_month = searches_this_month + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId);
}

module.exports = {
  register, login, getProfile, updatePlan,
  checkSearchQuota, incrementSearchCount,
  getUserById, getUserByEmail, sanitizeUser,
  PLAN_LIMITS,
};