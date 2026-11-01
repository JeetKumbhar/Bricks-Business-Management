import ApiError from "../utils/ApiError.js";

// Runs after every route: anything that reached here matched nothing.
export default function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl.split("?")[0]}`));
}
