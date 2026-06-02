/**
 * LeadFlow — Stock Image System
 * ─────────────────────────────
 * 20 curated Unsplash business photos served directly from Unsplash CDN.
 * No API key, no billing, no download required — URLs are permanent and free.
 *
 * Usage:
 *   <script src="/stock-images.js"></script>
 *   const url  = LF_STOCK.random();
 *   const urls = LF_STOCK.multiple(5);
 *   const url  = LF_STOCK.byIndustry('plumbing');
 *   LF_STOCK.protect();   // attach onerror handlers to all img tags on page
 */

(function (global) {
  'use strict';

  // ─── Base URL builder ────────────────────────────────────────────────────────
  function u(id, w, h) {
    w = w || 1600;
    h = h || 900;
    return 'https://images.unsplash.com/photo-' + id +
           '?w=' + w + '&h=' + h + '&q=85&fit=crop&auto=format';
  }

  // ─── 20 curated stock photos ─────────────────────────────────────────────────
  // Chosen for: neutral tones, no logos, professional look, 16:9 friendly,
  // suitable for ANY local business category.
  var STOCK = [
    // 01 — Modern open-plan office
    { id: '1504384308-bca52580bca52580', photo: '1497366216548-37526070297c', tags: ['office','workspace','team'] },
    // 02 — Laptop on clean desk
    { id: '1498050108023-c5249f4df085', tags: ['laptop','workspace','tech','desk'] },
    // 03 — Business team meeting
    { id: '1556761175-b413da4baf72', tags: ['meeting','team','business','consulting'] },
    // 04 — Customer service / reception
    { id: '1556742502-ec7c0e9f34b1', tags: ['customer','service','reception','office'] },
    // 05 — Modern building exterior
    { id: '1486325212027-8081e485255e', tags: ['building','exterior','professional','storefront'] },
    // 06 — Service professional at work
    { id: '1507003211169-0a1dd7228f2d', tags: ['professional','service','worker','technician'] },
    // 07 — Tools / workshop
    { id: '1504328345596-9c7c7df1ad62', tags: ['tools','workshop','repair','trade','plumbing','mechanic'] },
    // 08 — Handshake / networking
    { id: '1521791136064-7986c2920216', tags: ['handshake','networking','deal','consulting','business'] },
    // 09 — Modern workspace desk setup
    { id: '1593642632559-0c6d3fc62b89', tags: ['desk','workspace','productivity','home office'] },
    // 10 — Team brainstorm / whiteboard
    { id: '1552664730-d307ca884978', tags: ['team','brainstorm','meeting','marketing','strategy'] },
    // 11 — Smartphone in hand (business)
    { id: '1512941937669-90a1b58e7e9c', tags: ['smartphone','mobile','tech','business'] },
    // 12 — Local storefront / shop exterior
    { id: '1441986300917-64674bd600d8', tags: ['storefront','shop','local','retail','restaurant'] },
    // 13 — Entrepreneur at laptop (café)
    { id: '1559136555-9303baea8eae', tags: ['entrepreneur','startup','cafe','laptop'] },
    // 14 — Abstract business / data background
    { id: '1551288049-bebda4e38f71', tags: ['abstract','data','tech','background','analytics'] },
    // 15 — Professional portrait (team member)
    { id: '1560250097-0b93528c311a', tags: ['professional','portrait','team','person'] },
    // 16 — Growth / success chart concept
    { id: '1579621970588-a35d0e7ab9b6', tags: ['growth','success','chart','finance','results'] },
    // 17 — Modern building interior / lobby
    { id: '1497366754035-f200968a333c', tags: ['interior','lobby','modern','office','building'] },
    // 18 — Outdoor business / construction site
    { id: '1504307651254-35680f356dfd', tags: ['construction','outdoor','work','trade','building'] },
    // 19 — Clean minimalist workspace
    { id: '1542744173-8e7e53415bb0', tags: ['minimalist','workspace','clean','desk','productivity'] },
    // 20 — Happy customers / service interaction
    { id: '1556742049-0cfed4f6a45d', tags: ['customer','happy','service','interaction','retail'] },
  ];

  // Build URL array
  var STOCK_URLS = STOCK.map(function (s) { return u(s.photo || s.id); });

  // Tag → index map for industry lookup
  var TAG_MAP = {};
  STOCK.forEach(function (s, i) {
    (s.tags || []).forEach(function (t) {
      if (!TAG_MAP[t]) TAG_MAP[t] = [];
      TAG_MAP[t].push(i);
    });
  });

  // ─── Industry keyword → stock index pools ───────────────────────────────────
  var INDUSTRY_MAP = {
    plumb:        [6, 5, 7, 17],
    hvac:         [6, 5, 7, 17],
    electr:       [6, 5, 7, 1],
    mechanic:     [6, 17, 5, 0],
    auto:         [6, 17, 5, 0],
    repair:       [6, 17, 7, 5],
    construct:    [17, 6, 4, 7],
    dental:       [5, 3, 15, 0],
    medical:      [5, 3, 15, 19],
    health:       [5, 3, 15, 19],
    restaurant:   [11, 19, 3, 12],
    food:         [11, 19, 12, 3],
    cafe:         [12, 11, 8, 13],
    fitness:      [5, 15, 9, 6],
    gym:          [5, 15, 9, 6],
    landscap:     [17, 6, 4, 18],
    beauty:       [3, 19, 15, 5],
    salon:        [3, 19, 15, 5],
    cleaning:     [18, 6, 0, 3],
    retail:       [11, 19, 3, 12],
    consult:      [7, 2, 9, 0],
    market:       [9, 13, 1, 10],
    tech:         [13, 1, 10, 8],
    law:          [7, 0, 2, 15],
    account:      [16, 0, 7, 13],
    real:         [4, 0, 7, 16],   // real estate
  };

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Return a random stock image URL.
   * @param {number} [w=1600] width
   * @param {number} [h=900]  height
   */
  function random(w, h) {
    var idx = Math.floor(Math.random() * STOCK.length);
    return u(STOCK[idx].photo || STOCK[idx].id, w, h);
  }

  /**
   * Return `count` unique stock image URLs in random order.
   */
  function multiple(count, w, h) {
    count = Math.min(count || 5, STOCK.length);
    var indices = STOCK.map(function (_, i) { return i; });
    // Fisher-Yates shuffle
    for (var i = indices.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = indices[i]; indices[i] = indices[j]; indices[j] = tmp;
    }
    return indices.slice(0, count).map(function (i) {
      return u(STOCK[i].photo || STOCK[i].id, w, h);
    });
  }

  /**
   * Return the best stock image for a given industry string.
   * Falls back to random() if no match found.
   */
  function byIndustry(industry, w, h) {
    if (!industry) return random(w, h);
    var lower = industry.toLowerCase();
    for (var key in INDUSTRY_MAP) {
      if (lower.indexOf(key) !== -1) {
        var pool = INDUSTRY_MAP[key];
        var pick = pool[Math.floor(Math.random() * pool.length)];
        var s    = STOCK[pick];
        return u(s.photo || s.id, w, h);
      }
    }
    return random(w, h);
  }

  /**
   * Return `count` best-fit stock images for the given industry.
   * Fills remaining slots with random images to reach `count`.
   */
  function multipleByIndustry(industry, count, w, h) {
    count = count || 5;
    var lower = (industry || '').toLowerCase();
    var pool  = [];
    for (var key in INDUSTRY_MAP) {
      if (lower.indexOf(key) !== -1) {
        pool = INDUSTRY_MAP[key].slice();
        break;
      }
    }
    // If pool smaller than count, pad with random non-duplicate indices
    var allIdx = STOCK.map(function (_, i) { return i; });
    allIdx.forEach(function (i) {
      if (pool.indexOf(i) === -1) pool.push(i);
    });
    pool = pool.slice(0, count);
    return pool.map(function (i) {
      var s = STOCK[i];
      return u(s.photo || s.id, w, h);
    });
  }

  /**
   * Attach onerror fallback handlers to every <img> on the page.
   * Call this after DOM is ready. Safe to call multiple times.
   */
  function protect() {
    var imgs = document.querySelectorAll('img[data-stock-protected]');
    imgs.forEach(function (img) { img.removeAttribute('data-stock-protected'); });

    document.querySelectorAll('img').forEach(function (img) {
      if (img.dataset.stockProtected) return;
      img.dataset.stockProtected = '1';
      img.addEventListener('error', function () {
        if (img.dataset.stockRetried) return;
        img.dataset.stockRetried = '1';
        img.src = random();
      });
    });
  }

  /**
   * Fix any <img> tags that currently have no src or an empty src.
   * Optionally pass an industry hint for better matching.
   */
  function fillEmpty(industry) {
    document.querySelectorAll('img').forEach(function (img) {
      if (!img.src || img.src === window.location.href || img.src.endsWith('/')) {
        img.src = byIndustry(industry);
      }
    });
  }

  /**
   * Inject onerror attributes into HTML string (server-side / before iframe srcdoc).
   * Returns the patched HTML string.
   */
  function patchHtml(html, industry) {
    if (!html) return html;

    // 1. Add onerror to every <img> tag that doesn't already have one
    html = html.replace(/<img(\b[^>]*?)>/gi, function (match, attrs) {
      if (/onerror/i.test(attrs)) return match;
      var fallback = byIndustry(industry);
      return '<img' + attrs + ' onerror="this.onerror=null;this.src=\'' + fallback + '\'">';
    });

    // 2. Replace placeholder/empty src values
    html = html.replace(/src=["']\s*["']/gi, function () {
      return 'src="' + byIndustry(industry) + '"';
    });

    // 3. Replace obviously broken src patterns (e.g. src="#", src="placeholder")
    html = html.replace(/src=["'](#|placeholder[^"']*|YOUR[_-]IMAGE[^"']*|IMAGE[_-]URL[^"']*|https?:\/\/placeholder[^"']*)["']/gi, function () {
      return 'src="' + byIndustry(industry) + '"';
    });

    return html;
  }

  // ─── Export ──────────────────────────────────────────────────────────────────
  global.LF_STOCK = {
    URLS            : STOCK_URLS,
    random          : random,
    multiple        : multiple,
    byIndustry      : byIndustry,
    multipleByIndustry: multipleByIndustry,
    protect         : protect,
    fillEmpty       : fillEmpty,
    patchHtml       : patchHtml,
  };

}(typeof window !== 'undefined' ? window : this));
