import { BrowserRouter } from "react-router-dom";
import { ToastProvider } from "./components/ui";
import { LabourProvider } from "./context/LabourContext";
import AppRoutes from "./routes/AppRoutes";

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <LabourProvider>
          <AppRoutes />
        </LabourProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
