/**
 * middleware/validate.js
 * Lightweight schema-based request validator.
 * No external deps — pure JS rules engine.
 *
 * Usage:
 *   const { validate, rules } = require('../middleware/validate');
 *   router.post('/', validate(createLeadSchema), handler);
 */

// ─────────────────────────────────────────────
//  Primitive rule factories
// ─────────────────────────────────────────────
const rules = {
  /** Field must be present and non-empty string */
  required: (message) => ({
    test: (v) => v !== undefined && v !== null && String(v).trim().length > 0,
    message: message || "This field is required.",
  }),

  /** String max length */
  maxLength: (max, message) => ({
    test: (v) => v === undefined || v === null || String(v).length <= max,
    message: message || `Must be ${max} characters or fewer.`,
  }),

  /** String min length */
  minLength: (min, message) => ({
    test: (v) => v === undefined || v === null || String(v).trim().length >= min,
    message: message || `Must be at least ${min} characters.`,
  }),

  /** Must match an allowed set of values */
  oneOf: (values, message) => ({
    test: (v) => v === undefined || v === null || values.includes(v),
    message: message || `Must be one of: ${values.join(", ")}.`,
  }),

  /** Basic URL format check */
  url: (message) => ({
    test: (v) => {
      if (v === undefined || v === null || String(v).trim() === "") return true;
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    },
    message: message || "Must be a valid URL (include https://).",
  }),

  /** No special characters that could cause injection */
  safe: (message) => ({
    test: (v) => {
      if (v === undefined || v === null) return true;
      return !/[<>;"']/.test(v);
    },
    message: message || "Contains invalid characters.",
  }),
};

// ─────────────────────────────────────────────
//  Schemas
// ─────────────────────────────────────────────

/** POST /api/leads — create lead */
const createLeadSchema = {
  business_name: [
    rules.required("business_name is required."),
    rules.minLength(2, "business_name must be at least 2 characters."),
    rules.maxLength(200),
    rules.safe(),
  ],
  industry: [
    rules.required("industry is required."),
    rules.maxLength(100),
    rules.safe(),
  ],
  location: [
    rules.required("location is required."),
    rules.maxLength(200),
    rules.safe(),
  ],
  website: [
    rules.url(),
    rules.maxLength(500),
  ],
  notes: [
    rules.maxLength(2000, "notes must be 2000 characters or fewer."),
    rules.safe(),
  ],
};

/** PATCH /api/leads/:id — update lead */
const updateLeadSchema = {
  business_name: [rules.minLength(2), rules.maxLength(200), rules.safe()],
  industry:      [rules.maxLength(100), rules.safe()],
  location:      [rules.maxLength(200), rules.safe()],
  website:       [rules.url(), rules.maxLength(500)],
  notes:         [rules.maxLength(2000), rules.safe()],
  status: [
    rules.oneOf(
      ["new", "contacted", "qualified", "converted", "lost"],
      "status must be: new, contacted, qualified, converted, or lost."
    ),
  ],
};

// ─────────────────────────────────────────────
//  Middleware factory
// ─────────────────────────────────────────────
function validate(schema) {
  return (req, res, next) => {
    const errors = {};

    for (const [field, fieldRules] of Object.entries(schema)) {
      const value = req.body[field];

      for (const rule of fieldRules) {
        if (!rule.test(value)) {
          if (!errors[field]) errors[field] = [];
          errors[field].push(rule.message);
          break; // First failing rule per field is enough
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed.",
        errors,
      });
    }

    next();
  };
}

module.exports = { validate, rules, createLeadSchema, updateLeadSchema };
