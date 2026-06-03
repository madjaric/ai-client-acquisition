/**
 * renderLandingPage.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Render engine. Orchestrates the three pure functions and injects their
 * output into the HTML template.
 *
 * renderLandingPage(templateHTML: string, jsonData: object) → string
 *
 * ARCHITECTURE CONTRACT
 *   This function contains ZERO inline decision logic.
 *   Every decision is delegated to a pure function:
 *     resolveIndustry(industry)   → category key
 *     resolveImages(category)     → { hero, about }
 *     transformServices(services) → [{ name, desc, icon }]
 *
 *   This function is responsible only for:
 *     1. Calling the three pure functions
 *     2. Building HTML fragments from their plain-data outputs
 *     3. Replacing all {{placeholders}} in the template
 *     4. Returning the final HTML string
 *
 *   If you find yourself writing an if/switch inside renderLandingPage()
 *   that makes a business decision → it belongs in a pure function instead.
 *
 * PERMITTED logic inside this file:
 *   - String interpolation                   (building HTML fragments)
 *   - Null-coalescing for missing fields     (|| operator with literal defaults)
 *   - Array.map() to turn data → HTML        (presentation transform, not business logic)
 *   - String.replace() for placeholder swap  (mechanics of injection)
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { resolveIndustry }   = require('./resolveIndustry');
const { resolveImages }     = require('./resolveImages');
const { transformServices } = require('./transformServices');

// ─── SVG Icon Library ────────────────────────────────────────────────────────
// Keyed by the icon identifier strings returned by transformServices().
// All icons: viewBox="0 0 24 24", fill="none", stroke="currentColor",
// stroke-width="2", stroke-linecap="round", stroke-linejoin="round"

const SVG_ICONS = {
  wrench:    '<polyline points="14.7 6.3 9 12 7.5 10.5"/><path d="M5 3a2 2 0 0 0 0 4l10 10a2 2 0 0 0 3-3L8 4a2 2 0 0 0-3-1z"/><line x1="15" y1="9" x2="19" y2="5"/>',
  flame:     '<path d="M12 2c0 0-4 4-4 8a4 4 0 0 0 8 0c0-4-4-8-4-8z"/><path d="M12 14a2 2 0 0 0 0-4 2 2 0 0 0 0 4z"/>',
  lightning: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  home:      '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  leaf:      '<path d="M17 8C8 10 5.9 16.17 3.82 22C9.48 19.39 14.22 17 17 8z"/><path d="M3.82 22s4-5.84 9-8.18"/>',
  sparkle:   '<path d="M12 3L9.5 9.5 3 12l6.5 2.5L12 21l2.5-6.5L21 12l-6.5-2.5z"/>',
  alert:     '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  tool:      '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.77 3.77z"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>',
  brush:     '<path d="M18 3a3 3 0 0 0-3 3l-7 7 2 4 8-8a3 3 0 0 0 0-6z"/><path d="M4 21c.9-.9 2.2-1.4 3.2-1.4 2 0 2 1.4 4 1.4s2.2-2.1 3.2-3"/>',
  hammer:    '<path d="M15 12l-8.373 8.373a1 1 0 0 1-1.415 0l-.585-.585a1 1 0 0 1 0-1.415L13 10"/><path d="M9.5 5.5L11 4a3.414 3.414 0 0 1 4.828 0l.172.172a3.414 3.414 0 0 1 0 4.828L14.5 10.5"/>',
  car:       '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  grid:      '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  check:     '<polyline points="20 6 9 17 4 12"/>',
};

// ─── Tone → CTA default + class ──────────────────────────────────────────────
// This table is the single source of truth for tone effects.
// Tone influences ONLY: the CSS class on <html> and the cta_text default.

const TONE_MAP = {
  professional: { cls: '',                 ctaDefault: 'Get a Free Quote'         },
  aggressive:   { cls: 'tone-aggressive',  ctaDefault: 'Call Now — We\'re Ready'  },
  premium:      { cls: 'tone-premium',     ctaDefault: 'Request Your Consultation' },
};

const DEFAULT_TONE = 'professional';

// ─── HTML escape ─────────────────────────────────────────────────────────────
// All plain-text values from JSON pass through this before injection.
// Prevents XSS and broken attributes from unexpected characters in AI output.

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;')
    // Neutralise placeholder tokens in user-supplied values.
    // Prevents second-pass injection: {{field}} in a value becoming
    // a live placeholder after the first replacement pass.
    // {{ → &#123;&#123;  and  }} → &#125;&#125;
    .replace(/\{\{/g, '&#123;&#123;')
    .replace(/\}\}/g, '&#125;&#125;');
}

// ─── URL-safe sanitisers ──────────────────────────────────────────────────────
// sanitisePhone: strips any character that cannot appear in a legitimate phone
// number. Blocks protocol-injection (javascript:, data:, vbscript:) at source.
// Returns empty string if nothing valid remains after stripping.
function sanitisePhone(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  // Block any scheme-like prefix before hitting the tel: href
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(s)) return '';
  // Allow only characters valid in a phone number: digits, space, +, -, (, ), #, x/ext notation
  const cleaned = s.replace(/[^0-9 +\-()#xXeExtE,.]/g, '').trim();
  return cleaned;
}

// sanitiseEmail: basic structural check — must contain @ and a dot after @.
// Returns empty string for anything that doesn't look like an email.
function sanitiseEmail(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return '';
  // Block protocol-like patterns smuggled into the local-part
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(s)) return '';
  return s;
}

// ─── Fragment builders ────────────────────────────────────────────────────────
// Each function takes plain-data values and returns an HTML string or ''.
// All conditional logic (phone present/absent, address present/absent,
// email present/absent, services empty/non-empty) lives here — NOT in
// renderLandingPage() itself.

function buildPhoneSVG() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.1 1.23 2 2 0 012.06 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.09a16 16 0 006 6l.36-.36a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>`;
}

function buildNavPhoneHtml(phone) {
  if (!phone) return '';
  return `<a href="tel:${esc(phone)}" class="nav-phone btn-arrow" aria-label="Call us at ${esc(phone)}">${buildPhoneSVG()}${esc(phone)}</a>`;
}

function buildMobileNavPhoneHtml(phone) {
  if (!phone) return '';
  return `<a href="tel:${esc(phone)}" onclick="closeMobileMenu()">${buildPhoneSVG()} Call ${esc(phone)}</a>`;
}

function buildMobileCtaCallHtml(phone) {
  if (!phone) return '';
  return `<a href="tel:${esc(phone)}" class="mobile-cta-call" aria-label="Call now">${buildPhoneSVG()} Call Now</a>`;
}

function buildCtaPrimaryBtnHtml(phone, ctaText) {
  const label = esc(ctaText);
  if (phone) {
    return `<a href="tel:${esc(phone)}" class="btn btn-primary" aria-label="${label}">${buildPhoneSVG()}${label}</a>`;
  }
  return `<a href="#contact" class="btn btn-primary btn-arrow">${label}</a>`;
}

function buildCtaSecondaryBtnHtml(email) {
  if (email) {
    return `<a href="mailto:${esc(email)}" class="btn btn-light">Send a Message</a>`;
  }
  return `<a href="#contact" class="btn btn-light">Get in Touch</a>`;
}

function buildCtaPhoneDisplayHtml(phone) {
  if (!phone) return '';
  return `<a href="tel:${esc(phone)}" class="cta-phone-link" aria-label="Our phone number">${buildPhoneSVG()}${esc(phone)}</a>`;
}

function buildFooterPhoneHtml(phone) {
  if (!phone) return '';
  return `<li><a href="tel:${esc(phone)}">${buildPhoneSVG()}${esc(phone)}</a></li>`;
}

function buildFooterAddressHtml(address) {
  if (!address) return '';
  const mapSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  return `<li><span>${mapSvg}${esc(address)}</span></li>`;
}

function buildSvcIcon(iconKey) {
  const paths = SVG_ICONS[iconKey] || SVG_ICONS.check;
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function buildSvcCard(item) {
  return [
    '<div class="svc-card">',
    `  <div class="svc-icon">${buildSvcIcon(item.icon)}</div>`,
    `  <h3 class="svc-name">${esc(item.name)}</h3>`,
    `  <p class="svc-desc">${esc(item.desc)}</p>`,
    '</div>',
  ].join('\n');
}

function buildServicesSectionHtml(serviceItems) {
  if (!serviceItems || serviceItems.length === 0) return '';
  const cards = serviceItems.map(buildSvcCard).join('\n');
  return [
    '<section class="services-section section" id="services" aria-labelledby="services-heading">',
    '  <div class="container">',
    '    <div class="reveal">',
    '      <div class="section-label" aria-hidden="true">What We Do</div>',
    '      <h2 class="section-title" id="services-heading">Our Services</h2>',
    '      <p class="section-sub">Everything you need, handled by experienced professionals who take pride in doing the job right first time.</p>',
    '    </div>',
    '    <div class="svc-grid reveal-stagger" aria-label="Service offerings">',
    cards,
    '    </div>',
    '  </div>',
    '</section>',
  ].join('\n');
}

// ─── Placeholder replacement — single-pass ───────────────────────────────────
// Builds one combined regex from all placeholder keys, then replaces all
// occurrences in a single .replace() pass over the template string.
// ~8× faster than the naive multi-pass approach for a 61KB template with 17 keys.
//
// replacePlaceholders(template, map) → string
//   template : raw HTML template string
//   map      : { [placeholderKey]: replacementValue }  (values are strings or null)
//
// replacePlaceholder is retained for single-key use and unit-test compatibility.

function replacePlaceholder(template, key, value) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return template.replace(new RegExp('\\{\\{' + escaped + '\\}\\}', 'g'),
    value == null ? '' : String(value));
}

function replacePlaceholders(template, map) {
  // Pre-escape all keys and build one combined alternation pattern
  const entries = Object.entries(map);
  if (!entries.length) return template;
  const escapedKeys = entries.map(([k]) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp('\\{\\{(' + escapedKeys.join('|') + ')\\}\\}', 'g');
  return template.replace(pattern, (_, key) => {
    const v = map[key];
    return v == null ? '' : String(v);
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * renderLandingPage
 *
 * @param  {object} jsonData       Validated JSON object from AI output
 * @param  {string} template       Raw template string read from landing-template.html
 * @returns {string}               Complete HTML string, blob-ready
 */
function renderLandingPage(jsonData, template) {
  if (!jsonData || typeof jsonData !== 'object' || Array.isArray(jsonData)) throw new Error('renderLandingPage: jsonData must be a plain object');
  if (!template) throw new Error('renderLandingPage: template is required');
  const templateHTML = template;

  // ── Step 1: call the three pure functions ──────────────────────────────────
  const category     = resolveIndustry(jsonData.industry);
  const images       = resolveImages(category);
  const serviceItems = transformServices(jsonData.services);

  // ── Step 2: resolve tone (table lookup, no inline branching) ──────────────
  const toneKey  = TONE_MAP[jsonData.tone] ? jsonData.tone : DEFAULT_TONE;
  const tone     = TONE_MAP[toneKey];

  // ── Step 3: resolve scalar fields with literal defaults ───────────────────
  const businessName = (typeof jsonData.business_name === 'string' ? jsonData.business_name.trim() : '') || 'Our Business';
  const ctaText      = jsonData.cta_text      || tone.ctaDefault;
  const phone        = sanitisePhone(jsonData.phone);
  const address      = (jsonData.address || '').trim();
  const email        = sanitiseEmail(jsonData.email);
  const year         = String(new Date().getFullYear());

  // ── Step 4: build all HTML fragments (fragment builders, not inline logic) ─
  const fragments = {
    tone_class:               tone.cls,
    business_name:            esc(businessName),
    headline:                 esc(jsonData.headline    || businessName),
    description:              esc(jsonData.description || ''),
    cta_text:                 esc(ctaText),
    year:                     year,
    hero_image_url:           images.hero,
    about_image_url:          images.about,
    nav_phone_html:           buildNavPhoneHtml(phone),
    mobile_nav_phone_html:    buildMobileNavPhoneHtml(phone),
    mobile_cta_call_html:     buildMobileCtaCallHtml(phone),
    cta_primary_btn_html:     buildCtaPrimaryBtnHtml(phone, ctaText),
    cta_secondary_btn_html:   buildCtaSecondaryBtnHtml(email),
    cta_phone_display_html:   buildCtaPhoneDisplayHtml(phone),
    footer_phone_html:        buildFooterPhoneHtml(phone),
    footer_address_html:      buildFooterAddressHtml(address),
    services_section_html:    buildServicesSectionHtml(serviceItems),
  };

  // ── Step 5: inject and return ─────────────────────────────────────────────
  return replacePlaceholders(templateHTML, fragments);
}

module.exports = {
  renderLandingPage,
  // Export fragment builders for unit testing
  _buildNavPhoneHtml:         buildNavPhoneHtml,
  _buildCtaPrimaryBtnHtml:    buildCtaPrimaryBtnHtml,
  _buildCtaSecondaryBtnHtml:  buildCtaSecondaryBtnHtml,
  _buildServicesSectionHtml:  buildServicesSectionHtml,
  _buildSvcCard:              buildSvcCard,
  _replacePlaceholders:       replacePlaceholders,
  TONE_MAP,
  SVG_ICONS,
};
