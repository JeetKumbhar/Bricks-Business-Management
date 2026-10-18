import { Link, Navigate, Route, Routes } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";
import PagePlaceholder from "../components/common/PagePlaceholder";
import { Button, EmptyState } from "../components/ui";
import DesignPreview from "../pages/DesignPreview";
import Dashboard from "../pages/Dashboard";
import LabourManagement from "../pages/LabourManagement";
import LabourProfile from "../pages/LabourProfile";
import Attendance from "../pages/Attendance";
import MaapvaliWork from "../pages/MaapvaliWork";
import Payments from "../pages/Payments";
import Reports from "../pages/Reports";
import Salary from "../pages/Salary";
import Settings from "../pages/Settings";
import Trucks from "../pages/Trucks";
import PatlavaleProduction from "../pages/PatlavaleProduction";

/*
 * Each <PagePlaceholder> is swapped for the real page in its own phase, e.g.
 *   import Attendance from "../pages/Attendance";
import Payments from "../pages/Payments";
 *   <Route path="attendance" element={<Attendance />} />
 *
 * Auth phase: wrap the <MainLayout /> route in a <ProtectedRoute> and
 * redirect "/login" to "/dashboard" when already signed in.
 */

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <EmptyState
        title="Page not found"
        description="The page you are looking for does not exist."
        action={
          <Link to="/dashboard">
            <Button>Go to Dashboard</Button>
          </Link>
        }
      />
    </div>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      {/* Public (no layout) */}
      <Route path="/login" element={<PagePlaceholder title="Login" />} />
      {import.meta.env.DEV && <Route path="/design-preview" element={<DesignPreview />} />}

      {/* App (sidebar / header / bottom nav) */}
      <Route element={<MainLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="labours" element={<LabourManagement />} />
        <Route path="labours/:id" element={<LabourProfile />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="payments" element={<Payments />} />
        <Route path="maapvali-work" element={<MaapvaliWork />} />
        <Route path="patlavale-production" element={<PatlavaleProduction />} />
        <Route path="salary" element={<Salary />} />
        <Route path="trucks" element={<Trucks />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
