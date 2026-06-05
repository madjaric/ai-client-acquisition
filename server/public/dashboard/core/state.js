/* ═══════════════════════════════════════════════════════════════
   core/state.js — global mutable state + shared constants
   ───────────────────────────────────────────────────────────────
   Holds everything that was previously declared as a top-level
   `let`/`const` in the monolithic dashboard:
     • allLeads, lastScoredId
     • discovery state (discAllResults, discFiltered, …)
     • IWG / WOPP / woGen website-subsystem state
     • shared constants (API_BASE, PAGE_META, IWG_STEPS, …)

   Mutable values are exposed as properties of a single `state`
   object so that any module can reassign them (e.g. state.allLeads =
   …). This preserves the original single-scope behaviour, because
   plain `export let` bindings are read-only for importers.
   ═══════════════════════════════════════════════════════════════ */

export const state = {
  allLeads: [],
  lastScoredId: null,
  discAllResults: [],
  discFiltered: [],
  discImportedIds: new Set(),
  discMsgInterval: null,
  discMsgIdx: 0,
  iwgCurrentBiz: null,
  iwgGeneratedHtml: null,
  iwgEditable: null,
  iwgOriginalHtml: null,
  iwgOrigEditable: null,
  iwgTrueOriginalHtml: null,
  iwgTrueOrigEditable: null,
  iwgDirty: false,
  iwgLoadInterval: null,
  iwgLoadPct: 0,
  iwgWoppContextId: null,
  woppOpps: [],
  woppActiveStage: null,
  woppCurrentId: null,
  woGenCurrentId: null,
  API_BASE: '',
  PAGE_META: {
    leads:     { title: 'Leads',                 sub: 'Manage your prospect pipeline' },
    scoring:   { title: 'AI Scoring',            sub: 'Estimate value and prioritize your pipeline' },
    outreach:  { title: 'Outreach Generator',    sub: 'AI-written emails and DMs, personalised to each lead' },
    email:     { title: 'Send Email',            sub: 'Send via Gmail SMTP with full delivery logging' },
    discovery: { title: 'Lead Discovery',        sub: 'Find local businesses via Google Maps and import to pipeline' },
    wopp:      { title: '⚡ Website Opportunities', sub: 'Generate websites for no-website businesses and close deals' },
  },
  DISC_LOADING_MSGS: ["Querying Google Maps…","Fetching business data…","Analyzing results…","Almost ready…"],
  IWG_SYSTEM: "",
  IWG_STEPS: [
    'Analyzing business data…',
    'Writing professional copy…',
    'Designing color palette…',
    'Building layout & sections…',
    'Generating hero section…',
    'Creating services grid…',
    'Polishing contact section…',
    'Finalizing HTML…',
  ],
  WOPP_STATUS_LABELS: ['Not Generated', 'Generated', 'Sent', 'Won'],
  WOPP_STORAGE_KEY: 'lf_wopp_v1',
};
