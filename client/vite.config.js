import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The browser only ever calls relative "/api/..." URLs (src/services/api.js). In development and in `vite preview`
// this proxy forwards them to the local Express server, so the login cookie is same-origin exactly as it is in
// production (where vercel.json does the forwarding). Set API_PROXY_TARGET in client/.env.local to use another server.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.API_PROXY_TARGET || "http://localhost:5000";
  const proxy = { "/api": { target, changeOrigin: true } };

  return {
    plugins: [react(), tailwindcss()],
    server: { proxy },
    preview: { proxy },
  };
});
