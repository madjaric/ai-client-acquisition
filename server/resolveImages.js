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
 *   6. All photo IDs must be in Unsplash UUID format (e.g. 1498050108023-c5249f4df085).
 *      Short numeric-only IDs (e.g. 1216589443) are NOT valid on images.unsplash.com.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/** @param {string} id  Unsplash photo UUID */
function url(id, w, h) {
  return `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&q=85&fit=crop&auto=format`;
}

/**
 * IMAGE POOL REGISTRY
 * Keys match the canonical category keys from resolveIndustry.js exactly.
 * Each array has 4 Unsplash photo UUIDs — all verified UUID format.
 * Index 0 → hero  |  Index 1 → about  |  Indices 2-3 → reserved.
 */
const IMAGE_POOLS = {
  plumb:      ['1504328345596-9c7c7df1ad62',
               '1521791136064-7986c2920216',
               '1497366216548-37526070297c',
               '1498050108023-c5249f4df085'],

  hvac:       ['1504328345596-9c7c7df1ad62',
               '1551288049-bebda4e38f71',
               '1593642632559-0c6d3fc62b89',
               '1512941937669-90a1b58e7e9c'],

  electr:     ['1593642632559-0c6d3fc62b89',
               '1551288049-bebda4e38f71',
               '1498050108023-c5249f4df085',
               '1504328345596-9c7c7df1ad62'],

  construct:  ['1504328345596-9c7c7df1ad62',
               '1521791136064-7986c2920216',
               '1556761175-b413da4baf72',
               '1497366216548-37526070297c'],

  mechanic:   ['1504328345596-9c7c7df1ad62',
               '1551288049-bebda4e38f71',
               '1512941937669-90a1b58e7e9c',
               '1593642632559-0c6d3fc62b89'],

  landscap:   ['1441986300917-64674bd600d8',
               '1556742049-0cfed4f6a45d',
               '1521791136064-7986c2920216',
               '1497366216548-37526070297c'],

  cleaning:   ['1521791136064-7986c2920216',
               '1556761175-b413da4baf72',
               '1497366216548-37526070297c',
               '1504328345596-9c7c7df1ad62'],

  dental:     ['1552664730-d307ca884978',
               '1521791136064-7986c2920216',
               '1556761175-b413da4baf72',
               '1504328345596-9c7c7df1ad62'],

  medical:    ['1556761175-b413da4baf72',
               '1552664730-d307ca884978',
               '1521791136064-7986c2920216',
               '1497366216548-37526070297c'],

  cafe:       ['1441986300917-64674bd600d8',
               '1556742049-0cfed4f6a45d',
               '1521791136064-7986c2920216',
               '1498050108023-c5249f4df085'],

  restaurant: ['1441986300917-64674bd600d8',
               '1556742049-0cfed4f6a45d',
               '1521791136064-7986c2920216',
               '1497366216548-37526070297c'],

  food:       ['1441986300917-64674bd600d8',
               '1556742049-0cfed4f6a45d',
               '1498050108023-c5249f4df085',
               '1521791136064-7986c2920216'],

  fitness:    ['1593642632559-0c6d3fc62b89',
               '1551288049-bebda4e38f71',
               '1504328345596-9c7c7df1ad62',
               '1512941937669-90a1b58e7e9c'],

  beauty:     ['1441986300917-64674bd600d8',
               '1556742049-0cfed4f6a45d',
               '1552664730-d307ca884978',
               '1521791136064-7986c2920216'],

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
