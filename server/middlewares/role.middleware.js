import ApiError from "../utils/ApiError.js";

// Use after requireAuth: router.post("/rates", requireAuth, requireRole(ROLES.OWNER), handler).
export const requireRole =
  (...allowed) =>
  (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowed.includes(req.user.role)) return next(ApiError.forbidden());
    return next();
  };

export default requireRole;
