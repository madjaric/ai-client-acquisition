/**
 * resolveIndustry.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure function. No side effects. No I/O.
 *
 * resolveIndustry(industry: string | undefined) → string (canonical category key)
 *
 * CONTRACT
 *   Input : any string from the JSON "industry" field (free text, any case)
 *   Output: one of the 18 canonical keys below, or "fallback"
 *
 * RULES
 *   1. Input is lowercased before matching
 *   2. Matching is substring — first rule whose keyword appears in the input wins
 *   3. Rules are ordered by specificity (more specific before more general)
 *   4. Null / undefined / empty string → "fallback"
 *   5. No input mutation. Same input always returns same output.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/**
 * CANONICAL INDUSTRY RULES
 * Ordered by specificity — do NOT reorder without re-testing all cases.
 *
 * Each entry: { keywords: string[], key: string }
 * Matching: input.toLowerCase().includes(keyword) for any keyword in the list.
 */
const INDUSTRY_RULES = [
  // ── Trades ──────────────────────────────────────────────────────────────────
  { key: 'plumb',      keywords: ['plumb', 'pipe', 'drain', 'water leak', 'waterproof'] },
  { key: 'hvac',       keywords: ['hvac', 'heating', 'cooling', 'air condition', 'boiler', 'furnace', 'ventilat'] },
  { key: 'electr',     keywords: ['electr', 'wiring', 'fuse', 'circuit', 'solar panel', 'ev charg'] },
  { key: 'construct',  keywords: ['construct', 'builder', 'building', 'build ', 'roofing', 'roof ', 'roofer', 'tiling', 'plastering', 'extension', 'renovation', 'remodel', 'scaff', 'floor'] },
  { key: 'mechanic',   keywords: ['mechanic', 'auto repair', 'car repair', 'tyre', 'tire ', 'garage', 'mot ', 'bodywork', 'exhaust'] },
  { key: 'landscap',   keywords: ['landscap', 'garden', 'lawn', 'tree surg', 'groundskeep', 'turf', 'irrigation', 'paving', 'fencing'] },
  { key: 'cleaning',   keywords: ['clean', 'janitor', 'maid', 'housekeep', 'pressure wash', 'carpet clean', 'window clean', 'mold remov'] },

  // ── Health ───────────────────────────────────────────────────────────────────
  { key: 'dental',     keywords: ['dental', 'dentist', 'orthodont', 'oral', 'tooth', 'teeth', 'endodont'] },
  { key: 'medical',    keywords: ['medical', 'health clinic', 'physio', 'chiropract', 'osteo', 'clinic', 'therapy', 'therapist', 'doctor', 'gp ', 'optician'] },

  // ── Food & Drink ─────────────────────────────────────────────────────────────
  { key: 'cafe',       keywords: ['cafe', 'caf\u00e9', 'coffee shop', 'barista', 'tea room', 'coffee house', 'espresso bar', 'boba', 'bubble tea'] },
  { key: 'restaurant', keywords: ['restaurant', 'bistro', 'brasserie', 'diner', 'eatery', 'steakhouse', 'sushi', 'pizzeria', 'trattoria'] },
  { key: 'food',       keywords: ['food', 'bakery', 'catering', 'pizza', 'takeaway', 'takeout', 'deli ', 'grocer', 'butcher', 'patisserie'] },

  // ── Fitness & Beauty ─────────────────────────────────────────────────────────
  { key: 'fitness',    keywords: ['fitness', 'gym', 'yoga', 'pilates', 'crossfit', 'personal train', 'martial arts', 'swimming', 'sport'] },
  { key: 'beauty',     keywords: ['beauty', 'salon', 'spa', 'nail ', 'hair ', 'hairdress', 'barbershop', 'barber', 'waxing', 'lash', 'brow', 'aesthet'] },

  // ── Retail ───────────────────────────────────────────────────────────────────
  { key: 'retail',     keywords: ['retail', 'shop', 'store', 'boutique', 'outlet', 'showroom', 'market stall', 'florist', 'jewel', 'gift ', 'toy '] },

  // ── Professional Services ─────────────────────────────────────────────────────
  { key: 'law',        keywords: ['law ', 'legal', 'attorney', 'solicitor', 'barrister', 'conveyancing', 'notary'] },
  { key: 'consult',    keywords: ['consult', 'coach', 'strateg', 'advis', 'accountant', 'accounting', 'bookkeep', 'financial plann', 'insurance', 'mortgage', 'real estate', 'estate agent'] },
  { key: 'tech',       keywords: ['tech', 'software', ' it ', 'it support', 'managed it', 'cyber', 'digital', 'web design', 'app develop', 'seo', 'marketing', 'media', 'print', 'photography', 'video'] },
];

/** Sentinel returned when no rule matches. */
const FALLBACK_KEY = 'fallback';

/**
 * resolveIndustry
 * @param   {string|null|undefined} industry  Raw industry string from JSON
 * @returns {string}                          Canonical category key or "fallback"
 */
function resolveIndustry(industry) {
  if (!industry || typeof industry !== 'string') return FALLBACK_KEY;

  const lower = industry.toLowerCase().trim();
  if (!lower) return FALLBACK_KEY;

  for (const rule of INDUSTRY_RULES) {
    for (const keyword of rule.keywords) {
      if (lower.includes(keyword)) return rule.key;
    }
  }

  return FALLBACK_KEY;
}

module.exports = { resolveIndustry, INDUSTRY_RULES, FALLBACK_KEY };
