// One response shape for the whole API.
//   success: { success: true,  message, data }
//   error:   { success: false, message, errors? }   (built by error.middleware.js)

export const sendSuccess = (res, { statusCode = 200, message = "Success", data = null } = {}) =>
  res.status(statusCode).json({ success: true, message, data });

export const sendCreated = (res, { message = "Created successfully", data = null } = {}) =>
  sendSuccess(res, { statusCode: 201, message, data });

export const errorBody = (message, errors = []) => ({
  success: false,
  message,
  ...(errors.length > 0 ? { errors } : {}),
});
