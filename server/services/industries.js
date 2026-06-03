'use strict';

/**
 * src/data/industries.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised industry registry.
 *
 * EXPORTS
 *   INDUSTRIES              — canonical array of all industry records
 *   getIndustryById(id)     — exact lookup by id string
 *   getIndustriesByCategory(category) — all records in a category
 *   getIndustryTemplate(id) — returns template string for an id
 *   searchIndustries(query) — ranked partial / case-insensitive search
 *
 * RECORD SHAPE
 *   {
 *     id:       string   — unique slug, lowercase, hyphen-separated
 *     label:    string   — human-readable display name
 *     category: string   — one of the 19 canonical categories below
 *     template: string   — "professional" | "vibrant" | "dark"
 *   }
 *
 * TEMPLATE STRATEGY
 *   professional — trust-critical services (law, finance, medical, trades)
 *   vibrant      — visual / consumer-facing / community businesses
 *   dark         — premium, luxury, automotive, tech, security, nightlife
 *
 * INTENTIONAL NON-MODIFICATION CONTRACT
 *   This file is additive only. It does NOT modify:
 *     - renderLandingPage()
 *     - resolveIndustry()
 *     - resolveImages()
 *     - Any API endpoint or route
 *     - Any prompt template
 *     - Discovery behaviour
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Canonical category constants ────────────────────────────────────────────
// Defined once here; every INDUSTRIES entry must use one of these exactly.

const CATEGORIES = Object.freeze({
  HOME_SERVICES:       'Home Services',
  BEAUTY_WELLNESS:     'Beauty & Wellness',
  HEALTHCARE:          'Healthcare',
  FOOD_BEVERAGE:       'Food & Beverage',
  AUTOMOTIVE:          'Automotive',
  PROFESSIONAL:        'Professional Services',
  REAL_ESTATE:         'Real Estate',
  TECHNOLOGY:          'Technology',
  EDUCATION:           'Education',
  FITNESS:             'Fitness',
  RETAIL:              'Retail',
  HOSPITALITY:         'Hospitality',
  CONSTRUCTION:        'Construction',
  FINANCE:             'Finance',
  CREATIVE:            'Creative Services',
  EVENTS:              'Events',
  MANUFACTURING:       'Manufacturing',
  LOGISTICS:           'Logistics',
  PET_SERVICES:        'Pet Services',
});

const C = CATEGORIES; // shorthand used in the array below

// ─── Template constants ───────────────────────────────────────────────────────
const T = Object.freeze({
  PRO:     'professional',
  VIBRANT: 'vibrant',
  DARK:    'dark',
});

// ─────────────────────────────────────────────────────────────────────────────
// INDUSTRIES — 155 entries
// Sorted within each category alphabetically by label.
// ─────────────────────────────────────────────────────────────────────────────

const _INDUSTRIES_RAW = [

  // ── Home Services (14) ───────────────────────────────────────────────────
  { id: 'appliance-repair',     label: 'Appliance Repair',        category: C.HOME_SERVICES,   template: T.PRO     },
  { id: 'carpet-cleaning',      label: 'Carpet Cleaning',         category: C.HOME_SERVICES,   template: T.PRO     },
  { id: 'domestic-cleaning',    label: 'Domestic Cleaning',       category: C.HOME_SERVICES,   template: T.PRO     },
  { id: 'electrician',          label: 'Electrician',             category: C.HOME_SERVICES,   template: T.PRO     },
  { id: 'garage-door-repair',   label: 'Garage Door Repair',      category: C.HOME_SERVICES,   template: T.PRO     },
  { id: 'handyman',             label: 'Handyman Services',        category: C.HOME_SERVICES,   template: T.PRO     },
  { id: 'hvac',                 label: 'HVAC & Air Conditioning',  category: C.HOME_SERVICES,   template: T.PRO     },
  { id: 'locksmith',            label: 'Locksmith',               category: C.HOME_SERVICES,   template: T.PRO     },
  { id: 'mold-remediation',     label: 'Mold Remediation',        category: C.HOME_SERVICES,   template: T.PRO     },
  { id: 'pest-control',         label: 'Pest Control',            category: C.HOME_SERVICES,   template: T.PRO     },
  { id: 'plumber',              label: 'Plumber',                 category: C.HOME_SERVICES,   template: T.PRO     },
  { id: 'pool-service',         label: 'Pool Service & Repair',   category: C.HOME_SERVICES,   template: T.PRO     },
  { id: 'security-systems',     label: 'Security Systems',        category: C.HOME_SERVICES,   template: T.DARK    },
  { id: 'window-cleaning',      label: 'Window Cleaning',         category: C.HOME_SERVICES,   template: T.PRO     },

  // ── Beauty & Wellness (12) ───────────────────────────────────────────────
  { id: 'aesthetics-clinic',    label: 'Aesthetics Clinic',       category: C.BEAUTY_WELLNESS, template: T.VIBRANT },
  { id: 'barbershop',           label: 'Barbershop',              category: C.BEAUTY_WELLNESS, template: T.VIBRANT },
  { id: 'beauty-salon',         label: 'Beauty Salon',            category: C.BEAUTY_WELLNESS, template: T.VIBRANT },
  { id: 'brow-lash-studio',     label: 'Brow & Lash Studio',      category: C.BEAUTY_WELLNESS, template: T.VIBRANT },
  { id: 'hair-salon',           label: 'Hair Salon',              category: C.BEAUTY_WELLNESS, template: T.VIBRANT },
  { id: 'massage-therapy',      label: 'Massage Therapy',         category: C.BEAUTY_WELLNESS, template: T.VIBRANT },
  { id: 'med-spa',              label: 'Medical Spa',             category: C.BEAUTY_WELLNESS, template: T.DARK    },
  { id: 'nail-salon',           label: 'Nail Salon',              category: C.BEAUTY_WELLNESS, template: T.VIBRANT },
  { id: 'permanent-makeup',     label: 'Permanent Makeup',        category: C.BEAUTY_WELLNESS, template: T.VIBRANT },
  { id: 'skin-care-clinic',     label: 'Skin Care Clinic',        category: C.BEAUTY_WELLNESS, template: T.VIBRANT },
  { id: 'spa',                  label: 'Spa & Wellness Centre',   category: C.BEAUTY_WELLNESS, template: T.DARK    },
  { id: 'tattoo-studio',        label: 'Tattoo Studio',           category: C.BEAUTY_WELLNESS, template: T.DARK    },

  // ── Healthcare (12) ─────────────────────────────────────────────────────
  { id: 'audiologist',          label: 'Audiologist',             category: C.HEALTHCARE,      template: T.PRO     },
  { id: 'chiropractor',         label: 'Chiropractor',            category: C.HEALTHCARE,      template: T.PRO     },
  { id: 'dental-clinic',         label: 'Dental Clinic',           category: C.HEALTHCARE,      template: T.PRO     },
  { id: 'dentist',              label: 'Dentist',                 category: C.HEALTHCARE,      template: T.PRO     },
  { id: 'gp-surgery',           label: 'GP Surgery',              category: C.HEALTHCARE,      template: T.PRO     },
  { id: 'mental-health',        label: 'Mental Health Therapy',   category: C.HEALTHCARE,      template: T.PRO     },
  { id: 'occupational-therapy', label: 'Occupational Therapy',    category: C.HEALTHCARE,      template: T.PRO     },
  { id: 'optician',             label: 'Optician',                category: C.HEALTHCARE,      template: T.PRO     },
  { id: 'orthodontist',         label: 'Orthodontist',            category: C.HEALTHCARE,      template: T.PRO     },
  { id: 'osteopath',            label: 'Osteopath',               category: C.HEALTHCARE,      template: T.PRO     },
  { id: 'pharmacy',             label: 'Pharmacy',                category: C.HEALTHCARE,      template: T.PRO     },
  { id: 'physiotherapy',        label: 'Physiotherapy',           category: C.HEALTHCARE,      template: T.PRO     },
  { id: 'podiatrist',           label: 'Podiatrist',              category: C.HEALTHCARE,      template: T.PRO     },

  // ── Food & Beverage (12) ─────────────────────────────────────────────────
  { id: 'bakery',               label: 'Bakery',                  category: C.FOOD_BEVERAGE,   template: T.VIBRANT },
  { id: 'bar-pub',              label: 'Bar & Pub',               category: C.FOOD_BEVERAGE,   template: T.DARK    },
  { id: 'bubble-tea',           label: 'Bubble Tea Shop',         category: C.FOOD_BEVERAGE,   template: T.VIBRANT },
  { id: 'butcher',              label: 'Butcher',                 category: C.FOOD_BEVERAGE,   template: T.PRO     },
  { id: 'cafe',                 label: 'Café',                    category: C.FOOD_BEVERAGE,   template: T.VIBRANT },
  { id: 'catering',             label: 'Catering Company',        category: C.FOOD_BEVERAGE,   template: T.PRO     },
  { id: 'cocktail-bar',         label: 'Cocktail Bar',            category: C.FOOD_BEVERAGE,   template: T.DARK    },
  { id: 'deli',                 label: 'Deli & Sandwich Shop',    category: C.FOOD_BEVERAGE,   template: T.VIBRANT },
  { id: 'food-truck',           label: 'Food Truck',              category: C.FOOD_BEVERAGE,   template: T.VIBRANT },
  { id: 'juice-bar',            label: 'Juice Bar',               category: C.FOOD_BEVERAGE,   template: T.VIBRANT },
  { id: 'italian-restaurant',    label: 'Italian Restaurant',      category: C.FOOD_BEVERAGE,   template: T.VIBRANT },
  { id: 'restaurant',           label: 'Restaurant',              category: C.FOOD_BEVERAGE,   template: T.VIBRANT },
  { id: 'wine-bar',             label: 'Wine Bar',                category: C.FOOD_BEVERAGE,   template: T.DARK    },

  // ── Automotive (9) ──────────────────────────────────────────────────────
  { id: 'auto-body-repair',     label: 'Auto Body Repair',        category: C.AUTOMOTIVE,      template: T.DARK    },
  { id: 'auto-detailing',       label: 'Auto Detailing',          category: C.AUTOMOTIVE,      template: T.DARK    },
  { id: 'car-dealership',       label: 'Car Dealership',          category: C.AUTOMOTIVE,      template: T.DARK    },
  { id: 'car-wash',             label: 'Car Wash',                category: C.AUTOMOTIVE,      template: T.DARK    },
  { id: 'ev-charging',          label: 'EV Charging Services',    category: C.AUTOMOTIVE,      template: T.DARK    },
  { id: 'mechanic',             label: 'Car Mechanic',            category: C.AUTOMOTIVE,      template: T.DARK    },
  { id: 'motorcycle-repair',    label: 'Motorcycle Repair',       category: C.AUTOMOTIVE,      template: T.DARK    },
  { id: 'tyre-fitting',         label: 'Tyre Fitting',            category: C.AUTOMOTIVE,      template: T.DARK    },
  { id: 'windscreen-repair',    label: 'Windscreen Repair',       category: C.AUTOMOTIVE,      template: T.PRO     },

  // ── Professional Services (13) ───────────────────────────────────────────
  { id: 'accountant',           label: 'Accountant',              category: C.PROFESSIONAL,    template: T.PRO     },
  { id: 'bookkeeper',           label: 'Bookkeeper',              category: C.PROFESSIONAL,    template: T.PRO     },
  { id: 'business-consultant',  label: 'Business Consultant',     category: C.PROFESSIONAL,    template: T.PRO     },
  { id: 'hr-consultant',        label: 'HR Consultant',           category: C.PROFESSIONAL,    template: T.PRO     },
  { id: 'immigration-lawyer',   label: 'Immigration Lawyer',      category: C.PROFESSIONAL,    template: T.PRO     },
  { id: 'insurance-broker',     label: 'Insurance Broker',        category: C.PROFESSIONAL,    template: T.PRO     },
  { id: 'life-coach',           label: 'Life Coach',              category: C.PROFESSIONAL,    template: T.PRO     },
  { id: 'management-consultant',label: 'Management Consultant',   category: C.PROFESSIONAL,    template: T.PRO     },
  { id: 'notary',               label: 'Notary Public',           category: C.PROFESSIONAL,    template: T.PRO     },
  { id: 'pr-agency',            label: 'PR Agency',               category: C.PROFESSIONAL,    template: T.DARK    },
  { id: 'recruitment-agency',   label: 'Recruitment Agency',      category: C.PROFESSIONAL,    template: T.PRO     },
  { id: 'solicitor',            label: 'Solicitor / Law Firm',    category: C.PROFESSIONAL,    template: T.PRO     },
  { id: 'tax-advisor',          label: 'Tax Advisor',             category: C.PROFESSIONAL,    template: T.PRO     },

  // ── Real Estate (7) ──────────────────────────────────────────────────────
  { id: 'commercial-property',  label: 'Commercial Property',     category: C.REAL_ESTATE,     template: T.DARK    },
  { id: 'estate-agent',         label: 'Estate Agent',            category: C.REAL_ESTATE,     template: T.PRO     },
  { id: 'home-staging',         label: 'Home Staging',            category: C.REAL_ESTATE,     template: T.VIBRANT },
  { id: 'letting-agent',        label: 'Letting Agent',           category: C.REAL_ESTATE,     template: T.PRO     },
  { id: 'mortgage-broker',      label: 'Mortgage Broker',         category: C.REAL_ESTATE,     template: T.PRO     },
  { id: 'property-developer',   label: 'Property Developer',      category: C.REAL_ESTATE,     template: T.DARK    },
  { id: 'property-manager',     label: 'Property Manager',        category: C.REAL_ESTATE,     template: T.PRO     },

  // ── Technology (10) ──────────────────────────────────────────────────────
  { id: 'app-development',      label: 'App Development',         category: C.TECHNOLOGY,      template: T.DARK    },
  { id: 'cyber-security',       label: 'Cyber Security',          category: C.TECHNOLOGY,      template: T.DARK    },
  { id: 'data-analytics',       label: 'Data Analytics',          category: C.TECHNOLOGY,      template: T.DARK    },
  { id: 'it-support',           label: 'IT Support',              category: C.TECHNOLOGY,      template: T.DARK    },
  { id: 'managed-it',           label: 'Managed IT Services',     category: C.TECHNOLOGY,      template: T.DARK    },
  { id: 'saas-company',         label: 'SaaS Company',            category: C.TECHNOLOGY,      template: T.DARK    },
  { id: 'seo-agency',           label: 'SEO Agency',              category: C.TECHNOLOGY,      template: T.DARK    },
  { id: 'web-design',           label: 'Web Design Agency',       category: C.TECHNOLOGY,      template: T.DARK    },
  { id: 'web-hosting',          label: 'Web Hosting',             category: C.TECHNOLOGY,      template: T.DARK    },
  { id: 'software-dev',         label: 'Software Development',    category: C.TECHNOLOGY,      template: T.DARK    },

  // ── Education (8) ────────────────────────────────────────────────────────
  { id: 'coding-school',        label: 'Coding School',           category: C.EDUCATION,       template: T.VIBRANT },
  { id: 'driving-school',       label: 'Driving School',          category: C.EDUCATION,       template: T.PRO     },
  { id: 'language-school',      label: 'Language School',         category: C.EDUCATION,       template: T.VIBRANT },
  { id: 'music-school',         label: 'Music School',            category: C.EDUCATION,       template: T.VIBRANT },
  { id: 'private-tutor',        label: 'Private Tutor',           category: C.EDUCATION,       template: T.PRO     },
  { id: 'preschool',            label: 'Preschool / Nursery',     category: C.EDUCATION,       template: T.VIBRANT },
  { id: 'sports-coaching',      label: 'Sports Coaching',         category: C.EDUCATION,       template: T.VIBRANT },
  { id: 'test-prep',            label: 'Test Preparation',        category: C.EDUCATION,       template: T.PRO     },

  // ── Fitness (8) ──────────────────────────────────────────────────────────
  { id: 'boxing-gym',           label: 'Boxing Gym',              category: C.FITNESS,         template: T.DARK    },
  { id: 'crossfit',             label: 'CrossFit Box',            category: C.FITNESS,         template: T.DARK    },
  { id: 'dance-studio',         label: 'Dance Studio',            category: C.FITNESS,         template: T.VIBRANT },
  { id: 'gym',                  label: 'Gym & Fitness Centre',    category: C.FITNESS,         template: T.DARK    },
  { id: 'martial-arts',         label: 'Martial Arts',            category: C.FITNESS,         template: T.DARK    },
  { id: 'personal-trainer',     label: 'Personal Trainer',        category: C.FITNESS,         template: T.VIBRANT },
  { id: 'pilates-studio',       label: 'Pilates Studio',          category: C.FITNESS,         template: T.VIBRANT },
  { id: 'yoga-studio',          label: 'Yoga Studio',             category: C.FITNESS,         template: T.VIBRANT },

  // ── Retail (10) ──────────────────────────────────────────────────────────
  { id: 'bookshop',             label: 'Bookshop',                category: C.RETAIL,          template: T.VIBRANT },
  { id: 'clothing-boutique',    label: 'Clothing Boutique',       category: C.RETAIL,          template: T.VIBRANT },
  { id: 'electronics-store',    label: 'Electronics Store',       category: C.RETAIL,          template: T.DARK    },
  { id: 'florist',              label: 'Florist',                 category: C.RETAIL,          template: T.VIBRANT },
  { id: 'gift-shop',            label: 'Gift Shop',               category: C.RETAIL,          template: T.VIBRANT },
  { id: 'jewellery-store',      label: 'Jewellery Store',         category: C.RETAIL,          template: T.DARK    },
  { id: 'opticians-retail',     label: 'Opticians (Retail)',      category: C.RETAIL,          template: T.PRO     },
  { id: 'pharmacy-retail',      label: 'Pharmacy (Retail)',       category: C.RETAIL,          template: T.PRO     },
  { id: 'sports-shop',          label: 'Sports Shop',             category: C.RETAIL,          template: T.VIBRANT },
  { id: 'toy-store',            label: 'Toy Store',               category: C.RETAIL,          template: T.VIBRANT },

  // ── Hospitality (7) ──────────────────────────────────────────────────────
  { id: 'bed-breakfast',        label: 'Bed & Breakfast',         category: C.HOSPITALITY,     template: T.VIBRANT },
  { id: 'boutique-hotel',       label: 'Boutique Hotel',          category: C.HOSPITALITY,     template: T.DARK    },
  { id: 'glamping',             label: 'Glamping & Eco Retreat',  category: C.HOSPITALITY,     template: T.VIBRANT },
  { id: 'holiday-rentals',      label: 'Holiday Rentals',         category: C.HOSPITALITY,     template: T.VIBRANT },
  { id: 'hostel',               label: 'Hostel',                  category: C.HOSPITALITY,     template: T.VIBRANT },
  { id: 'luxury-hotel',         label: 'Luxury Hotel',            category: C.HOSPITALITY,     template: T.DARK    },
  { id: 'wedding-venue',        label: 'Wedding Venue',           category: C.HOSPITALITY,     template: T.DARK    },

  // ── Construction (9) ─────────────────────────────────────────────────────
  { id: 'architect',            label: 'Architect',               category: C.CONSTRUCTION,    template: T.DARK    },
  { id: 'builder',              label: 'Builder & General Contractor', category: C.CONSTRUCTION, template: T.PRO   },
  { id: 'damp-proofing',        label: 'Damp Proofing',           category: C.CONSTRUCTION,    template: T.PRO     },
  { id: 'flooring',             label: 'Flooring Installation',   category: C.CONSTRUCTION,    template: T.PRO     },
  { id: 'interior-design',      label: 'Interior Design',         category: C.CONSTRUCTION,    template: T.DARK    },
  { id: 'landscaping',          label: 'Landscaping',             category: C.CONSTRUCTION,    template: T.VIBRANT },
  { id: 'painter-decorator',    label: 'Painter & Decorator',     category: C.CONSTRUCTION,    template: T.VIBRANT },
  { id: 'roofer',               label: 'Roofer',                  category: C.CONSTRUCTION,    template: T.PRO     },
  { id: 'scaffolding',          label: 'Scaffolding',             category: C.CONSTRUCTION,    template: T.PRO     },

  // ── Finance (7) ──────────────────────────────────────────────────────────
  { id: 'crypto-advisor',       label: 'Crypto Advisor',          category: C.FINANCE,         template: T.DARK    },
  { id: 'financial-advisor',    label: 'Financial Advisor',       category: C.FINANCE,         template: T.PRO     },
  { id: 'forex-trading',        label: 'Forex Trading',           category: C.FINANCE,         template: T.DARK    },
  { id: 'investment-firm',      label: 'Investment Firm',         category: C.FINANCE,         template: T.DARK    },
  { id: 'payroll-services',     label: 'Payroll Services',        category: C.FINANCE,         template: T.PRO     },
  { id: 'pension-advisor',      label: 'Pension Advisor',         category: C.FINANCE,         template: T.PRO     },
  { id: 'wealth-management',    label: 'Wealth Management',       category: C.FINANCE,         template: T.DARK    },

  // ── Creative Services (9) ────────────────────────────────────────────────
  { id: 'branding-agency',      label: 'Branding Agency',         category: C.CREATIVE,        template: T.DARK    },
  { id: 'content-creator',      label: 'Content Creator',         category: C.CREATIVE,        template: T.VIBRANT },
  { id: 'copywriter',           label: 'Copywriter',              category: C.CREATIVE,        template: T.PRO     },
  { id: 'graphic-design',       label: 'Graphic Design Studio',   category: C.CREATIVE,        template: T.DARK    },
  { id: 'illustrator',          label: 'Illustrator',             category: C.CREATIVE,        template: T.VIBRANT },
  { id: 'photographer',         label: 'Photographer',            category: C.CREATIVE,        template: T.DARK    },
  { id: 'print-studio',         label: 'Print Studio',            category: C.CREATIVE,        template: T.PRO     },
  { id: 'social-media-agency',  label: 'Social Media Agency',     category: C.CREATIVE,        template: T.VIBRANT },
  { id: 'videographer',         label: 'Videographer',            category: C.CREATIVE,        template: T.DARK    },

  // ── Events (6) ───────────────────────────────────────────────────────────
  { id: 'corporate-events',     label: 'Corporate Events',        category: C.EVENTS,          template: T.DARK    },
  { id: 'dj-entertainment',     label: 'DJ & Entertainment',      category: C.EVENTS,          template: T.DARK    },
  { id: 'event-planner',        label: 'Event Planner',           category: C.EVENTS,          template: T.VIBRANT },
  { id: 'party-hire',           label: 'Party Equipment Hire',    category: C.EVENTS,          template: T.VIBRANT },
  { id: 'wedding-planner',      label: 'Wedding Planner',         category: C.EVENTS,          template: T.VIBRANT },
  { id: 'photo-booth',          label: 'Photo Booth Hire',        category: C.EVENTS,          template: T.VIBRANT },

  // ── Manufacturing (5) ────────────────────────────────────────────────────
  { id: 'custom-fabrication',   label: 'Custom Fabrication',      category: C.MANUFACTURING,   template: T.DARK    },
  { id: 'food-manufacturer',    label: 'Food Manufacturer',       category: C.MANUFACTURING,   template: T.PRO     },
  { id: 'furniture-maker',      label: 'Furniture Maker',         category: C.MANUFACTURING,   template: T.DARK    },
  { id: 'print-manufacturing',  label: 'Print Manufacturing',     category: C.MANUFACTURING,   template: T.PRO     },
  { id: 'textile-manufacturer', label: 'Textile Manufacturer',    category: C.MANUFACTURING,   template: T.PRO     },

  // ── Logistics (6) ────────────────────────────────────────────────────────
  { id: 'courier',              label: 'Courier & Delivery',      category: C.LOGISTICS,       template: T.PRO     },
  { id: 'freight',              label: 'Freight & Haulage',       category: C.LOGISTICS,       template: T.PRO     },
  { id: 'man-and-van',          label: 'Man & Van',               category: C.LOGISTICS,       template: T.PRO     },
  { id: 'removal-company',      label: 'Removal Company',         category: C.LOGISTICS,       template: T.PRO     },
  { id: 'storage-facility',     label: 'Storage Facility',        category: C.LOGISTICS,       template: T.PRO     },
  { id: 'taxi-private-hire',    label: 'Taxi & Private Hire',     category: C.LOGISTICS,       template: T.DARK    },

  // ── Pet Services (6) ─────────────────────────────────────────────────────
  { id: 'dog-grooming',         label: 'Dog Grooming',            category: C.PET_SERVICES,    template: T.VIBRANT },
  { id: 'dog-training',         label: 'Dog Training',            category: C.PET_SERVICES,    template: T.VIBRANT },
  { id: 'dog-walking',          label: 'Dog Walking',             category: C.PET_SERVICES,    template: T.VIBRANT },
  { id: 'pet-boarding',         label: 'Pet Boarding',            category: C.PET_SERVICES,    template: T.VIBRANT },
  { id: 'pet-shop',             label: 'Pet Shop',                category: C.PET_SERVICES,    template: T.VIBRANT },
  { id: 'veterinary',           label: 'Veterinary Practice',     category: C.PET_SERVICES,    template: T.PRO     },

];
const INDUSTRIES = Object.freeze(_INDUSTRIES_RAW.map(e => Object.freeze(e)));

// ─── Runtime invariant check (runs once on module load) ──────────────────────
// Catches any misconfigured entry immediately — fails loudly in dev/test,
// does not suppress in production (a bad registry is worse than a loud error).
(function validateRegistry() {
  const VALID_TEMPLATES = new Set([T.PRO, T.VIBRANT, T.DARK]);
  const VALID_CATEGORIES = new Set(Object.values(C));
  const seenIds = new Set();

  INDUSTRIES.forEach((entry, i) => {
    const loc = `INDUSTRIES[${i}] id="${entry.id}"`;
    if (!entry.id || typeof entry.id !== 'string')
      throw new Error(`${loc}: id must be a non-empty string`);
    if (!entry.label || typeof entry.label !== 'string')
      throw new Error(`${loc}: label must be a non-empty string`);
    if (!VALID_CATEGORIES.has(entry.category))
      throw new Error(`${loc}: unknown category "${entry.category}"`);
    if (!VALID_TEMPLATES.has(entry.template))
      throw new Error(`${loc}: unknown template "${entry.template}"`);
    if (seenIds.has(entry.id))
      throw new Error(`${loc}: duplicate id "${entry.id}"`);
    seenIds.add(entry.id);
  });
}());

// ─── Pre-built indices (built once at module load) ────────────────────────────
// Avoids repeated iteration inside hot helper paths.

/** @type {Map<string, object>} */
const _byId = new Map(INDUSTRIES.map(ind => [ind.id, ind]));

/** @type {Map<string, object[]>} */
const _byCategory = new Map();
INDUSTRIES.forEach(ind => {
  if (!_byCategory.has(ind.category)) _byCategory.set(ind.category, []);
  _byCategory.get(ind.category).push(ind);
});

// ─── Helper functions ─────────────────────────────────────────────────────────

/**
 * getIndustryById
 * Exact lookup by id string. O(1).
 *
 * @param  {string} id
 * @returns {object|undefined}  Industry record, or undefined if not found
 *
 * @example
 *   getIndustryById('plumber')
 *   // → { id:'plumber', label:'Plumber', category:'Home Services', template:'professional' }
 */
function getIndustryById(id) {
  if (!id || typeof id !== 'string') return undefined;
  return _byId.get(id);
}

/**
 * getIndustriesByCategory
 * Returns all industries in the given category. O(1) map lookup.
 * Returns [] (not undefined) when the category does not exist.
 *
 * @param  {string} category  Exact category string (use CATEGORIES constants)
 * @returns {object[]}        Array of industry records (may be empty)
 *
 * @example
 *   getIndustriesByCategory('Fitness')
 *   // → [{ id:'boxing-gym', ...}, { id:'crossfit', ...}, ...]
 */
function getIndustriesByCategory(category) {
  if (!category || typeof category !== 'string') return [];
  return _byCategory.get(category) || [];
}

/**
 * getIndustryTemplate
 * Returns the template string for an industry id. O(1).
 * Returns undefined when the id is not found.
 *
 * @param  {string} id
 * @returns {string|undefined}  'professional' | 'vibrant' | 'dark' | undefined
 *
 * @example
 *   getIndustryTemplate('gym')     // → 'dark'
 *   getIndustryTemplate('dentist') // → 'professional'
 *   getIndustryTemplate('unknown') // → undefined
 */
function getIndustryTemplate(id) {
  const industry = getIndustryById(id);
  return industry ? industry.template : undefined;
}

/**
 * searchIndustries
 * Case-insensitive partial-match search across id and label.
 * Results are ranked: exact id match → id starts-with → label starts-with →
 * label word starts-with → id/label contains → remainder.
 *
 * Returns [] for empty/invalid queries (not the full array).
 *
 * @param  {string} query  Search string (any case, any length)
 * @returns {object[]}     Ranked array of matching industry records
 *
 * @example
 *   searchIndustries('plumb')
 *   // → [{ id:'plumber', label:'Plumber', ...}]
 *
 *   searchIndustries('sol')
 *   // → [{ id:'solicitor', label:'Solicitor / Law Firm', ...}]
 *
 *   searchIndustries('gym')
 *   // → [{ id:'gym', ... }, { id:'boxing-gym', ... }]
 */
function searchIndustries(query) {
  if (!query || typeof query !== 'string') return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored = [];

  for (const ind of INDUSTRIES) {
    const id    = ind.id.toLowerCase();
    const label = ind.label.toLowerCase();

    let score = 0;

    if (id === q)                        { score = 100; }
    else if (label.toLowerCase() === q)  { score = 95;  }
    else if (id.startsWith(q))           { score = 80;  }
    else if (label.startsWith(q))        { score = 75;  }
    else if (label.split(/[\s&\/]+/).some(word => word.startsWith(q))) {
                                           score = 60;  }
    else if (id.includes(q))             { score = 40;  }
    else if (label.includes(q))          { score = 35;  }

    if (score > 0) scored.push({ score, ind });
  }

  // Sort descending by score, then alphabetically by label for ties
  scored.sort((a, b) =>
    b.score !== a.score
      ? b.score - a.score
      : a.ind.label.localeCompare(b.ind.label)
  );

  return scored.map(s => s.ind);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  INDUSTRIES,
  CATEGORIES,
  getIndustryById,
  getIndustriesByCategory,
  getIndustryTemplate,
  searchIndustries,
};
