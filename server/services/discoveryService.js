/**
 * services/discoveryService.js
 *
 * Original discovery logic (SerpAPI + mock) preserved intact.
 * Added: per-user monthly search quota enforcement.
 */

"use strict";

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

// ─────────────────────────────────────────────────────────────────────────────
//  SERPAPI — LIVE DATA
// ─────────────────────────────────────────────────────────────────────────────

async function searchViaSerpApi(keyword, limit = 20) {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY not set");

  const params = new URLSearchParams({
    engine  : "google_maps",
    q       : keyword,
    type    : "search",
    api_key : key,
    num     : String(Math.min(limit, 20)),
  });

  const res = await fetch(`${SERPAPI_ENDPOINT}?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SerpAPI error [${res.status}]: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(`SerpAPI: ${data.error}`);

  const results = data.local_results || [];
  return results.slice(0, limit).map(r => normalizeSerp(r, keyword));
}

function normalizeSerp(r, keyword) {
  const industry = inferIndustry(keyword, r.type || "");
  return {
    name         : String(r.title   || "").trim(),
    location     : String(r.address || r.place_info?.address || "").trim(),
    industry,
    rating       : r.rating   ? parseFloat(r.rating)    : null,
    review_count : r.reviews  ? parseInt(r.reviews, 10) : null,
    website      : r.website  ? normalizeUrl(r.website) : null,
    phone        : r.phone    || null,
    place_id     : r.place_id || null,
    source       : "serpapi",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  MOCK DATA
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_TEMPLATES = {
  roofing: [
    { name: "Summit Roofing & Restoration",  rating: 4.8, review_count: 312, website: true,  phone: "(512) 334-7821" },
    { name: "ProShield Roofing",              rating: 4.6, review_count: 187, website: true,  phone: "(512) 445-9032" },
    { name: "Apex Roofing Solutions",         rating: 4.4, review_count: 98,  website: true,  phone: "(512) 778-2341" },
    { name: "TrueNorth Roofing Co.",          rating: 4.7, review_count: 251, website: true,  phone: "(512) 661-5509" },
    { name: "StormGuard Roofing",             rating: 4.3, review_count: 74,  website: false, phone: "(512) 889-1234" },
    { name: "Heritage Roof Masters",          rating: 4.9, review_count: 429, website: true,  phone: "(512) 220-8877" },
    { name: "Reliable Roofing & Gutters",     rating: 3.8, review_count: 43,  website: false, phone: "(512) 345-6789" },
    { name: "Lone Star Roofing",              rating: 4.5, review_count: 163, website: true,  phone: "(512) 776-3300" },
    { name: "Capital City Roofers",           rating: 4.1, review_count: 56,  website: false, phone: "(512) 901-2233" },
    { name: "Presidio Roofing Group",         rating: 4.7, review_count: 389, website: true,  phone: "(512) 567-4410" },
  ],
  dental: [
    { name: "Bright Smiles Family Dentistry", rating: 4.9, review_count: 614, website: true,  phone: "(713) 234-5566" },
    { name: "ClearView Dental",               rating: 4.7, review_count: 298, website: true,  phone: "(713) 445-7782" },
    { name: "Prestige Dental Care",           rating: 4.6, review_count: 201, website: true,  phone: "(713) 889-1123" },
    { name: "Lakeside Dentistry",             rating: 4.4, review_count: 87,  website: false, phone: "(713) 334-9900" },
    { name: "Metro Dental Group",             rating: 4.8, review_count: 502, website: true,  phone: "(713) 661-2233" },
    { name: "Gentle Touch Dental",            rating: 3.9, review_count: 45,  website: false, phone: "(713) 778-5544" },
    { name: "Advanced Smiles Dentistry",      rating: 4.7, review_count: 347, website: true,  phone: "(713) 220-1100" },
    { name: "Family First Dental",            rating: 4.5, review_count: 133, website: true,  phone: "(713) 901-7788" },
    { name: "Sunrise Dental Studio",          rating: 4.3, review_count: 68,  website: false, phone: "(713) 567-3344" },
    { name: "Apex Oral Health",               rating: 4.8, review_count: 417, website: true,  phone: "(713) 334-6655" },
  ],
  hvac: [
    { name: "Arctic Air HVAC Services",     rating: 4.8, review_count: 445, website: true,  phone: "(602) 334-1122" },
    { name: "CoolBreeze HVAC",              rating: 4.6, review_count: 221, website: true,  phone: "(602) 556-8833" },
    { name: "Premier Climate Control",      rating: 4.7, review_count: 388, website: true,  phone: "(602) 778-2244" },
    { name: "Comfort Zone HVAC",            rating: 4.3, review_count: 76,  website: false, phone: "(602) 889-5566" },
    { name: "Desert HVAC Pros",             rating: 4.9, review_count: 612, website: true,  phone: "(602) 220-9977" },
    { name: "AllSeasons Heating & Cooling", rating: 4.4, review_count: 112, website: true,  phone: "(602) 445-6677" },
    { name: "Efficient Air Solutions",      rating: 3.7, review_count: 31,  website: false, phone: "(602) 667-3388" },
    { name: "ThermoTech HVAC",              rating: 4.6, review_count: 189, website: true,  phone: "(602) 901-1122" },
    { name: "Oasis Climate Services",       rating: 4.5, review_count: 244, website: true,  phone: "(602) 334-4455" },
    { name: "Reliable Heating & Air",       rating: 4.2, review_count: 67,  website: false, phone: "(602) 567-7788" },
  ],
  plumbing: [
    { name: "FlowPro Plumbing",           rating: 4.8, review_count: 378, website: true,  phone: "(305) 334-2211" },
    { name: "RapidResponse Plumbers",     rating: 4.6, review_count: 201, website: true,  phone: "(305) 556-4433" },
    { name: "Precision Pipe & Drain",     rating: 4.7, review_count: 267, website: true,  phone: "(305) 778-6655" },
    { name: "Master Plumbing Solutions",  rating: 4.5, review_count: 143, website: false, phone: "(305) 889-8877" },
    { name: "AquaFix Plumbing",           rating: 4.9, review_count: 534, website: true,  phone: "(305) 220-0099" },
    { name: "City Drain Specialists",     rating: 4.2, review_count: 58,  website: false, phone: "(305) 445-1122" },
    { name: "24/7 Emergency Plumbers",    rating: 4.7, review_count: 312, website: true,  phone: "(305) 667-3344" },
    { name: "ProFlow Plumbing & Gas",     rating: 4.4, review_count: 91,  website: true,  phone: "(305) 901-5566" },
    { name: "Clearwater Plumbing Co.",    rating: 3.9, review_count: 42,  website: false, phone: "(305) 334-7788" },
    { name: "Apex Pipe Solutions",        rating: 4.6, review_count: 178, website: true,  phone: "(305) 567-9900" },
  ],
  law: [
    { name: "Morrison & Associates Law",   rating: 4.9, review_count: 312, website: true,  phone: "(214) 334-1234" },
    { name: "Pinnacle Legal Group",        rating: 4.7, review_count: 178, website: true,  phone: "(214) 556-5678" },
    { name: "Atlas Law Firm",              rating: 4.8, review_count: 234, website: true,  phone: "(214) 778-9012" },
    { name: "Liberty Defense Attorneys",   rating: 4.5, review_count: 98,  website: false, phone: "(214) 889-3456" },
    { name: "Premier Personal Injury Law", rating: 4.9, review_count: 567, website: true,  phone: "(214) 220-7890" },
    { name: "Cornerstone Family Law",      rating: 4.6, review_count: 143, website: true,  phone: "(214) 445-2345" },
    { name: "Sterling Business Attorneys", rating: 4.4, review_count: 67,  website: false, phone: "(214) 667-6789" },
    { name: "Nexus Litigation Partners",   rating: 4.7, review_count: 289, website: true,  phone: "(214) 901-0123" },
    { name: "Avante Legal Solutions",      rating: 3.8, review_count: 34,  website: false, phone: "(214) 334-4567" },
    { name: "Keystone Law Group",          rating: 4.8, review_count: 401, website: true,  phone: "(214) 567-8901" },
  ],
  restaurant: [
    { name: "The Rustic Table",             rating: 4.7, review_count: 892,  website: true,  phone: "(415) 334-1111" },
    { name: "Ember & Oak Bistro",           rating: 4.8, review_count: 1243, website: true,  phone: "(415) 556-2222" },
    { name: "Harbor View Dining",           rating: 4.5, review_count: 567,  website: true,  phone: "(415) 778-3333" },
    { name: "Casa Fuerte",                  rating: 4.6, review_count: 734,  website: false, phone: "(415) 889-4444" },
    { name: "Saffron Kitchen",              rating: 4.9, review_count: 1876, website: true,  phone: "(415) 220-5555" },
    { name: "Pier 22 Seafood",              rating: 4.4, review_count: 445,  website: true,  phone: "(415) 445-6666" },
    { name: "Blue Door Cafe",               rating: 3.8, review_count: 189,  website: false, phone: "(415) 667-7777" },
    { name: "The Golden Fork",              rating: 4.7, review_count: 967,  website: true,  phone: "(415) 901-8888" },
    { name: "Nomad Street Food",            rating: 4.3, review_count: 312,  website: false, phone: "(415) 334-9999" },
    { name: "Altitude Rooftop Bar & Grill", rating: 4.8, review_count: 2134, website: true,  phone: "(415) 567-0000" },
  ],
  gym: [
    { name: "IronWill Fitness",          rating: 4.8, review_count: 678, website: true,  phone: "(312) 334-1010" },
    { name: "Momentum Athletic Club",    rating: 4.7, review_count: 445, website: true,  phone: "(312) 556-2020" },
    { name: "CoreStrength Studio",       rating: 4.9, review_count: 891, website: true,  phone: "(312) 778-3030" },
    { name: "Peak Performance Gym",      rating: 4.5, review_count: 234, website: false, phone: "(312) 889-4040" },
    { name: "CrossFit Elevate",          rating: 4.6, review_count: 312, website: true,  phone: "(312) 220-5050" },
    { name: "Vitality Wellness Center",  rating: 4.4, review_count: 178, website: true,  phone: "(312) 445-6060" },
    { name: "Urban Boxing & Fitness",    rating: 4.7, review_count: 567, website: false, phone: "(312) 667-7070" },
    { name: "The Training Zone",         rating: 3.9, review_count: 89,  website: false, phone: "(312) 901-8080" },
    { name: "Elite Performance Lab",     rating: 4.8, review_count: 734, website: true,  phone: "(312) 334-9090" },
    { name: "FitLife Health Club",       rating: 4.3, review_count: 156, website: true,  phone: "(312) 567-0101" },
  ],
  default: [
    { name: "Pinnacle Business Services",  rating: 4.7, review_count: 234, website: true,  phone: "(555) 334-1111" },
    { name: "Apex Solutions Group",        rating: 4.5, review_count: 178, website: true,  phone: "(555) 556-2222" },
    { name: "Summit Professional Services",rating: 4.8, review_count: 345, website: true,  phone: "(555) 778-3333" },
    { name: "Premier Local Business",      rating: 4.3, review_count: 89,  website: false, phone: "(555) 889-4444" },
    { name: "Cornerstone Enterprises",     rating: 4.6, review_count: 267, website: true,  phone: "(555) 220-5555" },
    { name: "Pacific Services Co.",        rating: 4.4, review_count: 134, website: false, phone: "(555) 445-6666" },
    { name: "Atlas Professional Group",    rating: 4.9, review_count: 512, website: true,  phone: "(555) 667-7777" },
    { name: "Keystone Business Solutions", rating: 4.2, review_count: 67,  website: false, phone: "(555) 901-8888" },
    { name: "Liberty Local Services",      rating: 4.7, review_count: 389, website: true,  phone: "(555) 334-9999" },
    { name: "Sterling Professional Co.",   rating: 4.5, review_count: 201, website: true,  phone: "(555) 567-0000" },
  ],
};

function searchViaMock(keyword, limit = 20) {
  const kw        = keyword.toLowerCase();
  const cityMatch = keyword.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
  const city      = cityMatch.length > 0 ? cityMatch.join(" ") : extractCity(keyword);
  const industry  = inferIndustry(keyword, "");

  let templates = MOCK_TEMPLATES.default;
  for (const [key, tpl] of Object.entries(MOCK_TEMPLATES)) {
    if (key !== "default" && kw.includes(key)) { templates = tpl; break; }
  }

  return templates.slice(0, limit).map(t => ({
    name         : t.name,
    location     : city || "United States",
    industry,
    rating       : t.rating ? Math.round((t.rating + (Math.random() * 0.2 - 0.1)) * 10) / 10 : null,
    review_count : t.review_count,
    website      : t.website
      ? `https://www.${t.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`
      : null,
    phone        : t.phone,
    place_id     : null,
    source       : "mock",
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function extractCity(keyword) {
  const stateAbbr = keyword.match(/\b([A-Z]{2})\b/);
  const words     = keyword.replace(/\b[A-Z]{2}\b/, "").trim().split(/\s+/);
  const SKIP = new Set([
    "roofing","roof","dental","dentist","hvac","plumbing","plumber","law","lawyer",
    "attorney","restaurant","gym","fitness","landscaping","electrician","auto",
    "repair","cleaning","painting","locksmith","accountant","accounting",
    "services","company","near","best","top","local","in","and","the",
  ]);
  const cityWords = words.filter(w => w.length > 2 && !SKIP.has(w.toLowerCase()));
  if (cityWords.length) {
    return stateAbbr ? `${cityWords.join(" ")}, ${stateAbbr[1]}` : cityWords.join(" ");
  }
  return "";
}

function inferIndustry(keyword, type) {
  const text = (keyword + " " + type).toLowerCase();
  if (text.match(/roof/))                          return "Roofing";
  if (text.match(/dental|dentist|orthodont/))      return "Healthcare / Dentistry";
  if (text.match(/hvac|heating|cooling|air cond/)) return "HVAC / Climate Control";
  if (text.match(/plumb/))                         return "Plumbing";
  if (text.match(/law|attorney|legal|litigation/)) return "Legal Services";
  if (text.match(/restaurant|cafe|bistro|food/))   return "Restaurant / Food & Beverage";
  if (text.match(/gym|fitness|crossfit|yoga/))     return "Health & Fitness";
  if (text.match(/landscap|lawn|garden/))          return "Landscaping";
  if (text.match(/electric/))                      return "Electrical Services";
  if (text.match(/auto|car|vehicle|mechanic/))     return "Automotive";
  if (text.match(/clean/))                         return "Cleaning Services";
  if (text.match(/paint/))                         return "Painting Services";
  if (text.match(/account/))                       return "Accounting / Finance";
  if (text.match(/real estate|realtor|realty/))    return "Real Estate";
  if (text.match(/insur/))                         return "Insurance";
  if (text.match(/salon|barber|hair|nail/))        return "Beauty & Personal Care";
  if (text.match(/medic|clinic|hospital|health/))  return "Healthcare";
  if (text.match(/mortgage|loan|lending/))         return "Mortgage / Lending";
  return "Local Business";
}

function normalizeUrl(url) {
  if (!url) return null;
  return url.startsWith("http") ? url : `https://${url}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  QUOTA HELPERS  (requires authService — only used when userId is passed)
// ─────────────────────────────────────────────────────────────────────────────

function getAuthService() {
  // Lazy require so the file works even if authService isn't deployed yet
  try { return require("./authService"); } catch { return null; }
}

function getQuotaInfo(userId) {
  if (!userId) return null;
  const auth = getAuthService();
  return auth ? auth.checkSearchQuota(userId) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Search for businesses.
 * @param {string} keyword           e.g. "roofing Austin TX"
 * @param {object} [opts]
 * @param {string} [opts.userId]     if set, quota is checked + incremented
 * @param {number} [opts.limit]      max results (default 20)
 */
async function searchBusinesses(keyword, { userId, limit = 20 } = {}) {
  if (!keyword || keyword.trim().length < 2) {
    throw new Error("keyword must be at least 2 characters.");
  }

  // ── Quota check ────────────────────────────────────────────────────────────
  if (userId) {
    const auth = getAuthService();
    if (auth) {
      const quota = auth.checkSearchQuota(userId);
      if (!quota.allowed) {
        const err = Object.assign(
          new Error(`Monthly search limit reached (${quota.used}/${quota.limit}). Upgrade to search more.`),
          { code: "QUOTA_EXCEEDED", used: quota.used, limit: quota.limit, plan: quota.plan, resets_at: quota.resets_at }
        );
        throw err;
      }
    }
  }

  // ── Search ─────────────────────────────────────────────────────────────────
  let results;
  if (process.env.SERPAPI_KEY) {
    try {
      results = await searchViaSerpApi(keyword.trim(), limit);
    } catch (err) {
      console.warn(`[discovery] SerpAPI failed (${err.message}), falling back to mock.`);
      if (err.message.includes("credits") || err.message.includes("quota")) throw err;
      results = searchViaMock(keyword.trim(), limit);
    }
  } else {
    results = searchViaMock(keyword.trim(), limit);
  }

  // ── Increment counter after successful search ──────────────────────────────
  if (userId) {
    const auth = getAuthService();
    if (auth) auth.incrementSearchCount(userId);
  }

  return results;
}

function getDataSource() {
  return process.env.SERPAPI_KEY ? "serpapi" : "mock";
}

module.exports = { searchBusinesses, getDataSource, inferIndustry, getQuotaInfo };