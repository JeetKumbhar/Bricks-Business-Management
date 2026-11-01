// Authentication logic: password hashing, password policy, login tokens and credential checks.
// Nothing here logs or returns a password or a hash.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { ROLES } from "../constants/roles.js";
import User from "../models/User.js";

export const PASSWORD_MIN_LENGTH = 12;
// bcrypt only looks at the first 72 bytes. A longer password would silently ignore its tail, so it is refused instead.
export const PASSWORD_MAX_BYTES = 72;
const TOKEN_ISSUER = "brickpro";
const TOKEN_ALGORITHM = "HS256";

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

/** Returns a list of problems (empty = acceptable). Length is what matters; no arbitrary symbol rules. */
export const checkPasswordPolicy = (password, { email = "" } = {}) => {
  const problems = [];
  if (typeof password !== "string") return ["Password is required"];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) problems.push(`Password must be at most ${PASSWORD_MAX_BYTES} bytes (about ${PASSWORD_MAX_BYTES} characters)`);
  if (password.trim().length === 0) problems.push("Password cannot be only spaces");
  if (email && password.toLowerCase() === String(email).toLowerCase()) problems.push("Password cannot be the same as the email address");
  return problems;
};

export const hashPassword = (password) => bcrypt.hash(password, env.bcryptRounds);

export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

// A real hash of a random value, computed once at start-up. A login for an email that does not exist is compared against it,
// so "no such account" costs the same time as "wrong password" and the response time does not reveal which one it was.
const dummyHash = hashPassword(crypto.randomBytes(24).toString("hex"));

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const toPublicUser = (user) => ({
  id: String(user._id ?? user.id),
  name: user.name,
  email: user.email,
  role: user.role,
});

/**
 * Checks an email and password. Returns the account record WITHOUT its password hash, or null for ANY failure (no such
 * account, wrong password, disabled account), so the caller cannot tell the difference and neither can an attacker.
 */
export const authenticate = async (email, password) => {
  const user = await User.findOne({ email }).select("+passwordHash").lean();
  const tooLong = Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES; // can never match a stored password
  const hash = user && !tooLong ? user.passwordHash : await dummyHash;

  const matches = await verifyPassword(password, hash);
  if (!user || tooLong || !matches || !user.isActive) return null;

  // Not worth failing a correct login over; the timestamp is informational.
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }).catch(() => {});
  const { passwordHash: _omit, ...safe } = user;
  return safe;
};

/** Creates an account. Throws an Error with `code: "EMAIL_TAKEN"` if the email is already used, `"WEAK_PASSWORD"` for a bad password. */
export const createUser = async ({ name, email, password, role = ROLES.OWNER }) => {
  const problems = checkPasswordPolicy(password, { email });
  if (problems.length > 0) throw Object.assign(new Error(problems.join(". ")), { code: "WEAK_PASSWORD", problems });

  try {
    const user = await User.create({ name, email, role, passwordHash: await hashPassword(password) });
    return toPublicUser(user);
  } catch (err) {
    if (err?.code === 11000) throw Object.assign(new Error("An account with this email already exists"), { code: "EMAIL_TAKEN" });
    throw err;
  }
};

/** Sets a new password and signs the account out everywhere (existing tokens stop working). Returns false if there is no such account. */
export const resetPassword = async (email, password) => {
  const problems = checkPasswordPolicy(password, { email });
  if (problems.length > 0) throw Object.assign(new Error(problems.join(". ")), { code: "WEAK_PASSWORD", problems });

  const result = await User.updateOne(
    { email },
    { $set: { passwordHash: await hashPassword(password) }, $inc: { tokenVersion: 1 } }
  );
  return result.matchedCount > 0;
};

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Signs a login token. It holds only the account id and token version: no role, no email, no password. */
export const signAccessToken = (user) =>
  jwt.sign({ ver: user.tokenVersion ?? 0 }, env.jwtSecret, {
    algorithm: TOKEN_ALGORITHM,
    subject: String(user._id ?? user.id),
    issuer: TOKEN_ISSUER,
    expiresIn: env.jwtExpiresIn,
  });

/** Returns the token's payload, or null if it is missing, malformed, tampered with, expired or signed with another algorithm. */
export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, env.jwtSecret, { algorithms: [TOKEN_ALGORITHM], issuer: TOKEN_ISSUER });
  } catch {
    return null;
  }
};

/** When the token expires, as a Date (for the cookie lifetime). */
export const tokenExpiry = (token) => {
  const exp = jwt.decode(token)?.exp;
  return exp ? new Date(exp * 1000) : null;
};

/**
 * The account a verified token belongs to, or null. The account is read from the database on every request, so a disabled
 * account or a bumped tokenVersion takes effect immediately and the role is never taken from the token itself.
 */
export const findUserForToken = async (payload) => {
  if (!payload?.sub || !mongoose.isValidObjectId(payload.sub)) return null;
  const user = await User.findById(payload.sub).lean();
  if (!user || !user.isActive || (user.tokenVersion ?? 0) !== payload.ver) return null;
  return user;
};
