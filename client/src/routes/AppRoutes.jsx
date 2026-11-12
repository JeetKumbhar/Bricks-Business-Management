import { Link, Navigate, Route, Routes } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";
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
import Bills from "../pages/Bills";
import BillDetail from "../pages/BillDetail";
import BillEditor from "../pages/BillEditor";
import BillFromPheeras from "../pages/BillFromPheeras";
import Customers from "../pages/Customers";
import Trucks from "../pages/Trucks";
import TruckDetail from "../pages/TruckDetail";
import PatlavaleProduction from "../pages/PatlavaleProduction";
import Login from "../pages/Login";
import AppDataProviders from "./AppDataProviders";
import ProtectedRoute, { PublicOnlyRoute } from "./ProtectedRoute";

/*
 * /login is public (someone already signed in is sent on to the app). Every other page is inside <ProtectedRoute> (not signed in -> /login,
 * remembering where they were going) and inside <AppDataProviders>, so no data is requested before sign-in.
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
      <Route path="/login" element={<PublicOnlyRoute />}>
        <Route index element={<Login />} />
      </Route>
      {import.meta.env.DEV && (
        <Route path="/design-preview" element={<DesignPreview />} />
      )}

      {/* App (sidebar / header / bottom nav) */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppDataProviders />}>
          <Route element={<MainLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="labours" element={<LabourManagement />} />
            <Route path="labours/:id" element={<LabourProfile />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="payments" element={<Payments />} />
            <Route path="maapvali-work" element={<MaapvaliWork />} />
            <Route
              path="patlavale-production"
              element={<PatlavaleProduction />}
            />
            <Route path="salary" element={<Salary />} />
            <Route path="trucks" element={<Trucks />} />
            <Route path="trucks/:id" element={<TruckDetail />} />
            <Route path="customers" element={<Customers />} />
            <Route path="bills" element={<Bills />} />
            <Route path="bills/new" element={<BillEditor />} />
            <Route path="bills/from-pheeras" element={<BillFromPheeras />} />
            <Route path="bills/:id" element={<BillDetail />} />
            <Route path="bills/:id/edit" element={<BillEditor />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
