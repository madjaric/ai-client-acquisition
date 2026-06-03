'use strict';

/**
 * src/data/templateManifest.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Registry of all available landing page templates.
 *
 * EXPORTS
 *   TEMPLATE_MANIFEST  — frozen object keyed by template name
 *   getTemplate(name)  — returns manifest entry or undefined
 *
 * RECORD SHAPE
 *   {
 *     name:        string   — template identifier (matches filename stem)
 *     label:       string   — human-readable display name
 *     description: string   — design intent, one sentence
 *     file:        string   — path relative to project root
 *     toneDefault: string   — which tone value maps naturally to this template
 *     accentColor: string   — primary accent hex (for UI preview chips)
 *     bg:          string   — background character: 'light' | 'dark'
 *     fonts:       string[] — Google Font families used
 *   }
 *
 * CONTRACT
 *   Every template in this manifest MUST accept the same 17-placeholder
 *   rendering contract used by renderLandingPage(). Adding or removing
 *   placeholders from a template file is a breaking change.
 *
 *   The 17 canonical placeholders:
 *     {{tone_class}}          {{business_name}}        {{headline}}
 *     {{description}}         {{cta_text}}             {{year}}
 *     {{hero_image_url}}      {{about_image_url}}
 *     {{nav_phone_html}}      {{mobile_nav_phone_html}} {{mobile_cta_call_html}}
 *     {{cta_primary_btn_html}} {{cta_secondary_btn_html}} {{cta_phone_display_html}}
 *     {{footer_phone_html}}   {{footer_address_html}}
 *     {{services_section_html}}
 *
 * INTENTIONAL NON-MODIFICATION CONTRACT
 *   This file does NOT modify renderLandingPage(), resolveIndustry(),
 *   resolveImages(), transformServices(), any API endpoint, any route,
 *   any prompt, or any discovery behaviour.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '../templates');

const TEMPLATE_MANIFEST = Object.freeze({

  professional: Object.freeze({
    name:        'professional',
    label:       'Professional',
    description: 'Trust-focused, clean white layout with blue accent — ideal for trades, healthcare, and local service businesses.',
    file:        path.join(TEMPLATES_DIR, 'professional.html'),
    toneDefault: 'professional',
    accentColor: '#1d4ed8',
    bg:          'light',
    fonts:       ['Inter', 'DM Serif Display'],
    sections:    Object.freeze(['nav', 'hero', 'trust-strip', 'services', 'why-us', 'testimonials', 'about', 'cta', 'footer']),
  }),

  vibrant: Object.freeze({
    name:        'vibrant',
    label:       'Vibrant',
    description: 'Colorful gradient hero with expressive typography — ideal for restaurants, salons, cafés, and consumer-facing businesses.',
    file:        path.join(TEMPLATES_DIR, 'vibrant.html'),
    toneDefault: 'professional',
    accentColor: '#e11d48',
    bg:          'light',
    fonts:       ['Plus Jakarta Sans', 'Playfair Display'],
    sections:    Object.freeze(['nav', 'hero', 'trust-strip', 'services', 'why-us', 'testimonials', 'about', 'cta', 'footer']),
  }),

  dark: Object.freeze({
    name:        'dark',
    label:       'Dark',
    description: 'Premium dark surfaces with gold accent — ideal for automotive, luxury, technology, and high-end professional services.',
    file:        path.join(TEMPLATES_DIR, 'dark.html'),
    toneDefault: 'premium',
    accentColor: '#c9a84c',
    bg:          'dark',
    fonts:       ['Inter', 'Cormorant Garamond'],
    sections:    Object.freeze(['nav', 'hero', 'trust-strip', 'services', 'why-us', 'testimonials', 'about', 'cta', 'footer']),
  }),

});

/**
 * getTemplate
 * Returns the manifest entry for the given template name.
 * Returns undefined for unknown names — never throws.
 *
 * @param  {string} name  'professional' | 'vibrant' | 'dark'
 * @returns {object|undefined}
 *
 * @example
 *   const t = getTemplate('dark');
 *   t.label      // → 'Dark'
 *   t.file       // → '/abs/path/templates/dark.html'
 *   t.accentColor // → '#c9a84c'
 */
function getTemplate(name) {
  if (!name || typeof name !== 'string') return undefined;
  return TEMPLATE_MANIFEST[name];
}

module.exports = { TEMPLATE_MANIFEST, getTemplate };
