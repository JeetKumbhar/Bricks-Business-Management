import { NavLink } from "react-router-dom";
import { BrickWall } from "lucide-react";
import { cn } from "../utils/cn";
import { navItems } from "./navItems";

/** Desktop sidebar (hidden below the lg breakpoint, where MobileBottomNav takes over). */
export default function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-secondary text-white lg:flex">
      <div className="flex h-16 shrink-0 items-center gap-3 px-5">
        <BrickWall className="h-9 w-9 text-orange-500" aria-hidden="true" />
        <div className="leading-tight">
          <p className="text-xl font-bold">BrickPro</p>
          <p className="text-[11px] text-white/70">Brick Business Management</p>
        </div>
      </div>

      <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive ? "bg-primary text-white" : "text-white/75 hover:bg-white/10 hover:text-white"
              )
            }
          >
            <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="shrink-0 border-t border-white/10 px-5 py-5 text-center">
        <BrickWall className="mx-auto h-8 w-8 text-orange-500" aria-hidden="true" />
        <p className="mt-2 text-xs text-white/70">Build Today</p>
        <p className="text-xs text-white/70">Stronger Tomorrow</p>
      </div>
    </aside>
  );
}
