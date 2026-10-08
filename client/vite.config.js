   import { defineConfig } from "vite";
   import react from "@vitejs/plugin-react"; // keep whatever your file already has here
   import tailwindcss from "@tailwindcss/vite"; // add this

   export default defineConfig({
     plugins: [react(), tailwindcss()], // add tailwindcss()
   });