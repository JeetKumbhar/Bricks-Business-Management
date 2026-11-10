import { BrowserRouter } from "react-router-dom";
import { ToastProvider } from "./components/ui";
import IntroAnimation from "./components/common/IntroAnimation";
import AppRoutes from "./routes/AppRoutes";

export default function App() {
  return (
    <>
      <BrowserRouter>
        <ToastProvider>
          {/* the data stores are mounted inside the signed-in routes (routes/AppDataProviders.jsx) */}
          <AppRoutes />
        </ToastProvider>
      </BrowserRouter>
      {/* Visual layer only; plays once per full page load and sits above the already-mounted app. */}
      <IntroAnimation />
    </>
  );
}
