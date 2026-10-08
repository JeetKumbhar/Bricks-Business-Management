import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BrickWall, ChevronDown, LogOut, Settings } from "lucide-react";
import { Dropdown, SearchInput } from "../components/ui";

// TODO (auth phase): replace with the logged-in user from AuthContext.
const currentUser = { name: "Ramesh Patel", role: "Owner" };
// TODO (dashboard/notifications phase): replace with real unread count.
const unreadNotifications = 3;

const initials = (name) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/**
 * Mobile: navy bar with logo.  Desktop (lg+): white bar with search.
 */
export default function Header() {
  const navigate = useNavigate();
  const [query, setQuery] = useState(""); // global search is wired up in a later phase

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 bg-secondary px-4 text-white sm:px-6 lg:border-b lg:border-border lg:bg-surface lg:px-8 lg:text-fg">
      {/* Brand (mobile only - the sidebar shows it on desktop) */}
      <div className="flex items-center gap-2.5 lg:hidden">
        <BrickWall className="h-8 w-8 text-orange-500" aria-hidden="true" />
        <div className="leading-tight">
          <p className="text-lg font-bold">BrickPro</p>
          <p className="text-[11px] text-white/70">Brick Business Management</p>
        </div>
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
                {initials(currentUser.name)}
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-medium">{currentUser.name}</span>
                <span className="block text-xs text-white/70 lg:text-fg-muted">{currentUser.role}</span>
              </span>
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </span>
          }
          items={[
            { label: "Settings", icon: Settings, onClick: () => navigate("/settings") },
            { type: "divider" },
            // TODO (auth phase): call logout() before navigating.
            { label: "Log out", icon: LogOut, variant: "danger", onClick: () => navigate("/login") },
          ]}
        />
      </div>
    </header>
  );
}
