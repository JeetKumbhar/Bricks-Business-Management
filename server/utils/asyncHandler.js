// Wraps an async route handler so a rejected promise reaches the error middleware (Express 4 does not do this itself).
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export default asyncHandler;
