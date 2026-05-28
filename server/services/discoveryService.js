/**
 * services/discoveryService.js
 *
 * Wraps SerpAPI Google Maps search + AI enrichment.
 * NOW INCLUDES: per-user monthly search quota enforcement.
 *
 * Quota limits (enforced when userId is supplied):
 *   free   →  5 searches/month
 *   pro    →  500 searches/month
 *   agency →  unlimited
 *
 * Pass userId to searchBusinesses() to enforce limits.
 * Omit userId to skip quota (e.g. internal/admin calls).
 */

"use strict";

const { checkSearchQuota, incrementSearchCount } = require("./authService");

// ─────────────────────────────────────────────────────────────────────────────
//  SerpAPI search
// ─────────────────────────────────────────────────────────────────────────────

const SERPAPI_BASE = "https://serpapi.com/search.json";

/**
 * Search Google Maps for businesses via SerpAPI.
 * @param {string} query     — e.g. "plumbers in Austin TX"
 * @param {object} [opts]
 * @param {string} [opts.userId]    — if provided, quota is checked
 * @param {number} [opts.limit]     — max results to return (default 20)
 * @returns {Promise<object[]>}
 */
async function searchBusinesses(query, { userId, limit = 20 } = {}) {
  // ── Quota check ──────────────────────────────────────────────────────────
  if (userId) {
    const quota = checkSearchQuota(userId);

    if (!quota.allowed) {
      const err = Object.assign(
        new Error(
          `Monthly search limit reached (${quota.used}/${quota.limit}). ` +
          `Upgrade to a higher plan for more searches.`
        ),
        {
          code     : "QUOTA_EXCEEDED",
          used     : quota.used,
          limit    : quota.limit,
          plan     : quota.plan,
          resets_at: quota.resets_at,
        }
      );
      throw err;
    }
  }

  // ── Actual search ────────────────────────────────────────────────────────
  const apiKey = process.env.SERPAPI_KEY;

  let results;

  if (!apiKey) {
    // No API key — return mock data for development
    console.warn("⚠️  SERPAPI_KEY not set. Returning mock discovery data.");
    results = getMockResults(query, limit);
  } else {
    results = await fetchFromSerpApi(query, apiKey, limit);
  }

  // ── Increment counter AFTER successful search ────────────────────────────
  if (userId) {
    incrementSearchCount(userId);
  }

  return results;
}

async function fetchFromSerpApi(query, apiKey, limit) {
  const params = new URLSearchParams({
    engine  : "google_maps",
    q       : query,
    api_key : apiKey,
    num     : String(Math.min(limit, 20)),
    type    : "search",
  });

  const response = await fetch(`${SERPAPI_BASE}?${params}`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SerpAPI error [${response.status}]: ${body}`);
  }

  const data = await response.json();
  const places = data.local_results || data.places_results || [];

  return places.slice(0, limit).map(normalizeResult);
}

function normalizeResult(place) {
  return {
    place_id     : place.place_id     || null,
    business_name: place.title        || "",
    rating       : place.rating       || null,
    reviews      : place.reviews      || null,
    type         : place.type         || null,
    types        : place.types        || [],
    address      : place.address      || "",
    phone        : place.phone        || null,
    website      : place.website      || null,
    hours        : place.hours        || null,
    thumbnail    : place.thumbnail    || null,
    gps_coordinates: place.gps_coordinates || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Mock data (when SERPAPI_KEY is not set)
// ─────────────────────────────────────────────────────────────────────────────

function getMockResults(query, limit = 5) {
  const industries = ["Plumbing", "Roofing", "HVAC", "Landscaping", "Auto Repair"];
  const locations  = ["Austin, TX", "Denver, CO", "Miami, FL", "Chicago, IL", "Phoenix, AZ"];

  return Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
    place_id     : `mock_${Date.now()}_${i}`,
    business_name: `${industries[i % industries.length]} Pro ${i + 1}`,
    rating       : (3.5 + Math.random() * 1.5).toFixed(1),
    reviews      : Math.floor(Math.random() * 300) + 10,
    type         : industries[i % industries.length],
    types        : [industries[i % industries.length].toLowerCase()],
    address      : `${100 + i * 10} Main St, ${locations[i % locations.length]}`,
    phone        : `+1-555-${String(1000 + i).padStart(4, "0")}`,
    website      : null,
    hours        : null,
    thumbnail    : null,
    gps_coordinates: null,
    _mock        : true,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Quota info (for dashboard display)
// ─────────────────────────────────────────────────────────────────────────────

function getQuotaInfo(userId) {
  if (!userId) return null;
  return checkSearchQuota(userId);
}

module.exports = {
  searchBusinesses,
  getQuotaInfo,
};
