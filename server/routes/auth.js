/**
 * routes/auth.js
 *
 * POST /api/auth/register
 * POST /api/auth/login
 * GET  /api/auth/me
 * POST /api/auth/logout
 */

"use strict";

const express = require("express");
const router  = express.Router();
const { register, login, getProfile } = require("../services/authService");
const { requireAuth } = require("../middleware/requireAuth");

router.post("/register", async (req, res) => {
  try {
    const { email, password, plan } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: "Email and password are required." });

    const result = await register(email, password, plan || "free");
    res.status(201).json({ success: true, message: "Account created.", user: result.user, token: result.token });
  } catch (err) {
    const status = err.code === "EMAIL_TAKEN" ? 409 : err.code === "VALIDATION_ERROR" ? 400 : 500;
    res.status(status).json({ success: false, code: err.code, message: err.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: "Email and password are required." });

    const result = await login(email, password);
    res.json({ success: true, message: "Login successful.", user: result.user, token: result.token });
  } catch (err) {
    const status = err.code === "INVALID_CREDENTIALS" ? 401 : 500;
    res.status(status).json({ success: false, code: err.code, message: err.message });
  }
});

router.get("/me", requireAuth, (req, res) => {
  const user = getProfile(req.user.id);
  if (!user) return res.status(404).json({ success: false, message: "User not found." });
  res.json({ success: true, user });
});

router.post("/logout", (req, res) => {
  res.json({ success: true, message: "Logged out." });
});

module.exports = router;