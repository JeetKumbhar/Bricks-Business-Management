import { WifiOff } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Button, EmptyState, LoadingState } from "../components/ui";
import { resolveGuard, safeRedirectPath } from "../features/auth/authState";
import useAuth from "../features/auth/useAuth";

// Shown for "loading" and "error" by both guards below.
function SessionCheck({ guard, errorMessage, onRetry }) {
  if (guard === "error") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <EmptyState
          icon={WifiOff}
          title="Cannot reach the server"
          description={errorMessage || "We could not check your session. Your data has not been changed."}
          action={<Button onClick={onRetry}>Try again</Button>}
        />
      </div>
    );
  }
  return <LoadingState fullPage label="Checking your session..." />;
}

/**
 * Wrap every page that needs a login:  <Route element={<ProtectedRoute />}> ...pages... </Route>
 * Signed in -> shows the page. Not signed in -> /login (remembering where the owner was going). While the session is
 * being checked, or when the server cannot be reached, a status screen is shown instead of any page.
 */
export default function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();
  const guard = resolveGuard(auth);

  if (guard === "allow") return <Outlet />;
  if (guard === "redirect") {
    const from = { pathname: location.pathname, search: location.search, hash: location.hash };
    return <Navigate to="/login" replace state={{ from, expired: auth.expired }} />;
  }
  return <SessionCheck guard={guard} errorMessage={auth.errorMessage} onRetry={auth.retry} />;
}

/** For the login page: someone who is already signed in goes straight to the app instead. */
export function PublicOnlyRoute() {
  const auth = useAuth();
  const location = useLocation();
  const guard = resolveGuard(auth);

  if (guard === "allow") return <Navigate to={safeRedirectPath(location.state?.from)} replace />;
  if (guard === "redirect") return <Outlet />;
  return <SessionCheck guard={guard} errorMessage={auth.errorMessage} onRetry={auth.retry} />;
}
