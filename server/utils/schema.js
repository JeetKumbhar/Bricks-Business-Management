// Shared Mongoose building blocks so every model follows the same conventions (docs/DATABASE_CONVENTIONS.md).
// These are helpers only; the business models are added in their own phases.
import mongoose from "mongoose";
import { isValidBusinessDate } from "./dates.js";
import { isPaise } from "./money.js";

/** Business date: a "YYYY-MM-DD" string (see utils/dates.js). */
export const businessDateField = (options = {}) => ({
  type: String,
  validate: { validator: isValidBusinessDate, message: (props) => `${props.path} must be a valid date in YYYY-MM-DD form` },
  ...options,
});

/** Money: an integer number of paise (see utils/money.js). Zero or more unless `min` is overridden. */
export const moneyField = (options = {}) => ({
  type: Number,
  min: [0, "{PATH} cannot be negative"],
  validate: { validator: isPaise, message: (props) => `${props.path} must be a whole number of paise` },
  ...options,
});

/** Soft delete: records are never removed; they are flagged with who, when and why. */
export const softDeleteFields = () => ({
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: String, default: null },
  deletedReason: { type: String, trim: true, default: null },
});

const toJSON = {
  virtuals: false,
  versionKey: false,
  transform: (_doc, ret) => {
    if (ret._id !== undefined && ret.id === undefined) ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
};

/**
 * Options every schema uses:
 *  - timestamps: createdAt / updatedAt are set by Mongoose as UTC instants
 *  - strict: unknown fields are dropped, never stored
 *  - no __v: edits use explicit rules, not the version counter
 */
export const baseSchemaOptions = Object.freeze({
  timestamps: true,
  strict: true,
  versionKey: false,
  toJSON,
  toObject: toJSON,
});

export const createSchema = (definition, options = {}) => new mongoose.Schema(definition, { ...baseSchemaOptions, ...options });
