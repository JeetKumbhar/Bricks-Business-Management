
import { BarChart3, Banknote, CalendarCheck, LayoutDashboard, Settings, Truck, Users, Wallet } from "lucide-react";

// Single source of truth for navigation (used by Sidebar and MobileBottomNav).
// `mobileLabel` is the shorter label shown in the bottom bar.
export const navItems = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Labours", mobileLabel: "Labour", path: "/labours", icon: Users },
  { label: "Attendance", path: "/attendance", icon: CalendarCheck },
  { label: "Payments", path: "/payments", icon: Wallet },
  { label: "Salary", path: "/salary", icon: Banknote },
  { label: "Trucks", path: "/trucks", icon: Truck },
  { label: "Reports", path: "/reports", icon: BarChart3 },
  { label: "Settings", path: "/settings", icon: Settings },
];
