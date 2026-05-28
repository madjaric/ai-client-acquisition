/**
 * routes/payments.js
 *
 * POST /api/payments/create-checkout   — create Stripe Checkout session
 * POST /api/payments/webhook           — Stripe webhook (plan upgrades)
 * POST /api/payments/create-portal     — customer billing portal session
 * GET  /api/payments/plans             — return plan info (public)
 *
 * Required .env:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   STRIPE_PRO_PRICE_ID
 *   STRIPE_AGENCY_PRICE_ID
 *   APP_URL                  — e.g. https://yourapp.com (for redirect URLs)
 */

"use strict";

const express = require("express");
const router  = express.Router();
const { requireAuth } = require("../middleware/requireAuth");
const { updatePlan, getUserById } = require("../services/authService");
const { getDb } = require("../db/connection");

// ── Stripe init (lazy — only if key is set) ──────────────────────────────
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured.");
  return require("stripe")(key);
}

// ── Plan definitions (also exposed via GET /plans) ────────────────────────
const PLANS = {
  free: {
    name       : "Free",
    price_id   : null,
    monthly_usd: 0,
    searches   : 5,
    features   : ["5 searches/month", "AI lead scoring", "Basic outreach"],
  },
  pro: {
    name       : "Pro",
    price_id   : process.env.STRIPE_PRO_PRICE_ID    || null,
    monthly_usd: 49,
    searches   : 500,
    features   : ["500 searches/month", "AI lead scoring", "Full outreach suite", "Email sending", "Priority support"],
  },
  agency: {
    name       : "Agency",
    price_id   : process.env.STRIPE_AGENCY_PRICE_ID || null,
    monthly_usd: 149,
    searches   : null, // unlimited
    features   : ["Unlimited searches", "Everything in Pro", "Multi-user (coming soon)", "White-label reports"],
  },
};

// ── GET /plans (public) ───────────────────────────────────────────────────
router.get("/plans", (req, res) => {
  res.json({ success: true, plans: PLANS });
});

// ── POST /create-checkout ─────────────────────────────────────────────────
router.post("/create-checkout", requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;

    if (!["pro", "agency"].includes(plan)) {
      return res.status(400).json({ success: false, message: "Invalid plan. Choose 'pro' or 'agency'." });
    }

    const planInfo = PLANS[plan];
    if (!planInfo.price_id) {
      return res.status(503).json({
        success: false,
        message: `Stripe price ID for '${plan}' is not configured. Set STRIPE_${plan.toUpperCase()}_PRICE_ID in .env`,
      });
    }

    const stripe  = getStripe();
    const user    = getUserById(req.user.id);
    const appUrl  = process.env.APP_URL || "http://localhost:3000";

    // Store customer_id if we already have one
    let customerId = user.stripe_customer_id || undefined;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email   : user.email,
        metadata: { leadflow_user_id: user.id },
      });
      customerId = customer.id;
      getDb().prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?")
        .run(customerId, user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer           : customerId,
      mode               : "subscription",
      payment_method_types: ["card"],
      line_items         : [{ price: planInfo.price_id, quantity: 1 }],
      success_url        : `${appUrl}/dashboard.html?payment=success&plan=${plan}`,
      cancel_url         : `${appUrl}/pricing.html?payment=cancelled`,
      metadata           : {
        leadflow_user_id: user.id,
        plan,
      },
      subscription_data  : {
        metadata: { leadflow_user_id: user.id, plan },
      },
    });

    res.json({ success: true, url: session.url, session_id: session.id });
  } catch (err) {
    console.error("Checkout error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /create-portal ───────────────────────────────────────────────────
router.post("/create-portal", requireAuth, async (req, res) => {
  try {
    const stripe  = getStripe();
    const user    = getUserById(req.user.id);
    const appUrl  = process.env.APP_URL || "http://localhost:3000";

    if (!user.stripe_customer_id) {
      return res.status(400).json({
        success: false,
        message: "No billing account found. Please subscribe to a plan first.",
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer  : user.stripe_customer_id,
      return_url: `${appUrl}/dashboard.html`,
    });

    res.json({ success: true, url: session.url });
  } catch (err) {
    console.error("Portal error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /webhook ─────────────────────────────────────────────────────────
// IMPORTANT: This route must receive the RAW body (not parsed JSON).
// In index.js, register this BEFORE express.json() middleware, or
// use express.raw({ type: 'application/json' }) on this route only.

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig    = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!secret) {
      console.error("STRIPE_WEBHOOK_SECRET not set.");
      return res.status(500).send("Webhook secret not configured.");
    }

    let event;
    try {
      event = getStripe().webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      await handleWebhookEvent(event);
      res.json({ received: true });
    } catch (err) {
      console.error("Webhook handler error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Webhook event handler ─────────────────────────────────────────────────

async function handleWebhookEvent(event) {
  const db = getDb();

  switch (event.type) {

    // Subscription activated or renewed
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub      = event.data.object;
      const userId   = sub.metadata?.leadflow_user_id;
      const plan     = sub.metadata?.plan;

      if (!userId || !plan) {
        console.warn("Webhook: missing metadata on subscription", sub.id);
        break;
      }

      if (sub.status === "active" || sub.status === "trialing") {
        updatePlan(userId, plan);
        db.prepare("UPDATE users SET stripe_subscription_id = ? WHERE id = ?")
          .run(sub.id, userId);
        console.log(`✅ Upgraded user ${userId} to plan: ${plan}`);
      }
      break;
    }

    // Subscription cancelled / payment failed — downgrade to free
    case "customer.subscription.deleted": {
      const sub    = event.data.object;
      const userId = sub.metadata?.leadflow_user_id;
      if (userId) {
        updatePlan(userId, "free");
        console.log(`⬇️  Downgraded user ${userId} to free (subscription deleted)`);
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice  = event.data.object;
      const customer = invoice.customer;
      const user     = db.prepare("SELECT id FROM users WHERE stripe_customer_id = ?").get(customer);
      if (user) {
        console.warn(`⚠️  Payment failed for user ${user.id}`);
        // You could send an email notification here
      }
      break;
    }

    default:
      // Unhandled event type — ignore silently
      break;
  }
}

module.exports = router;
