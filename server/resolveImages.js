/**
 * resolveImages.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure function. No side effects. No randomness. No I/O.
 *
 * resolveImages(category: string) → { hero: string, about: string }
 *
 * CONTRACT
 *   Input : canonical category key from resolveIndustry() — one of the 18
 *           named keys or "fallback"
 *   Output: { hero: string, about: string }
 *           Both are fully-formed Unsplash CDN URLs, ready for src= injection.
 *
 * RULES
 *   1. Input must be a category key. Free-form strings are not accepted here —
 *      always call resolveIndustry() first.
 *   2. hero uses portrait ratio  4:5 → w=900  h=1125
 *   3. about uses portrait ratio 4:5 → w=800  h=1000
 *   4. Selection is deterministic: index [0] = hero, index [1] = about.
 *      No Math.random(). Same category always returns identical URLs.
 *   5. Every category pool has exactly 4 IDs.
 *      [0] = hero,  [1] = about,  [2] = reserved,  [3] = reserved
 *   6. Unsplash photo IDs in this file are the only permitted image sources
 *      in the render pipeline. Free-form URLs are never injected.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/** @param {string} id  Unsplash photo ID (may include long-form UUIDs) */
function url(id, w, h) {
  return `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&q=85&fit=crop&auto=format`;
}

/**
 * IMAGE POOL REGISTRY
 * Keys match the canonical category keys from resolveIndustry.js exactly.
 * Each array has 4 Unsplash photo IDs.
 * Index 0 → hero  |  Index 1 → about  |  Indices 2-3 → reserved for future slots.
 */
const IMAGE_POOLS = {
  plumb:      ['1216589443-1216589443',
                '2988232-2988232',
                '1599703-1599703',
                '3517739-3517739'],

  hvac:       ['1145434-1145434',
                '162568-162568',
                '257636-257636',
                '3862634-3862634'],

  electr:     ['1422408-1422408',
                '257636-257636',
                '162568-162568',
                '1145434-1145434'],

  construct:  ['1117452-1117452',
                '585419-585419',
                '1395963-1395963',
                '2138922-2138922'],

  mechanic:   ['1492144533-1492144533',
                '1486262322-1486262322',
                '1549399645-1549399645',
                '1503736235-1503736235'],

  landscap:   ['1214497-1214497',
                '296230-296230',
                '1301585-1301585',
                '1459495-1459495'],

  cleaning:   ['1581579831-1581579831',
                '1563453676-1563453676',
                '1504327396-1504327396',
                '1614628801-1614628801'],

  dental:     ['3845810-3845810',
                '3279209-3279209',
                '4021775-4021775',
                '4386466-4386466'],

  medical:    ['5215001-5215001',
                '4021775-4021775',
                '3845810-3845810',
                '4386466-4386466'],

  cafe:       ['1603912-1603912',
                '1556909-1556909',
                '302899-302899',
                '1640777-1640777'],

  restaurant: ['1640777-1640777',
                '262978-262978',
                '299347-299347',
                '1279330-1279330'],

  food:       ['1279330-1279330',
                '67468-67468',
                '262978-262978',
                '1640777-1640777'],

  fitness:    ['1954524-1954524',
                '1552106-1552106',
                '841130-841130',
                '4164418-4164418'],

  beauty:     ['3065209-3065209',
                '3993449-3993449',
                '1570807-1570807',
                '3065171-3065171'],

  retail:     ['1441986300917-64674bd600d8',
                '1556742049-0cfed4f6a45d',
                '1521791136064-7986c2920216',
                '1497366216548-37526070297c'],

  law:        ['1521791136064-7986c2920216',
                '1556761175-b413da4baf72',
                '1497366216548-37526070297c',
                '1504328345596-9c7c7df1ad62'],

  consult:    ['1556761175-b413da4baf72',
                '1521791136064-7986c2920216',
                '1552664730-d307ca884978',
                '1497366216548-37526070297c'],

  tech:       ['1593642632559-0c6d3fc62b89',
                '1551288049-bebda4e38f71',
                '1498050108023-c5249f4df085',
                '1512941937669-90a1b58e7e9c'],

  fallback:   ['1497366216548-37526070297c',
                '1521791136064-7986c2920216',
                '1504328345596-9c7c7df1ad62',
                '1498050108023-c5249f4df085'],
};

/**
 * resolveImages
 * @param   {string} category  Canonical key from resolveIndustry()
 * @returns {{ hero: string, about: string }}  Fully-formed Unsplash URLs
 */
function resolveImages(category) {
  const pool = IMAGE_POOLS[category] || IMAGE_POOLS.fallback;
  return {
    hero:  url(pool[0], 900,  1125),
    about: url(pool[1], 800,  1000),
  };
}

module.exports = { resolveImages, IMAGE_POOLS };
