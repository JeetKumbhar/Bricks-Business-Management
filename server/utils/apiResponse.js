// One response shape for the whole API.
//   success: { success: true,  message, data }
//   error:   { success: false, message, errors? }   (built by error.middleware.js)

// `meta` (for example pagination) is added only when given, so existing responses are unchanged.
export const sendSuccess = (res, { statusCode = 200, message = "Success", data = null, meta } = {}) =>
  res.status(statusCode).json({ success: true, message, data, ...(meta === undefined ? {} : { meta }) });

export const sendCreated = (res, { message = "Created successfully", data = null } = {}) =>
  sendSuccess(res, { statusCode: 201, message, data });

export const errorBody = (message, errors = []) => ({
  success: false,
  message,
  ...(errors.length > 0 ? { errors } : {}),
});
