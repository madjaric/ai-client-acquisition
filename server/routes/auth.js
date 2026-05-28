/**
 * routes/auth.js
 *
 * POST /api/auth/register  — create account
 * POST /api/auth/login     — get JWT token
 * GET  /api/auth/me        — get current user profile
 * POST /api/auth/logout    — client-side token invalidation hint
 */

"use strict";

const express = require("express");
const router  = express.Router();
const { register, login, getProfile } = require("../services/authService");
const { requireAuth } = require("../middleware/requireAuth");

// ── Register ──────────────────────────────────────────────────────────────

router.post("/register", async (req, res) => {
  try {
    const { email, password, plan } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const result = await register(email, password, plan || "free");

    res.status(201).json({
      success: true,
      message: "Account created successfully.",
      user   : result.user,
      token  : result.token,
    });
  } catch (err) {
    const status =
      err.code === "EMAIL_TAKEN"       ? 409 :
      err.code === "VALIDATION_ERROR"  ? 400 : 500;

    res.status(status).json({
      success: false,
      code   : err.code || "SERVER_ERROR",
      message: err.message,
    });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const result = await login(email, password);

    res.json({
      success: true,
      message: "Login successful.",
      user   : result.user,
      token  : result.token,
    });
  } catch (err) {
    const status = err.code === "INVALID_CREDENTIALS" ? 401 : 500;
    res.status(status).json({
      success: false,
      code   : err.code || "SERVER_ERROR",
      message: err.message,
    });
  }
});

// ── Me (profile) ──────────────────────────────────────────────────────────

router.get("/me", requireAuth, (req, res) => {
  const user = getProfile(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found." });
  }
  res.json({ success: true, user });
});

// ── Logout ────────────────────────────────────────────────────────────────
// JWT is stateless — logout is handled client-side by deleting the token.
// This endpoint exists as a convenience signal for frontend.

router.post("/logout", (req, res) => {
  res.json({ success: true, message: "Logged out. Delete your local token." });
});

module.exports = router;
