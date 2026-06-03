/**
 * transformServices.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure function. No side effects. No I/O. No HTML output.
 *
 * transformServices(services: any) → Array<{ name: string, desc: string, icon: string }>
 *
 * CONTRACT
 *   Input : raw JSON "services" field — may be:
 *             Array<string>      e.g. ["Pipe Repair", "Boiler Service"]
 *             string             comma-separated e.g. "Pipe Repair, Boiler Service"
 *             null | undefined   → returns []
 *   Output: Array of plain-data objects, max 6 items:
 *             name  — normalised, sentence-cased service name   (plain text, no HTML)
 *             desc  — benefit-framed one-liner                  (plain text, no HTML)
 *             icon  — key string from ICON_KEYS (not SVG markup — renderLandingPage resolves SVG)
 *
 * RULES
 *   1. Input is normalised before rule matching: trimmed, max 60 chars, dupes removed
 *   2. Max 6 services returned (first 6 after deduplication)
 *   3. desc matching: first rule whose keyword appears in service name (lowercased)
 *   4. icon matching: first rule whose keyword appears in service name (lowercased)
 *   5. If no desc rule matches → generic benefit suffix applied
 *   6. If no icon rule matches → icon key = "default"
 *   7. Output items contain ONLY plain strings — renderLandingPage() renders HTML
 *   8. Same input always returns same output (no randomness)
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/** Maximum services rendered. */
const MAX_SERVICES = 6;

/** Maximum character length per service name after trim. */
const MAX_NAME_LEN = 60;

/**
 * BENEFIT DESCRIPTION RULES
 * Ordered by specificity. First match wins.
 * Each rule: { keywords: string[], desc: string }
 */
const DESC_RULES = [
  {
    keywords: ['emergency', 'callout', 'call-out', '24/7', 'urgent', 'same day', 'same-day'],
    desc: 'Priority response — we answer and arrive when others don\'t.',
  },
  {
    keywords: ['boiler', 'furnace', 'heat pump'],
    desc: 'Annual care that extends your boiler\'s life and cuts energy bills.',
  },
  {
    keywords: ['pipe', 'drain', 'leak', 'flood', 'burst'],
    desc: 'Fixed right the first time — no mess, no repeat visits.',
  },
  {
    keywords: ['electr', 'wiring', 'fuse', 'circuit', 'socket', 'consumer unit'],
    desc: 'Safe, certified work — fully Part P compliant on completion.',
  },
  {
    keywords: ['roof', 'gutter', 'fascia', 'soffit', 'flat roof'],
    desc: 'Weather-tight finish backed by our full workmanship guarantee.',
  },
  {
    keywords: ['plaster', 'render', 'paint', 'decor', 'wall'],
    desc: 'Flawless finish, on schedule, with minimal disruption to your day.',
  },
  {
    keywords: ['garden', 'lawn', 'landscap', 'turf', 'tree', 'hedge', 'pav', 'deck'],
    desc: 'Transformed outdoor space that adds real kerb appeal.',
  },
  {
    keywords: ['clean', 'maid', 'janitor', 'hygiene', 'carpet', 'window', 'pressure'],
    desc: 'Spotless results every visit, using professional-grade equipment.',
  },
  {
    keywords: ['install', 'fit', 'supply', 'replac'],
    desc: 'Fully fitted and tested before we leave — zero punch-list.',
  },
  {
    keywords: ['annual service', 'service contract', 'maintenance', 'check', 'inspect', 'survey'],
    desc: 'Preventative care that avoids the costly breakdowns.',
  },
  {
    keywords: ['consult', 'survey', 'assess', 'audit', 'report', 'plan'],
    desc: 'Expert assessment with a clear written report — no jargon.',
  },
  {
    keywords: ['tile', 'floor', 'laminate', 'vinyl', 'hardwood'],
    desc: 'Precision fitting that lasts, with zero mess left behind.',
  },
  {
    keywords: ['extend', 'extension', 'convert', 'loft', 'basement'],
    desc: 'Quality space that adds value and is built to planning spec.',
  },
];

/** Generic fallback — used when no DESC_RULES keyword matches. */
const DEFAULT_DESC = 'Professional service delivered on time and on budget.';

/**
 * ICON KEY RULES
 * Maps service name keywords → an icon identifier string.
 * renderLandingPage() resolves this key to actual SVG markup.
 * Ordered by specificity. First match wins.
 */
const ICON_RULES = [
  { keywords: ['pipe', 'plumb', 'drain', 'leak', 'flood', 'burst', 'water'], icon: 'wrench'    },
  { keywords: ['boiler', 'heat', 'hvac', 'furnace', 'radiator'],             icon: 'flame'     },
  { keywords: ['electr', 'wiring', 'fuse', 'circuit', 'solar', 'power'],     icon: 'lightning' },
  { keywords: ['roof', 'gutter', 'fascia', 'soffit'],                        icon: 'home'      },
  { keywords: ['garden', 'lawn', 'landscap', 'tree', 'hedge', 'turf'],       icon: 'leaf'      },
  { keywords: ['clean', 'maid', 'janitor', 'hygiene', 'carpet', 'pressure'], icon: 'sparkle'   },
  { keywords: ['emergency', 'callout', 'urgent', '24/7'],                    icon: 'alert'     },
  { keywords: ['install', 'fit', 'supply', 'replac'],                        icon: 'tool'      },
  { keywords: ['consult', 'survey', 'inspect', 'audit', 'report'],           icon: 'clipboard' },
  { keywords: ['paint', 'decor', 'plaster'],                                 icon: 'brush'     },
  { keywords: ['construct', 'build', 'extend', 'convert', 'loft'],           icon: 'hammer'    },
  { keywords: ['mechanic', 'tyre', 'tire', 'car', 'auto', 'vehicle', 'mot'], icon: 'car'       },
  { keywords: ['tile', 'floor', 'laminate'],                                 icon: 'grid'      },
];

/** Fallback icon key when no ICON_RULES keyword matches. */
const DEFAULT_ICON = 'check';

/**
 * Normalise a single raw service name string.
 * - Trims whitespace
 * - Truncates to MAX_NAME_LEN chars (at word boundary where possible)
 * - Sentence-cases (first letter upper, rest preserved)
 * Returns null if the result is empty — caller must filter.
 *
 * @param  {any}    raw
 * @returns {string|null}
 */
function normaliseName(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;

  // Truncate at word boundary
  if (s.length > MAX_NAME_LEN) {
    const cut = s.slice(0, MAX_NAME_LEN).lastIndexOf(' ');
    s = cut > MAX_NAME_LEN * 0.6 ? s.slice(0, cut) : s.slice(0, MAX_NAME_LEN);
    s = s.trimEnd();
  }

  // Sentence-case: uppercase only the very first character
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Match a normalised service name against a rule table.
 * @param  {string}  name       Normalised service name
 * @param  {Array}   rules      Rule array (DESC_RULES or ICON_RULES)
 * @param  {string}  resultKey  Property name to extract from matched rule ('desc' | 'icon')
 * @param  {string}  fallback   Returned when no rule matches
 * @returns {string}
 */
function matchRule(name, rules, resultKey, fallback) {
  const lower = name.toLowerCase();
  for (const rule of rules) {
    for (const keyword of rule.keywords) {
      if (lower.includes(keyword)) return rule[resultKey];
    }
  }
  return fallback;
}

/**
 * transformServices
 * @param   {Array<string>|string|null|undefined} services  Raw JSON services field
 * @returns {Array<{ name: string, desc: string, icon: string }>}
 */
function transformServices(services) {
  // ── Normalise input to an array of strings ─────────────────────────────────
  let raw = [];
  if (Array.isArray(services)) {
    raw = services;
  } else if (typeof services === 'string' && services.trim()) {
    raw = services.split(',');
  } else {
    return [];
  }

  // ── Normalise names, filter empties, deduplicate, cap at MAX_SERVICES ──────
  const seen = new Set();
  const names = [];
  for (const item of raw) {
    const name = normaliseName(item);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length === MAX_SERVICES) break;
  }

  // ── Apply desc + icon rules to each name ───────────────────────────────────
  return names.map(function(name) {
    return {
      name: name,
      desc: matchRule(name, DESC_RULES, 'desc', DEFAULT_DESC),
      icon: matchRule(name, ICON_RULES, 'icon', DEFAULT_ICON),
    };
  });
}

module.exports = { transformServices, DESC_RULES, ICON_RULES, DEFAULT_DESC, DEFAULT_ICON, MAX_SERVICES };
