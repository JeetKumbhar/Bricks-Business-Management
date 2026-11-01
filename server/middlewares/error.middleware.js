import { env } from "../config/env.js";
import ApiError from "../utils/ApiError.js";
import { errorBody } from "../utils/apiResponse.js";

// Turns known library errors into ApiErrors. Anything else is an unexpected 500.
const normalize = (err) => {
  if (err instanceof ApiError) return err;
  if (err?.type === "entity.parse.failed") return new ApiError(400, "Request body is not valid JSON");
  if (err?.type === "entity.too.large") return new ApiError(413, "Request body is too large");
  return null;
};

// Express recognises an error handler by its four arguments, so `_next` must stay.
// eslint-disable-next-line no-unused-vars
export default function errorHandler(err, req, res, _next) {
  if (res.headersSent) return res.destroy(err);

  const known = normalize(err);

  if (known) {
    return res.status(known.statusCode).json(errorBody(known.message, known.errors));
  }

  // Unexpected: log the detail on the server, never send it to the client in production.
  if (!env.isTest) console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  const body = errorBody("Something went wrong on the server");
  if (!env.isProduction) body.debug = { name: err?.name, message: err?.message, stack: err?.stack };
  return res.status(500).json(body);
}
