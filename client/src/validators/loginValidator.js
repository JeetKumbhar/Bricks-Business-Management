// Sign-in form check. Mirrors server/validators/auth.validators.js (valid email, password required, at most 128 characters),
// so obvious mistakes are caught before a request is made. The server stays the authority: it re-checks everything.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns { email?: message, password?: message }; an empty object means the values are acceptable. */
export function validateLogin(values = {}) {
  const errors = {};
  const email = String(values.email ?? "").trim();
  const password = String(values.password ?? "");

  if (!email) errors.email = "Email is required";
  else if (email.length > 254 || !EMAIL.test(email)) errors.email = "Enter a valid email address";

  if (!password) errors.password = "Password is required";
  else if (password.length > 128) errors.password = "Password is too long";

  return errors;
}

/** react-hook-form resolver built on validateLogin. */
export const loginResolver = async (values) => {
  const errors = validateLogin(values);
  const keys = Object.keys(errors);
  if (keys.length === 0) return { values: { email: String(values.email).trim(), password: values.password }, errors: {} };
  return { values: {}, errors: Object.fromEntries(keys.map((key) => [key, { type: "validate", message: errors[key] }])) };
};
