import { BrowserRouter } from "react-router-dom";
import { ToastProvider } from "./components/ui";
import { LabourProvider } from "./context/LabourContext";
import { TruckProvider } from "./context/TruckContext";
import { BillProvider } from "./context/BillContext";
import { TruckTripProvider } from "./context/TruckTripContext";
import IntroAnimation from "./components/common/IntroAnimation";
import AppRoutes from "./routes/AppRoutes";

export default function App() {
  return (
    <>
      <BrowserRouter>
        <ToastProvider>
          <LabourProvider>
            <TruckProvider>
              <TruckTripProvider>
                <BillProvider>
                  <AppRoutes />
                </BillProvider>
              </TruckTripProvider>
            </TruckProvider>
          </LabourProvider>
        </ToastProvider>
      </BrowserRouter>
      {/* Visual layer only; plays once per full page load and sits above the already-mounted app. */}
      <IntroAnimation />
    </>
  );
}
