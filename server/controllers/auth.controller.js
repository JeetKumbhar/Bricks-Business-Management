import { authenticate, signAccessToken, toPublicUser } from "../services/auth.service.js";
import ApiError from "../utils/ApiError.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { clearAuthCookie, setAuthCookie } from "../utils/authCookie.js";

// One message for every failed login. It never says which part was wrong or whether the account exists.
const INVALID_CREDENTIALS = "Invalid email or password";

export const login = async (req, res) => {
  const { email, password } = req.body;

  const user = await authenticate(email, password);
  if (!user) throw new ApiError(401, INVALID_CREDENTIALS);

  setAuthCookie(res, signAccessToken(user));

  return sendSuccess(res, { message: "Logged in successfully", data: { user: toPublicUser(user) } });
};

// Safe to call at any time, signed in or not.
export const logout = (_req, res) => {
  clearAuthCookie(res);
  return sendSuccess(res, { message: "Logged out successfully" });
};

export const me = (req, res) => sendSuccess(res, { message: "Current user fetched successfully", data: { user: req.user } });
