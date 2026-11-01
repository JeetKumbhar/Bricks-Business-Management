import ApiError from "../utils/ApiError.js";

// Validates req.body (or req.query / req.params) with a Zod schema. On success the parsed, cleaned value replaces the
// original, so handlers only ever see validated data. On failure it answers 400 with one entry per problem.
// Values are never echoed back (a password must not appear in an error).
export const validate =
  (schema, source = "body") =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (result.success) {
      req[source] = result.data;
      return next();
    }
    const errors = result.error.issues.map((issue) => ({
      field: issue.path.join(".") || source,
      message: issue.code === "unrecognized_keys" ? "Unexpected field" : issue.message,
    }));
    return next(ApiError.badRequest("Validation failed", errors));
  };

export default validate;
