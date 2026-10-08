import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { Modal } from "../components/ui";
import { cn } from "../utils/cn";
import { navItems } from "./navItems";

const PRIMARY_COUNT = 4; // Dashboard, Labour, Attendance, Payments; the rest go under "More"
const primaryItems = navItems.slice(0, PRIMARY_COUNT);
const overflowItems = navItems.slice(PRIMARY_COUNT);

/** Mobile bottom navigation (hidden on lg+, where the Sidebar is shown). */
export default function MobileBottomNav() {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = overflowItems.some((item) => pathname.startsWith(item.path));

  const itemClass = (active) =>
    cn(
      "flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors",
      active ? "text-primary" : "text-fg-muted"
    );

  return (
    <>
      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {primaryItems.map(({ label, mobileLabel, path, icon: Icon }) => (
          <NavLink key={path} to={path} className={({ isActive }) => itemClass(isActive)}>
            <Icon className="h-5 w-5" aria-hidden="true" />
            {mobileLabel ?? label}
          </NavLink>
        ))}

        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          className={itemClass(moreActive)}
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          More
        </button>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="More" size="sm">
        <div className="grid grid-cols-3 gap-3 pb-2">
          {overflowItems.map(({ label, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-2 rounded-xl border p-3 text-xs font-medium",
                  isActive
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border bg-surface text-fg hover:bg-background"
                )
              }
            >
              <Icon className="h-6 w-6" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </div>
      </Modal>
    </>
  );
}
