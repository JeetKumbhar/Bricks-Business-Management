import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronDown, LogOut, Settings } from "lucide-react";
import wordmark from "../assets/aayush-wordmark.png";
import { Dropdown, SearchInput, useToast } from "../components/ui";
import { initialsOf, roleLabel } from "../features/auth/authState";
import useAuth from "../features/auth/useAuth";

// TODO (dashboard/notifications phase): replace with real unread count.
const unreadNotifications = 3;

/**
 * Mobile: navy bar with logo.  Desktop (lg+): white bar with search.
 */
export default function Header() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, logout } = useAuth();
  const [query, setQuery] = useState(""); // global search is wired up in a later phase

  // On success the signed-in user is cleared and the protected routes send the owner to /login.
  const handleLogout = async () => {
    const result = await logout();
    if (!result.ok) toast.error(result.message);
  };

  const displayName = user?.name ?? "";

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 bg-secondary px-4 text-white sm:px-6 lg:border-b lg:border-border lg:bg-surface lg:px-8 lg:text-fg">
      {/* Brand (mobile only - the sidebar shows it on desktop) */}
      <div className="rounded-lg bg-white px-2 py-1 lg:hidden">
        <img src={wordmark} alt="Aayush Carting" className="block h-9 w-auto" />
      </div>

      {/* Search (desktop only) */}
      <div className="hidden max-w-md flex-1 lg:block">
        <SearchInput value={query} onChange={setQuery} placeholder="Search labour, truck, or anything..." />
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          aria-label={`Notifications, ${unreadNotifications} unread`}
          className="relative rounded-lg p-2 hover:bg-white/10 lg:hover:bg-background"
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unreadNotifications > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
              {unreadNotifications}
            </span>
          )}
        </button>

        <Dropdown
          ariaLabel="Open user menu"
          triggerClassName="text-white hover:bg-white/10 hover:text-white lg:text-fg lg:hover:bg-background lg:hover:text-fg"
          trigger={
            <span className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
                {initialsOf(displayName)}
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-medium">{displayName}</span>
                <span className="block text-xs text-white/70 lg:text-fg-muted">{roleLabel(user?.role)}</span>
              </span>
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </span>
          }
          items={[
            { label: "Settings", icon: Settings, onClick: () => navigate("/settings") },
            { type: "divider" },
            { label: "Log out", icon: LogOut, variant: "danger", onClick: handleLogout },
          ]}
        />
      </div>
    </header>
  );
}
