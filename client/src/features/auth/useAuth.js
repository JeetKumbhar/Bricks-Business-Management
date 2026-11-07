import { useContext } from "react";
import { AuthContext } from "../../context/AuthContext";

/** const { user, status, login, logout } = useAuth();  Only works inside <AuthProvider>. */
export default function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
