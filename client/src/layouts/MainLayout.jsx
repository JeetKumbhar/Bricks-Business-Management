import { Outlet } from "react-router-dom";
import Header from "./Header";
import MobileBottomNav from "./MobileBottomNav";
import Sidebar from "./Sidebar";

/**
 * Desktop: Sidebar | Header + Page content
 * Mobile : Header / Page content / Bottom navigation
 * Pages render inside <Outlet />.
 */
export default function MainLayout() {
  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>

      <Sidebar />

      <div className="flex min-h-dvh min-w-0 flex-col lg:pl-64">
        <Header />
        {/* pb-24 leaves room for the fixed bottom nav on mobile */}
        <main id="main-content" className="min-w-0 flex-1 px-4 py-4 pb-28 sm:px-6 lg:px-8 lg:pb-8">
          <Outlet />
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
}
