import { Outlet } from "react-router-dom";
import { BillProvider } from "../context/BillContext";
import { LabourProvider } from "../context/LabourContext";
import { TruckProvider } from "../context/TruckContext";
import { TruckTripProvider } from "../context/TruckTripContext";

/**
 * The data stores. They read from the server as soon as they mount, so they must only exist while someone is signed in:
 * this sits INSIDE <ProtectedRoute>. Before sign-in nothing is requested (no 401 flood), after signing in they load with the new
 * session, and after signing out they are discarded (the next person never sees the previous data).
 */
export default function AppDataProviders() {
  return (
    <LabourProvider>
      <TruckProvider>
        <TruckTripProvider>
          <BillProvider>
            <Outlet />
          </BillProvider>
        </TruckTripProvider>
      </TruckProvider>
    </LabourProvider>
  );
}
