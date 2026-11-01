import mongoose from "mongoose";
import { ROLES, ROLE_VALUES } from "../constants/roles.js";
import { baseSchemaOptions, createSchema } from "../utils/schema.js";

// An account that can sign in. The password is NEVER stored: only a bcrypt hash, and that hash is excluded from every
// query unless it is asked for explicitly (select: false), so it cannot leak into a response by accident.
const userSchema = createSchema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 254,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "email must be a valid address"],
  },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ROLE_VALUES, default: ROLES.OWNER, required: true },
  isActive: { type: Boolean, default: true },
  // Bumping this signs the user out everywhere: every token carries the version it was issued under.
  tokenVersion: { type: Number, default: 0 },
  lastLoginAt: { type: Date, default: null },
});

// One account per email address, enforced by the database and not only by code.
userSchema.index({ email: 1 }, { unique: true });

// Never serialise the hash, even if it was selected.
const withoutHash = (doc, ret) => {
  baseSchemaOptions.toJSON.transform(doc, ret);
  delete ret.passwordHash;
  return ret;
};
userSchema.set("toJSON", { ...baseSchemaOptions.toJSON, transform: withoutHash });
userSchema.set("toObject", { ...baseSchemaOptions.toObject, transform: withoutHash });

export default mongoose.models.User || mongoose.model("User", userSchema);
