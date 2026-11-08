import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css"; // design tokens + Tailwind - without this line the app renders unstyled
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);
